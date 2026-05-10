const { createMatchImage, clearFolder } = require("./logo.js");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { uploadMultiThread, deleteOldImages } = require("./cloudinary.js");

const SOURCE_DOMAIN = "https://thapcam24h.net";

function absolutizeUrl(url, domain) {
  if (!url) return null;
  if (typeof url !== "string") return null;
  if (url.startsWith("data:")) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${domain}${url}`;
  return url;
}

/**
 * Helper to generate a random ID
 */
function generateId(prefix = "id") {
  return `${prefix}-${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * Scrapes thapcam24h.net hot matches from the football spotlight section
 */
async function scrapeThapcamHot() {
  const domain = SOURCE_DOMAIN;
  const url = `${domain}/truc-tiep-bong-da-xoilac-tv`;
  console.log(`🚀 Fetching data from ${url}...`);

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // Get only HOT matches from the spotlight section
    // Hot matches have both: grid-matches__item AND stream_m_hot classes
    const hotMatchElements = $(".grid-matches__item.stream_m_hot").toArray();

    if (hotMatchElements.length === 0) {
      console.log(
        "⚠️ No HOT matches found in spotlight section. Matches might not have started yet.",
      );
      return [];
    }

    console.log(`🔥 Found ${hotMatchElements.length} HOT match cards`);

    const matches = [];

    // Process each hot match
    const concurrency = 6;
    let idx = 0;

    async function worker() {
      while (idx < hotMatchElements.length) {
        const myIdx = idx++;
        const el = hotMatchElements[myIdx];
        const card = $(el);

        // Extract basic match info
        const matchLink = card.find(".grid-match__body").attr("href");
        if (!matchLink) return;

        const fullMatchLink = matchLink.startsWith("http")
          ? matchLink
          : `${domain}${matchLink}`;

        const homeName = card
          .find(".grid-match__team-home .grid-match__team--name")
          .text()
          .trim();
        const awayName = card
          .find(".grid-match__team-away .grid-match__team--name")
          .text()
          .trim();

        const league = card.find(".grid-match__league").text().trim();

        const homeIcon = absolutizeUrl(
          card.find(".grid-match__team-home-logo").attr("src"),
          domain,
        );
        const awayIcon = absolutizeUrl(
          card.find(".grid-match__team-away-logo").attr("src"),
          domain,
        );
        const leagueIcon = absolutizeUrl(
          card.find(".grid-match__league img").attr("src"),
          domain,
        );

        // Extract status/time from the status div
        const statusText = card
          .find(".grid-match__status span span")
          .first()
          .text()
          .trim();
        const timeText = card
          .find(".grid-match__status .time-load-")
          .text()
          .trim();

        console.log(`🔗 Scraping stream for: ${homeName} vs ${awayName}`);

        // Scrape stream links from the match page
        const streamLinks = await scrapeMatchStreams(fullMatchLink);

        matches[myIdx] = {
          league,
          status: statusText || "LIVE",
          time: timeText || "",
          link: fullMatchLink,
          streams: streamLinks || {},
          teams: {
            home: {
              name: homeName,
              icon: homeIcon,
            },
            away: {
              name: awayName,
              icon: awayIcon,
            },
          },
          icons: {
            league: leagueIcon || null,
          },
        };
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));

    // Filter out null entries and matches without streams
    const validMatches = matches.filter((m) => m && m.streams);

    const hasStream = validMatches.some(
      (m) => m.streams && Object.keys(m.streams).length > 0,
    );

    if (!hasStream) {
      console.log("⚠️ No stream links found for any matches.");
    }

    return validMatches;
  } catch (error) {
    console.error("❌ Error during scraping:", error.message);
    return [];
  }
}

/**
 * Scrapes stream links from a match page
 */
async function scrapeMatchStreams(matchUrl) {
  async function extractQualityStreamsFromM3u8(playlistUrl) {
    try {
      const res = await axios.get(playlistUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: 12000,
        responseType: "text",
      });

      const body = String(res.data || "");
      if (!body.includes("#EXTM3U")) return {};

      const lines = body.split(/\r?\n/);
      const variants = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;

        const attrs = line.slice("#EXT-X-STREAM-INF:".length);
        const nextLine = (lines[i + 1] || "").trim();
        if (!nextLine || nextLine.startsWith("#")) continue;

        const resMatch = attrs.match(/RESOLUTION=(\d+)x(\d+)/i);
        const bwMatch = attrs.match(/BANDWIDTH=(\d+)/i);

        const height = resMatch ? Number(resMatch[2]) : 0;
        const bandwidth = bwMatch ? Number(bwMatch[1]) : 0;
        const absoluteUrl = new URL(nextLine, playlistUrl).toString();

        let quality = "sd";
        if (height >= 1080) quality = "fullhd";
        else if (height >= 720) quality = "hd";

        variants.push({ quality, bandwidth, url: absoluteUrl });
      }

      if (variants.length === 0) return {};

      // Keep best bandwidth per quality.
      const byQuality = {};
      for (const v of variants.sort((a, b) => b.bandwidth - a.bandwidth)) {
        if (!byQuality[v.quality]) byQuality[v.quality] = v.url;
      }
      return byQuality;
    } catch {
      return {};
    }
  }

  function inferQualityFromUrl(url) {
    const u = String(url || "").toLowerCase();
    if (/1080|fullhd|fhd/.test(u)) return "fullhd";
    if (/720|\bhd\b/.test(u)) return "hd";
    if (/480|360|\bsd\b/.test(u)) return "sd";
    return "";
  }

  try {
    const response = await axios.get(matchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // New Thapcam structure: stream URLs are embedded in user switcher items.
    // Example: <div class="watch_userItem__nwzZM" data-fileurl="...m3u8">...
    const streams = {};
    const seen = new Set();
    const sourceUrls = [];

    $("[data-fileurl]").each((i, el) => {
      const fileUrl = String($(el).attr("data-fileurl") || "").trim();
      if (!/^https?:\/\//i.test(fileUrl)) return;
      if (!/m3u8/i.test(fileUrl)) return;
      if (seen.has(fileUrl)) return;

      const rawName =
        $(el).find(".watch_userName__41lYM").first().text().trim() ||
        `Stream ${Object.keys(streams).length + 1}`;

      let key = rawName
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      if (!key) key = `stream_${Object.keys(streams).length + 1}`;
      if (streams[key]) key = `${key}_${Object.keys(streams).length + 1}`;

      streams[key] = fileUrl;
      sourceUrls.push(fileUrl);
      seen.add(fileUrl);
    });

    // Fallback: parse jwplayer setup file: "...m3u8"
    const jwFileMatch = html.match(
      /\bfile\s*:\s*"(https?:[^"\n]+?m3u8[^"\n]*)"/i,
    );
    if (jwFileMatch && jwFileMatch[1]) {
      const jwUrl = jwFileMatch[1].trim();
      if (jwUrl && !seen.has(jwUrl)) {
        streams.primary = jwUrl;
        sourceUrls.push(jwUrl);
      }
    }

    // Try to derive normalized quality buckets: fullhd/hd/sd.
    const qualityBuckets = {};
    for (const srcUrl of sourceUrls) {
      const parsed = await extractQualityStreamsFromM3u8(srcUrl);
      if (parsed.fullhd && !qualityBuckets.fullhd)
        qualityBuckets.fullhd = parsed.fullhd;
      if (parsed.hd && !qualityBuckets.hd) qualityBuckets.hd = parsed.hd;
      if (parsed.sd && !qualityBuckets.sd) qualityBuckets.sd = parsed.sd;

      // Fallback inference for single-bitrate playlists.
      if (!parsed.fullhd && !parsed.hd && !parsed.sd) {
        const q = inferQualityFromUrl(srcUrl);
        if (q && !qualityBuckets[q]) qualityBuckets[q] = srcUrl;
      }
    }

    if (Object.keys(qualityBuckets).length > 0) {
      return qualityBuckets;
    }

    if (Object.keys(streams).length > 0) {
      return streams;
    }

    // Look for serverStreamLinks or similar stream data
    let match = html.match(/const\s+serverStreamLinks\s*=\s*({.*?});/s);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch (e) {
        console.error(`❌ JSON Parse Error for ${matchUrl}`);
        return {};
      }
    }

    // Try alternative pattern
    match = html.match(/streamLinks\s*=\s*({.*?});/s);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch (e) {
        console.error(`❌ JSON Parse Error (alternative) for ${matchUrl}`);
        return {};
      }
    }

    return {};
  } catch (error) {
    console.error(`❌ Error scraping streams from ${matchUrl}:`, error.message);
    return {};
  }
}

/**
 * Generate stable channel ID from match link
 */
function stableChannelId(matchLink) {
  const slug = matchLink.split("/").pop();
  return "ch-" + slug.replace(/[^a-zA-Z0-9]/g, "");
}

function buildDomainImageUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== "string") return "img/favicon.png";

  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const fileName = "img/favicon.png";

  return `${normalizedBase}/${fileName}`;
}

async function main() {
  console.log("🏁 Starting ThapcamTV HOT Matches Scraper...");
  const list = await scrapeThapcamHot();

  console.log(
    `\n📊 Scraping finished. Total HOT matches found: ${list.length}`,
  );

  if (list.length === 0) {
    console.log("⚠️ No data to save. No HOT matches available at the moment.");
    return;
  }

  try {
    const templatePath = path.join(__dirname, "template-tc.json");
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found at ${templatePath}`);
    }

    const templateData = JSON.parse(fs.readFileSync(templatePath, "utf8"));

    // Keep the logo URL tied to configured domain instead of hard-coded host.
    if (!templateData.image) templateData.image = { type: "cover", url: "" };
    templateData.image.url = buildDomainImageUrl(SOURCE_DOMAIN);

    const statusConfig = {
      LIVE: {
        text: "● Live",
        color: "#FF0000",
      },
      "Sắp bắt đầu": {
        text: "Upcoming",
        color: "#FF9800",
      },
      "Đã kết thúc": {
        text: "Fulltime",
        color: "#9E9E9E",
      },
      "Đang diễn ra": {
        text: "● Live",
        color: "#FF0000",
      },
    };

    const channels = [];
    const uploadedIds = [];

    // Prepare list with IDs and public IDs
    const itemsWithIds = list.map((item) => {
      const channelId = stableChannelId(item.link);
      const publicId = channelId.replace("ch-", "img-");
      return { item, channelId, publicId };
    });

    // Check if images exist on Cloudinary before creating buffers
    const concurrency = 6;
    let idx = 0;
    const existResults = Array(itemsWithIds.length);
    const { v2: cloudinary } = require("cloudinary");

    async function existWorker() {
      while (idx < itemsWithIds.length) {
        const myIdx = idx++;
        const t = itemsWithIds[myIdx];
        try {
          const res = await cloudinary.api.resource("thapcam/" + t.publicId);
          existResults[myIdx] = {
            exists: true,
            url: res.secure_url,
            publicId: t.publicId,
          };
        } catch (e) {
          existResults[myIdx] = { exists: false, publicId: t.publicId };
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, existWorker));

    // Create buffers and upload tasks only for new images
    const uploadTasks = [];
    for (let i = 0; i < itemsWithIds.length; ++i) {
      const t = itemsWithIds[i];
      if (!existResults[i].exists) {
        const buffer = await createMatchImage(
          t.item.league,
          t.item.teams.home.name,
          t.item.teams.home.icon,
          t.item.teams.away.name,
          t.item.teams.away.icon,
          t.item.time,
          t.item.status,
          t.item.status,
        );
        uploadTasks.push({
          buffer,
          publicId: t.publicId,
          item: t.item,
          channelId: t.channelId,
        });
      }
      uploadedIds.push(t.publicId);
    }

    // Upload new images
    let uploadResults = [];
    if (uploadTasks.length > 0) {
      uploadResults = await uploadMultiThread(
        uploadTasks.map((t) => ({ buffer: t.buffer, publicId: t.publicId })),
      );
    }

    // Map publicId to URL
    const urlMap = {};
    existResults.forEach((r) => {
      if (r.exists && typeof r.url === "string") urlMap[r.publicId] = r.url;
    });

    uploadTasks.forEach((t, i) => {
      const r = uploadResults[i];
      if (r && r.success && typeof r.url === "string")
        urlMap[t.publicId] = r.url;
    });

    // Build channels array
    for (const t of itemsWithIds) {
      const { item, channelId, publicId } = t;
      const urlImage = urlMap[publicId] || "";

      if (existResults.find((r) => r.publicId === publicId && r.exists)) {
        console.log(`[cache] Using cached image for publicId: ${publicId}`);
      }

      const labelStatus = statusConfig[item.status] || {
        text: "● Live",
        color: "#FF0000",
      };

      if (!channels.some((c) => c.id === channelId)) {
        channels.push({
          id: channelId,
          name: `${item.teams.home.name} vs ${item.teams.away.name}`,
          labels: [
            {
              position: "top-left",
              ...labelStatus,
              text_color: "#FFFFFF",
              font_size: 6,
            },
          ],
          image: {
            url: urlImage,
            height: 480,
            width: 640,
            display: "cover",
          },
          type: "single",
          display: "overlay",
          sources: [
            {
              id: generateId("src"),
              name: `${item.teams.home.name} - ${item.teams.away.name}`,
              contents: [
                {
                  id: generateId("ct"),
                  name: item.league,
                  streams: [
                    {
                      id: generateId("st"),
                      name: "Stream",
                      stream_links: Object.entries(item.streams).map(
                        ([streamName, streamUrl]) => ({
                          id: generateId("lnk"),
                          name: streamName
                            .normalize("NFD")
                            .replace(/[\u0300-\u036f]/g, "")
                            .replace(/đ/g, "d")
                            .replace(/Đ/g, "D")
                            .toUpperCase(),
                          type: "hls",
                          default: true,
                          url: streamUrl,
                          request_headers: [
                            { key: "Referer", value: item.link },
                            { key: "User-Agent", value: "Mozilla/5.0" },
                          ],
                        }),
                      ),
                    },
                  ],
                },
              ],
            },
          ],
        });
      }
    }

    await deleteOldImages(uploadedIds);

    // Update template
    if (!templateData.groups) templateData.groups = [{}];
    templateData.groups[0].channels = channels;

    const outputPath = path.join(__dirname, "channels-thapcam-hot.json");
    fs.writeFileSync(outputPath, JSON.stringify(templateData, null, 4));

    console.log(`\n🎉 Success! File generated: ${outputPath}`);
    console.log(
      `📁 Captured ${channels.length} HOT matches from ThapcamTV spotlight.`,
    );
  } catch (error) {
    const message =
      error?.message ||
      (typeof error === "string" ? error : null) ||
      (error ? JSON.stringify(error) : "Unknown error");
    console.error("❌ Error generating JSON:", message);
    if (error?.stack) {
      console.error(error.stack);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  }
}

main();
