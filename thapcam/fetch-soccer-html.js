const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const DOMAIN = "https://hoadaotv.me";
const PAGE_PATH = "/soccer";
const URL = `${DOMAIN}${PAGE_PATH}`;

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const outDir = path.join(__dirname, "resource");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `hoadaotv-soccer-${safeTimestamp()}.html`);

  console.log(`🚀 Fetching HTML: ${URL}`);

  const res = await axios.get(URL, {
    responseType: "text",
    decompress: true,
    timeout: 30000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "vi,en-US;q=0.9,en;q=0.8",
      Referer: DOMAIN,
    },
    // axios follows redirects by default
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const html = typeof res.data === "string" ? res.data : String(res.data);
  fs.writeFileSync(outFile, html, "utf8");

  const bytes = Buffer.byteLength(html, "utf8");
  console.log(`✅ Saved: ${outFile}`);
  console.log(`📦 Size: ${bytes.toLocaleString("en-US")} bytes`);

  // Quick local analysis to help find the "hot matches" container
  const $ = cheerio.load(html);
  const totalCards = $(".cm-wrap").length;
  const totalBtnWatch = $(".btn-watch").length;
  const totalCardMatch = $(".card-match").length;

  console.log("\n🔎 Quick DOM stats:");
  console.log(`- .cm-wrap: ${totalCards}`);
  console.log(`- .btn-watch: ${totalBtnWatch}`);
  console.log(`- .card-match: ${totalCardMatch}`);

  // Likely sections based on class keywords
  const keywordRe = /(hot|featured|popular|trend|highlight|top)/i;
  const candidates = [];
  $("[class]").each((_, el) => {
    const cls = String($(el).attr("class") || "");
    if (!keywordRe.test(cls)) return;
    const count = $(el).find(".cm-wrap").length;
    if (count <= 0) return;
    candidates.push({
      tag: el.tagName,
      className: cls.trim().replace(/\s+/g, " "),
      count,
    });
  });

  if (candidates.length) {
    candidates.sort((a, b) => b.count - a.count);
    console.log("\n⭐ Possible hot/featured containers (has .cm-wrap inside):");
    for (const c of candidates.slice(0, 10)) {
      console.log(`- <${c.tag} class=\"${c.className}\"> : ${c.count}`);
    }
  } else {
    console.log(
      "\n⚠️ No obvious hot/featured containers found by class keywords.",
    );
  }

  console.log(
    "\nNext: open the saved HTML and search for keywords like 'HOT', 'Nổi bật', 'btn-watch', 'cm-wrap'.",
  );
}

main().catch((err) => {
  const msg = err?.response
    ? `HTTP ${err.response.status}: ${err.response.statusText}`
    : err?.message || String(err);
  console.error("❌ Fetch failed:", msg);
  process.exitCode = 1;
});
