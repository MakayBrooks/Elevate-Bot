const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { getStore, markDirty } = require('./db');

function loadJournalDB() {
  const store = getStore();
  if (!store.journal) store.journal = {};
  return store.journal;
}

// Parse PnL string like '+$250', '-$1,250' → number
function parsePnL(pnlStr) {
  if (!pnlStr) return 0;
  const cleaned = pnlStr.replace(/,/g, '').match(/([+-]?[\d.]+)/);
  if (!cleaned) return 0;
  const num = parseFloat(cleaned[1]);
  return isNaN(num) ? 0 : (pnlStr.trim().startsWith('-') ? -Math.abs(num) : num);
}

// Compute max win streak across all trades
function computeBestStreak(trades) {
  let best = 0, current = 0;
  for (const t of trades) {
    if ((t.outcome || '').toLowerCase().startsWith('w')) { current++; if (current > best) best = current; }
    else current = 0;
  }
  return best;
}

function computeTradingStats(trades) {
  const wins = trades.filter(t => (t.outcome || '').toLowerCase().startsWith('w')).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;
  const bestStreak = computeBestStreak(trades);
  const totalPnL = trades.reduce((sum, t) => sum + parsePnL(t.pnl), 0);
  return { total: trades.length, wins, winRate, bestStreak, totalPnL };
}

async function postTradingLeaderboard(channel, guild) {
  const db = loadJournalDB();
  const MEDALS = ['🥇', '🥈', '🥉'];

  const entries = [];
  for (const [userId, userData] of Object.entries(db)) {
    if (userId.startsWith('_') || !userData || !userData.trades || !userData.trades.length) continue;
    const stats = computeTradingStats(userData.trades);
    if (stats.total < 5) continue;
    entries.push({ userId, stats });
  }
  entries.sort((a, b) => b.stats.winRate - a.stats.winRate);
  const top10 = entries.slice(0, 10);

  const embed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('📈 Trading Leaderboard')
    .setDescription('> Top traders by Win Rate (min. 5 trades to qualify).\n> Click **My Achievements** to view your private progress.\n\u200b');

  if (top10.length === 0) {
    embed.addFields({ name: 'No qualifiers yet', value: 'Log at least 5 trades to appear here!', inline: false });
  } else {
    for (let i = 0; i < top10.length; i++) {
      const { userId, stats } = top10[i];
      let displayName = '<@' + userId + '>';
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) displayName = member.displayName;
      } catch {}
      const medal = i < 3 ? MEDALS[i] : '**' + (i + 1) + '.**';
      const pnlSign = stats.totalPnL >= 0 ? '+' : '';
      const pnlStr = pnlSign + '$' + Math.abs(stats.totalPnL).toFixed(0);
      embed.addFields({
        name: medal + '  ' + displayName,
        value: '┕ **' + stats.winRate.toFixed(1) + '% WR** • ' + stats.total + ' trades • Best streak: ' + stats.bestStreak + ' • PnL: ' + pnlStr,
        inline: false,
      });
    }
  }

  embed
    .addFields({ name: '\u200b', value: 'Log trades in the journal to earn your spot here! 📒', inline: false })
    .setFooter({ text: 'Elevate 🪽 • Updates automatically' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('journal_check_achievements').setLabel('🏆 My Achievements').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('trading_lb_refresh').setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary),
  );

  // Try to edit existing panel message
  const store = getStore();
  if (!store.tradingLB) store.tradingLB = {};
  const lbData = store.tradingLB;

  if (lbData.messageId) {
    try {
      const msg = await channel.messages.fetch(lbData.messageId);
      await msg.edit({ embeds: [embed], components: [row] });
      return msg;
    } catch {}
  }

  // Check pinned messages
  try {
    const pinned = await channel.messages.fetchPinned();
    const existing = pinned.find(m => m.author.id === guild.client.user.id && m.embeds[0] && m.embeds[0].title === '📈 Trading Leaderboard');
    if (existing) {
      await existing.edit({ embeds: [embed], components: [row] });
      lbData.messageId = existing.id;
      markDirty();
      return existing;
    }
  } catch {}

  // Post new message
  const msg = await channel.send({ embeds: [embed], components: [row] });
  await msg.pin().catch(() => {});
  lbData.messageId = msg.id;
  markDirty();
  return msg;
}

module.exports = { postTradingLeaderboard, computeTradingStats };