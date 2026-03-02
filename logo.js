const { createCanvas, loadImage } = require("canvas");
const fs = require("fs");

async function createMatchImage(homeLogo, awayLogo, output) {
  const width = 600;
  const height = 300;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // nền
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, width, height);

  const logo1 = await loadImage(homeLogo);
  const logo2 = await loadImage(awayLogo);

  // vẽ logo
  ctx.drawImage(logo1, 80, 75, 150, 150);
  ctx.drawImage(logo2, 370, 75, 150, 150);

  // text VS
  ctx.fillStyle = "#fff";
  ctx.font = "bold 40px Arial";
  ctx.textAlign = "center";
  ctx.fillText("VS", width / 2, height / 2 + 15);

  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(output, buffer);
}

createMatchImage(
  "https://img.rapid-api.icu/football/team/f8e1d380a8a8a3caa43a71527fa119d2/image/small?v=1768601124",
  "https://img.rapid-api.icu/football/team/9227867a0e57a6f39222448943fdbf34/image/small?v=1768601124",
  "match.png",
);
