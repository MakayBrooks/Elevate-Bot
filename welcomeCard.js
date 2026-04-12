const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');

// Register bundled font so it works on ANY server
registerFont(path.join(__dirname, 'assets', 'font-bold.ttf'), { family: 'ElevateFont' });

async function generateWelcomeCard(member) {
  const W = 1400, H = 560;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);

  // Subtle border
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  // ── Logo top left ──────────────────────────────────────────────────────────
  try {
    const logo = await loadImage(path.join(__dirname, 'assets', 'logo.png'));
    const logoH = 110;
    const logoW = (logo.width / logo.height) * logoH;
    ctx.drawImage(logo, 40, 30, logoW, logoH);
  } catch {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 52px ElevateFont';
    ctx.fillText('ELEVATE', 40, 110);
  }

  // ── "WELCOME TO ELEVATE!" title ────────────────────────────────────────────
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 62px ElevateFont';
  ctx.fillText('WELCOME TO ELEVATE!', 200, 108);

  // ── Divider ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(40, 158);
  ctx.lineTo(W - 40, 158);
  ctx.stroke();

  // ── Avatar circle ──────────────────────────────────────────────────────────
  const cx = 220, cy = 360, r = 140;

  // Outer glow ring
  ctx.save();
  ctx.shadowColor = '#FFFFFF';
  ctx.shadowBlur = 30;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Inner ring
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.stroke();

  // Avatar clipped to circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  try {
    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 512, forceStatic: true });
    const avatar = await loadImage(avatarURL);
    ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2);
  } catch {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 100px ElevateFont';
    ctx.textAlign = 'center';
    ctx.fillText(member.user.username[0].toUpperCase(), cx, cy + 36);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  // ── Username box ───────────────────────────────────────────────────────────
  const boxX = 430, boxY = 270, boxW = 900, boxH = 140;

  ctx.save();
  ctx.shadowColor = '#FFFFFF';
  ctx.shadowBlur = 16;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.strokeRect(boxX, boxY, boxW, boxH);
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(boxX, boxY, boxW, boxH);

  // Username
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 58px ElevateFont';
  ctx.textAlign = 'center';
  ctx.fillText(member.user.username, boxX + boxW / 2, boxY + boxH / 2 + 20);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

module.exports = { generateWelcomeCard };
