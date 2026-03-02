const { createCanvas, loadImage } = require("canvas");
const fs = require("fs");

async function createMatchImage(
  league,
  homeName,
  homeLogo,
  awayName,
  awayLogo,
  time,
  day,
  status,
  output,
) {
  const width = 640;
  const height = 480;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const centerX = width / 2;
  const centerY = height / 2;

  // ========= nền =========
  const bg = await loadImage("bg-soccer.jpg");

  // vẽ background cover full canvas
  ctx.drawImage(bg, 0, 0, width, height);

  // overlay xám nhẹ
  ctx.fillStyle = "rgba(0, 0, 0, 0.70)"; // chỉnh độ tối ở đây
  ctx.fillRect(0, 0, width, height);

  // ========= HEADER =========
  ctx.textAlign = "center";

  // status badge
  const statusY = 60;
  ctx.fillStyle = "#ff4d4f";
  ctx.beginPath();
  ctx.roundRect(centerX - 60, statusY + 70, 120, 26, 10); // 8 = radius bo góc
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px Arial";
  ctx.fillText(status, centerX, statusY + 87);

  // league
  ctx.font = "bold 20px Arial";
  ctx.fillText(league, centerX, statusY + 50);

  // ========= MATCH BLOCK (CENTERED) =========

  const logoSize = 100;
  const gap = 60; // khoảng cách logo ↔ VS

  const homeLogoX = centerX - gap - logoSize;
  const awayLogoX = centerX + gap;
  const logoY = centerY - 70;

  const logo1 = await loadImage(homeLogo);
  const logo2 = await loadImage(awayLogo);

  ctx.drawImage(logo1, homeLogoX, logoY, logoSize, logoSize);
  ctx.drawImage(logo2, awayLogoX, logoY, logoSize, logoSize);

  // ========= VS =========
  ctx.fillStyle = "#fff";
  ctx.font = "italic bold 24px Georgia";
  ctx.fillText("VS", centerX, logoY + logoSize / 2 + 10);

  // ========= TEAM NAME =========
  ctx.font = "bold 18px Arial";

  const wrapText = (text, x, y, maxWidth, lineHeight) => {
    const words = text.split(" ");
    let line = "";

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + " ";
      if (ctx.measureText(testLine).width > maxWidth && n > 0) {
        ctx.fillText(line, x, y);
        line = words[n] + " ";
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, y);
  };

  const nameY = logoY + logoSize + 30;

  wrapText(homeName, homeLogoX + logoSize / 2, nameY, 140, 22);
  wrapText(awayName, awayLogoX + logoSize / 2, nameY, 140, 22);

  // ========= TIME =========
  ctx.font = "bold 16px Arial";
  ctx.fillText(`${time} | ${day}`, centerX, nameY + 60);

  // ========= SAVE =========
  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(output, buffer);
}

createMatchImage(
  "Vô Địch Nữ FUSAL ĐNA", // league
  "Việt Nam Nữ Indonesia", // homeName
  "https://img.rapid-api.icu/football/team/f8e1d380a8a8a3caa43a71527fa119d2/image/small?v=1768601124", // homeLogo
  "Indonesia Nữ Malaysia", // awayName
  "https://img.rapid-api.icu/football/team/9227867a0e57a6f39222448943fdbf34/image/small?v=1768601124", // awayLogo
  "15:00", // time
  "02/03", // day
  "Chưa Bắt Đầu", // status
  "match.png", // output
);
