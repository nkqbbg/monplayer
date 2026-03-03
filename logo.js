const { createCanvas, loadImage } = require("canvas");
const fs = require("fs");
const path = require("path");

function clearFolder(folderPath) {
  if (!fs.existsSync(folderPath)) return;

  const files = fs.readdirSync(folderPath);

  for (const file of files) {
    const filePath = path.join(folderPath, file);

    if (fs.lstatSync(filePath).isFile()) {
      fs.unlinkSync(filePath); // xóa file
    }
  }
}
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

  const SCALE = 1.2; // 🔥 chỉnh size toàn bộ UI ở đây

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const centerX = width / 2;
  const centerY = height / 2;

  // =====================================================
  // BACKGROUND
  // =====================================================

  const bg = await loadImage("bg-soccer.jpg");
  ctx.drawImage(bg, 0, 0, width, height);

  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(
    centerX,
    centerY,
    100,
    centerX,
    centerY,
    width,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  // =====================================================
  // LAYOUT ZONES
  // =====================================================

  const headerHeight = height * 0.25;
  const matchHeight = height * 0.5;
  const footerHeight = height * 0.25;

  const headerCenterY = headerHeight / 2;
  const matchCenterY = headerHeight + matchHeight / 2;
  const footerCenterY = headerHeight + matchHeight + footerHeight / 2;

  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";

  // =====================================================
  // HEADER
  // =====================================================

  ctx.font = `bold ${22 * SCALE}px Arial`;
  ctx.fillText(league, centerX, headerCenterY - 20 * SCALE);

  const badgeWidth = 140 * SCALE;
  const badgeHeight = 34 * SCALE;

  ctx.fillStyle = "#ff4d4f";
  ctx.beginPath();
  ctx.roundRect(
    centerX - badgeWidth / 2,
    headerCenterY,
    badgeWidth,
    badgeHeight,
    14 * SCALE,
  );
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.font = `bold ${15 * SCALE}px Arial`;
  ctx.fillText(status, centerX, headerCenterY + 22 * SCALE);

  // =====================================================
  // LOGO
  // =====================================================

  const logo1 = await loadImage(homeLogo);
  const logo2 = await loadImage(awayLogo);

  const logoSize = 120 * SCALE;
  const gap = 110 * SCALE;

  const homeLogoX = centerX - gap - logoSize;
  const awayLogoX = centerX + gap;
  const logoY = matchCenterY - logoSize / 2;

  function drawCircleLogo(img, x, y, size) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();
  }

  drawCircleLogo(logo1, homeLogoX, logoY, logoSize);
  drawCircleLogo(logo2, awayLogoX, logoY, logoSize);

  // =====================================================
  // VS
  // =====================================================

  ctx.fillStyle = "#fff";
  ctx.font = `italic bold ${32 * SCALE}px Georgia`;
  ctx.shadowColor = "rgba(255,255,255,0.7)";
  ctx.shadowBlur = 18 * SCALE;
  ctx.fillText("VS", centerX, matchCenterY + 12 * SCALE);
  ctx.shadowBlur = 0;

  // =====================================================
  // TEAM NAME
  // =====================================================

  ctx.font = `bold ${20 * SCALE}px Arial`;

  function wrapText(text, x, y, maxWidth, lineHeight) {
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
  }

  const nameY = logoY + logoSize + 40 * SCALE;

  wrapText(homeName, homeLogoX + logoSize / 2, nameY, 160 * SCALE, 26 * SCALE);
  wrapText(awayName, awayLogoX + logoSize / 2, nameY, 160 * SCALE, 26 * SCALE);

  // =====================================================
  // FOOTER TIME
  // =====================================================

  ctx.font = `bold ${20 * SCALE}px Arial`;
  ctx.fillText(`${time} | ${day}`, centerX, footerCenterY);

  // =====================================================
  // SAVE
  // =====================================================

  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(output, buffer);
}

// =====================================================
// TEST
// =====================================================

// createMatchImage(
//   "Vô Địch Nữ FUSAL ĐNA",
//   "Việt Nam Nữ Indonesia",
//   "https://img.rapid-api.icu/football/team/f8e1d380a8a8a3caa43a71527fa119d2/image/small?v=1768601124",
//   "Indonesia Nữ Malaysia",
//   "https://img.rapid-api.icu/football/team/9227867a0e57a6f39222448943fdbf34/image/small?v=1768601124",
//   "15:00",
//   "02/03",
//   "Chưa Bắt Đầu",
//   ".\\resource\\match1.png",
// );
module.exports = { createMatchImage, clearFolder };
