const fs = require("fs");
const path = require("path");
const axios = require("axios");

const url =
  "https://thapcam24h.net/truc-tiep/hoang-anh-gia-lai-vs-pvf-cand-1700-10-05-2026/469440";

(async () => {
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 30000,
    });

    const html = response.data;
    const outPath = path.join(
      __dirname,
      "resource",
      "thapcam-match-469440.html",
    );
    fs.writeFileSync(outPath, html, "utf8");

    console.log("Saved:", outPath);
    console.log("Length:", html.length);

    const patterns = [
      /serverStreamLinks\s*=\s*({.*?});/s,
      /streamLinks\s*=\s*({.*?});/s,
      /m3u8/,
      /cdn-hls/,
      /playlist/,
      /jwplayer/i,
      /hls/i,
      /api\//i,
      /fetch\(/i,
      /axios\./i,
    ];

    for (const p of patterns) {
      console.log(String(p), p.test(html));
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exitCode = 1;
  }
})();
