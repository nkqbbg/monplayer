const dns = require("dns");
const https = require("https");
const { createMatchImage, clearFolder } = require("./logo.js");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { uploadMultiThread, deleteOldImages } = require("./cloudinary.js");

const ORIGIN = "https://tieulamtv.org";
const FEED_URL = `${ORIGIN}/app/uploads/match-content/update-content-live.json`;
const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || "tieulam";

// ---------------------------------------------------------------------------
// DNS override: some local networks resolve tieulamtv.org to 127.0.0.1 /
// NXDOMAIN while public resolvers return the real Cloudflare IPs.
// Resolve via public DNS and pin the IP for our https agent.
// ---------------------------------------------------------------------------
const ipCache = new Map(); // hostname -> { addrs: string[], idx: number }
const publicResolver = new dns.promises.Resolver();
publicResolver.setServers(["1.1.1.1", "8.8.8.8", "9.9.9.9"]);

function pickCachedIp(hostname) {
  const entry = ipCache.get(hostname);
  if (!entry || !entry.addrs.length) return null;
  entry.idx = (entry.idx + 1) % entry.addrs.length; // round-robin across retries
  return entry.addrs[entry.idx];
}

function publicLookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  const finish = (ip) => {
    if (options && options.all) {
      return callback(null, [{ address: ip, family: 4 }]);
    }
    return callback(null, ip, 4);
  };
  dns.lookup(hostname, options, (err, address) => {
    const bad =
      err ||
      !address ||
      address === "127.0.0.1" ||
      address === "::1" ||
      String(address).startsWith("127.");
    if (!bad) {
      return options && options.all
        ? dns.lookup(hostname, options, callback)
        : callback(null, address, 4);
    }
    const cached = pickCachedIp(hostname);
    if (cached) return finish(cached);
    publicResolver
      .resolve4(hostname)
      .then((addrs) => {
        ipCache.set(hostname, { addrs, idx: 0 });
        finish(addrs[0]);
      })
      .catch(() => callback(err || new Error(`DNS resolve failed: ${hostname}`)));
  });
}

// NOTE: some networks reset Node's TLS 1.3 handshakes to this host;
// pin TLS 1.2 (safe everywhere, incl. GitHub Actions runners).
// keepAlive is OFF: on flaky networks reused sockets are often already dead.
const tieulamAgent = new https.Agent({
  keepAlive: false,
  lookup: publicLookup,
  minVersion: "TLSv1.2",
  maxVersion: "TLSv1.2",
  ALPNProtocols: ["http/1.1"],
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tieulamGet(url, extra = {}) {
  const { headers, retries = 8, ...rest } = extra;
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "vi,en;q=0.9",
          ...(headers || {}),
        },
        httpsAgent: tieulamAgent,
        timeout: 30000,
        maxRedirects: 5,
        ...rest,
      });
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const wait = 1500 * attempt + Math.floor(Math.random() * 1000);
        console.log(`⏳ Retry ${attempt}/${retries} for ${url} in ${wait}ms (${err.message})`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

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

function normalizeDate(date) {
  // Feed uses "DD.MM" -> display as "DD/MM"
  return String(date || "")
    .trim()
    .replace(/\./g, "/");
}

function mapStatus($card, card) {
  const cls = ($card.attr("class") || "").toLowerCase();
  if (cls.includes("bals-finished-match")) return "Đã Kết Thúc";
  if (cls.includes("bals-live-match")) {
    const raw = card.find(".bals-status-name").first().text().trim();
    if (/^2H$/i.test(raw)) return "Hiệp 2";
    return "Hiệp 1"; // 1H / HT / live minute etc.
  }
  return "Chưa Bắt Đầu";
}

/**
 * Scrapes tieulamtv.org live + upcoming matches from the public JSON feed
 * (/app/uploads/match-content/update-content-live.json) and returns a list
 * of stream data.
 */
async function scrapeSoccer() {
  console.log(`🚀 Fetching data from ${FEED_URL}...`);

  try {
    const response = await tieulamGet(FEED_URL);
    const feed = response.data;
    if (!feed || typeof feed !== "object") {
      console.log("⚠️ Feed did not return JSON. Abort.");
      return [];
    }

    const sections = [
      { key: "live_content", expected: "live" },
      { key: "upcoming_content", expected: "upcoming" },
    ];

    const seen = new Set();
    const cardJobs = [];

    for (const { key } of sections) {
      const html = feed[key];
      if (!html || typeof html !== "string" || html.length < 100) {
        console.log(`⚠️ Section "${key}" empty or missing. Skip.`);
        continue;
      }
      const $ = cheerio.load(html);
      $(".match-card").each((_, el) => {
        const $card = $(el);
        const linkEl = $card.find("a.absolute.inset-0").first();
        let matchPath = linkEl.attr("href");
        if (!matchPath) return;
        const matchLink = matchPath.startsWith("http")
          ? matchPath
          : absolutizeUrl(matchPath, ORIGIN);
        if (!matchLink || seen.has(matchLink)) return;
        seen.add(matchLink);
        cardJobs.push(parseCard($, $card, matchLink));
      });
    }

    const matches = cardJobs.filter(Boolean);
    console.log(`📋 Found ${matches.length} live+upcoming match cards`);

    // Fetch detail pages (streams) with concurrency limit
    const concurrency = 6;
    let idx = 0;
    async function worker() {
      while (idx < matches.length) {
        const myIdx = idx++;
        const m = matches[myIdx];
        console.log(`🔗 Scraping stream for: ${m.teams.home.name} vs ${m.teams.away.name}`);
        const streamers = await scrapelink(m.link);
        matches[myIdx].streamers = streamers || [];
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));

    const hasStream = matches.some((m) => m.streamers && m.streamers.length > 0);
    if (!hasStream) {
      console.log("⚠️ No stream links found.");
    }
    return matches;
  } catch (error) {
    console.error("❌ Error during scraping:", error.message);
    return [];
  }
}

function parseCard($, $card, matchLink) {
  const league = $card.find(".bals-competition-name").first().text().trim();
  const leagueIcon =
    absolutizeUrl($card.find("img[src*='competition']").first().attr("src"), ORIGIN) ||
    absolutizeUrl(
      $card.find("img[src*='competition']").first().attr("data-src"),
      ORIGIN,
    );

  const timeParts = $card
    .find(".bals-match-time .tabular-nums")
    .map((_, el) => $(el).text().trim())
    .get();
  const time = timeParts[0] || "";
  const date = normalizeDate(timeParts[1] || "");

  const homeEl = $card.find(".bals-home-team-name").first();
  const awayEl = $card.find(".bals-away-team-name").first();
  const home = homeEl.text().trim();
  const away = awayEl.text().trim();
  if (!home || !away) return null;

  const homeIcon =
    absolutizeUrl(homeEl.parent().find("img").first().attr("data-src"), ORIGIN) ||
    absolutizeUrl(homeEl.parent().find("img").first().attr("src"), ORIGIN);
  const awayIcon =
    absolutizeUrl(awayEl.parent().find("img").first().attr("data-src"), ORIGIN) ||
    absolutizeUrl(awayEl.parent().find("img").first().attr("src"), ORIGIN);

  const homeScore = $card.find(".bals-home-score").first().text().trim();
  const awayScore = $card.find(".bals-away-score").first().text().trim();
  const status = mapStatus($card, $card);
  const matchId = $card.attr("data-match-id") || "";

  return {
    matchId,
    league,
    time,
    date,
    status,
    score:
      homeScore !== "" && awayScore !== ""
        ? { home: homeScore, away: awayScore }
        : null,
    link: matchLink,
    streamers: [],
    backUrl: null,
    teams: {
      home: { name: home, icon: homeIcon },
      away: { name: away, icon: awayIcon },
    },
    icons: { league: leagueIcon || null },
  };
}

/**
 * Fetch a match detail page and extract streamer cards:
 * `.commentator-card[data-stream-url]` (HLS) + `data-stream-url-flv`.
 */
async function scrapelink(link) {
  try {
    const response = await tieulamGet(link, {
      headers: { Referer: `${ORIGIN}/` },
    });
    const $ = cheerio.load(response.data);
    const cards = $(".commentator-card").toArray();
    const streamers = [];
    const seenUrl = new Set();

    for (const el of cards) {
      const card = $(el);
      const hls = card.attr("data-stream-url");
      const flv = card.attr("data-stream-url-flv");
      if ((!hls || !hls.startsWith("http")) && (!flv || !flv.startsWith("http"))) {
        continue;
      }
      const key = hls || flv;
      if (seenUrl.has(key)) continue;
      seenUrl.add(key);

      streamers.push({
        name: card.attr("data-stream-name") || "BLV",
        streamerId: card.attr("data-streamer-id") || "",
        cdn: card.attr("data-cdn") || "",
        hls: hls && hls.startsWith("http") ? hls : "",
        flv: flv && flv.startsWith("http") ? flv : "",
        embed: card.attr("data-embed") || "",
        page: card.parent("a").attr("href") || "",
        avatar:
          absolutizeUrl(card.find("img").first().attr("data-src"), ORIGIN) ||
          absolutizeUrl(card.find("img").first().attr("src"), ORIGIN) ||
          "",
      });
    }
    return streamers;
  } catch (error) {
    console.error(`❌ Error scraping ${link}:`, error.message);
    return null;
  }
}

function stableChannelId(matchLink) {
  const parts = String(matchLink).split("/").filter(Boolean);
  const slug = parts[parts.length - 1] || matchLink;
  return "ch-" + slug.replace(/[^a-zA-Z0-9]/g, "");
}

function buildStreamLinks(item) {
  const links = [];
  for (const s of item.streamers || []) {
    if (s.hls) {
      links.push({
        id: generateId("lnk"),
        name: s.name,
        type: "hls",
        default: links.length === 0,
        url: s.hls,
        request_headers: [
          { key: "Referer", value: item.link },
          { key: "User-Agent", value: "Mozilla/5.0" },
        ],
      });
    }
    if (s.flv) {
      links.push({
        id: generateId("lnk"),
        name: `${s.name} (FLV)`,
        type: "flv",
        default: false,
        url: s.flv,
        request_headers: [
          { key: "Referer", value: item.link },
          { key: "User-Agent", value: "Mozilla/5.0" },
        ],
      });
    }
  }
  return links;
}

async function main() {
  console.log("🏁 Starting Scraper (tieulamtv.org)...");
  const list = await scrapeSoccer();
  console.log(`\n📊 Scraping finished. Total matches: ${list.length}`);

  if (list.length === 0) {
    console.log("⚠️ No data to save.");
    return;
  }

  try {
    const templatePath = path.join(__dirname, "template.json");
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found at ${templatePath}`);
    }

    const templateData = JSON.parse(fs.readFileSync(templatePath, "utf8"));
    const statusConfig = {
      "Hiệp 1": { text: "● Live", color: "#FF0000" },
      "Hiệp 2": { text: "● Live", color: "#FF0000" },
      "Chưa Bắt Đầu": { text: "Upcoming", color: "#FF9800" },
      "Đã Kết Thúc": { text: "Fulltime", color: "#9E9E9E" },
    };

    const channels = [];
    const uploadedIds = [];
    const itemsWithIds = list.map((item) => {
      const channelId = stableChannelId(item.link);
      const publicId = channelId.replace("ch-", "img-");
      return { item, channelId, publicId };
    });

    // Check existing images on Cloudinary before generating new ones
    const concurrency = 6;
    let idx = 0;
    const existResults = Array(itemsWithIds.length);
    const { v2: cloudinary } = require("cloudinary");
    async function existWorker() {
      while (idx < itemsWithIds.length) {
        const myIdx = idx++;
        const t = itemsWithIds[myIdx];
        try {
          const res = await cloudinary.api.resource(
            `${CLOUDINARY_FOLDER}/${t.publicId}`,
            { resource_type: "image", type: "upload" },
          );
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

    // Generate + upload only missing images
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
          t.item.date,
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

    let uploadResults = [];
    if (uploadTasks.length > 0) {
      uploadResults = await uploadMultiThread(
        uploadTasks.map((t) => ({ buffer: t.buffer, publicId: t.publicId })),
      );
    }
    const urlMap = {};
    existResults.forEach((r) => {
      if (r.exists && typeof r.url === "string") urlMap[r.publicId] = r.url;
    });
    uploadTasks.forEach((t, i) => {
      const r = uploadResults[i];
      if (r && r.success && typeof r.url === "string") urlMap[t.publicId] = r.url;
    });

    // Build channels array
    for (const t of itemsWithIds) {
      const { item, channelId, publicId } = t;
      const urlImage = urlMap[publicId] || "";
      const labelStatus = statusConfig[item.status] || {
        text: "● Live",
        color: "#FF0000",
      };
      const name =
        item.score && (item.status === "Hiệp 1" || item.status === "Hiệp 2")
          ? `${item.teams.home.name} ${item.score.home} - ${item.score.away} ${item.teams.away.name}`
          : `${item.teams.home.name} vs ${item.teams.away.name}`;

      if (!channels.some((c) => c.id === channelId)) {
        channels.push({
          id: channelId,
          name,
          labels: [
            {
              position: "top-left",
              ...labelStatus,
              text_color: "#FFFFFF",
              font_size: 6,
            },
          ],
          image: { url: urlImage, height: 480, width: 640, display: "cover" },
          type: "single",
          display: "overlay",
          sources: [
            {
              id: generateId("src"),
              name: `${item.teams.home.name} - ${item.teams.away.name}`,
              contents: [
                {
                  id: generateId("ct"),
                  name: item.league || "TieulamTV",
                  streams: [
                    {
                      id: generateId("st"),
                      name: "Stream",
                      stream_links: buildStreamLinks(item),
                    },
                  ],
                },
              ],
            },
          ],
        });
      }
    }

    // Only clean up our own folder — never touch the "matches" folder (hoadao)
    await deleteOldImages(uploadedIds, { folder: CLOUDINARY_FOLDER });

    // Update template
    if (!templateData.groups) templateData.groups = [{}];
    templateData.groups[0].channels = channels;

    const outputPath = path.join(__dirname, "channels.json");
    fs.writeFileSync(outputPath, JSON.stringify(templateData, null, 4));

    console.log(`\n🎉 Success! File generated: ${outputPath}`);
    console.log(`📁 Captured ${channels.length} channels.`);
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
