const { createCanvas, loadImage } = require('canvas');
const path = require('path');

async function generateWelcomeCard(member) {
  const W = 900, H = 350;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);

  // Subtle border
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // ── Logo top left ──────────────────────────────────────────────────────────
  try {
    const logo = await loadImage(path.join(__dirname, 'assets', 'logo.png'));
    const logoH = 72;
    const logoW = (logo.width / logo.height) * logoH;
    ctx.drawImage(logo, 28, 22, logoW, logoH);
  } catch {
    ctx.fillStyle = '#F5F0E8';
    ctx.font = 'bold 32px serif';
    ctx.fillText('ELEVATE', 28, 72);
  }

  // ── "WELCOME TO ELEVATE!" title ────────────────────────────────────────────
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 38px "Arial Black", Arial';
  ctx.fillText('WELCOME TO ELEVATE!', 130, 72);

  // ── Divider ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(28, 108);
  ctx.lineTo(W - 28, 108);
  ctx.stroke();

  // ── Avatar circle (left center) ────────────────────────────────────────────
  const cx = 145, cy = 220, r = 90;

  // Outer white glow ring
  ctx.save();
  ctx.shadowColor = '#FFFFFF';
  ctx.shadowBlur = 22;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Inner ring
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx.stroke();

  // Avatar image clipped to circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  try {
    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
    const avatar = await loadImage(avatarURL);
    ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2);
  } catch {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 64px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(member.user.username[0].toUpperCase(), cx, cy + 22);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  // ── Username box (right of avatar) ─────────────────────────────────────────
  const boxX = 280, boxY = 175, boxW = 560, boxH = 90;

  // Box glow
  ctx.save();
  ctx.shadowColor = '#FFFFFF';
  ctx.shadowBlur = 12;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(boxX, boxY, boxW, boxH);
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(boxX, boxY, boxW, boxH);

  // Username text
  const username = member.user.username;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 34px "Arial Black", Arial';
  ctx.textAlign = 'center';
  ctx.fillText(username, boxX + boxW / 2, boxY + boxH / 2 + 12);
  ctx.textAlign = 'left';



  return canvas.toBuffer('image/png');
}

module.exports = { generateWelcomeCard };
