const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { getStore, markDirty } = require('./db');

function loadJournalDB() {
  const store = getStore();
  if (!store.journal) store.journal = {};
  return store.journal;
}
function loadLevelsDB() {
  const store = getStore();
  if (!store.levels) store.levels = { users: {} };
  return store.levels;
}

function computeTradeStats(trades) {
  if (!trades || trades.length === 0) return null;
  const wins = trades.filter(t => (t.outcome||'').trim().toLowerCase().startsWith('w')).length;
  const losses = trades.filter(t => (t.outcome||'').trim().toLowerCase().startsWith('l')).length;
  const winRate = (wins / trades.length) * 100;
  // Best streak
  let best = 0, cur = 0;
  trades.forEach(t => {
    if ((t.outcome||'').trim().toLowerCase().startsWith('w')) { cur++; best = Math.max(best, cur); } else cur = 0;
  });
  // Total PnL
  const totalPnl = trades.reduce((sum, t) => {
    const m = (t.pnl||'').replace(/,/g,'').match(/([+-]?\d+(?:\.\d+)?)/);
    return sum + (m ? parseFloat(m[1]) : 0);
  }, 0);
  // Avg R:R
  const rrVals = trades.map(t => {
    const m = (t.rr||'').match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[2]) / parseFloat(m[1]) : null;
  }).filter(v => v !== null);
  const avgRR = rrVals.length > 0 ? rrVals.reduce((a,b)=>a+b,0) / rrVals.length : 0;
  return { total: trades.length, wins, losses, winRate, bestStreak: best, totalPnl, avgRR };
}

async function buildTradingLeaderboardEmbed(guild) {
  const db = loadJournalDB();
  const levelsDb = loadLevelsDB();
  const rows = [];

  for (const [userId, userData] of Object.entries(db)) {
    if (userId.startsWith('_') || !userData.trades || userData.trades.length < 5) continue;
    const stats = computeTradeStats(userData.trades);
    if (!stats) continue;
    let name = levelsDb.users?.[userId]?.username || userId;
    try { const m = await guild.members.fetch(userId).catch(()=>null); if (m) name = m.displayName; } catch {}
    rows.push({ userId, name, ...stats });
  }

  rows.sort((a, b) => b.winRate - a.winRate);
  const top = rows.slice(0, 10);

  const embed = new EmbedBuilder()
    .setColor(0x00c853)
    .setTitle('\u{1F4C8} Trading Leaderboard')
    .setDescription('> Top traders ranked by **Win Rate** (min. 5 trades).\n\u200b');

  if (top.length === 0) {
    embed.addFields({ name: 'No qualifiers yet', value: 'Log at least **5 trades** to appear here.', inline: false });
  } else {
    const medals = ['\u{1F947}','\u{1F948}','\u{1F949}'];
    top.forEach((row, i) => {
      const medal = medals[i] || `**${i+1}.**`;
      const pnlStr = (row.totalPnl >= 0 ? '+' : '') + '$' + row.totalPnl.toFixed(0);
      const rrStr = row.avgRR > 0 ? `1:${row.avgRR.toFixed(2)}` : 'N/A';
      embed.addFields({
        name: `${medal} ${row.name}`,
        value: `\u250D \u2705 **${row.winRate.toFixed(1)}%** wr • **${row.total}** trades • ${row.wins}W/${row.losses}L\n\u2514 \u{1F525} **${row.bestStreak}** streak • \u2696\uFE0F avg **${rrStr}** • \u{1F4B0} **${pnlStr}**`,
        inline: false,
      });
    });
  }

  embed
    .addFields({ name: '\u200b', value: 'Log trades in \u{1F4DA} journal to earn your spot! \u{1F9F8}', inline: false })
    .setFooter({ text: 'Elevate \u{1FAB5} \u2022 Updates automatically' })
    .setTimestamp();

  return embed;
}

async function postTradingLeaderboard(channel) {
  const guild = channel.guild;
  const embed = await buildTradingLeaderboardEmbed(guild);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('trading_lb_refresh').setLabel('\u{1F504} Refresh').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('journal_check_achievements').setLabel('\u{1F3C6} My Achievements').setStyle(ButtonStyle.Secondary),
  );

  const db = loadJournalDB();
  if (db._tradingLbMessageId) {
    try {
      const msg = await channel.messages.fetch(db._tradingLbMessageId);
      await msg.edit({ embeds: [embed], components: [row] });
      return msg;
    } catch {}
  }
  // Check pinned
  try {
    const pinned = await channel.messages.fetchPinned();
    const existing = pinned.find(m => m.author.id === channel.client.user.id && m.embeds?.[0]?.title?.includes('Trading Leaderboard'));
    if (existing) { await existing.edit({ embeds: [embed], components: [row] }); db._tradingLbMessageId = existing.id; markDirty(); return existing; }
  } catch {}

  const msg = await channel.send({ embeds: [embed], components: [row] });
  await msg.pin().catch(()=>{});
  db._tradingLbMessageId = msg.id;
  markDirty();
  return msg;
}

async function refreshTradingLeaderboard(interaction) {
  await interaction.deferUpdate();
  try {
    const embed = await buildTradingLeaderboardEmbed(interaction.guild);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('trading_lb_refresh').setLabel('\u{1F504} Refresh').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('journal_check_achievements').setLabel('\u{1F3C6} My Achievements').setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({ embeds: [embed], components: [row] });
  } catch (err) {
    if (err.code === 10062) return;
  }
}

module.exports = { postTradingLeaderboard, refreshTradingLeaderboard };
