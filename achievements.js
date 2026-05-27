const { EmbedBuilder } = require('discord.js');

const ACHIEVEMENTS = [
  { id: 'trades_1',    name: '📝 First Trade',        desc: 'Log your first trade',                xp: 150, req: t => t.total >= 1 },
  { id: 'trades_10',   name: '📊 10 Trades',          desc: 'Log 10 trades',                       xp: 150, req: t => t.total >= 10 },
  { id: 'trades_50',   name: '📈 50 Trades',          desc: 'Log 50 trades',                       xp: 150, req: t => t.total >= 50 },
  { id: 'trades_100',  name: '💯 100 Trades',         desc: 'Log 100 trades',                      xp: 150, req: t => t.total >= 100 },
  { id: 'trades_500',  name: '🏦 500 Trades',         desc: 'Log 500 trades',                      xp: 150, req: t => t.total >= 500 },
  { id: 'streak_3',    name: '🔥 3 Win Streak',       desc: '3 consecutive winning trades',        xp: 100, req: t => t.streak >= 3 },
  { id: 'streak_5',    name: '⚡ 5 Win Streak',       desc: '5 consecutive winning trades',        xp: 100, req: t => t.streak >= 5 },
  { id: 'streak_10',   name: '💥 10 Win Streak',      desc: '10 consecutive winning trades',       xp: 100, req: t => t.streak >= 10 },
  { id: 'streak_25',   name: '👑 25 Win Streak',      desc: '25 consecutive winning trades',       xp: 100, req: t => t.streak >= 25 },
  { id: 'winrate_50',  name: '✅ 50% Win Rate',       desc: 'Maintain 50%+ win rate (10+ trades)', xp: 150, req: t => t.total >= 10 && t.winRate >= 50 },
  { id: 'winrate_60',  name: '🎯 60% Win Rate',       desc: 'Maintain 60%+ win rate (20+ trades)', xp: 150, req: t => t.total >= 20 && t.winRate >= 60 },
  { id: 'winrate_70',  name: '🏹 70% Win Rate',       desc: 'Maintain 70%+ win rate (30+ trades)', xp: 150, req: t => t.total >= 30 && t.winRate >= 70 },
  { id: 'weekly_win',  name: '💰 Profitable Week',    desc: 'Have a verified profitable week',     xp: 200, req: t => t.verifiedWeeks >= 1 },
  { id: 'weekly_3',    name: '📅 3 Profitable Weeks', desc: '3 verified profitable weeks',         xp: 200, req: t => t.verifiedWeeks >= 3 },
];

async function checkAchievements(userId, username, stats, guild, addXPFn) {
  const { getStore, markDirty } = require('./db');
  const store = getStore();
  if (!store.journal) store.journal = {};
  if (!store.journal[userId]) store.journal[userId] = {};
  const userData = store.journal[userId];
  if (!userData.achievements) userData.achievements = [];

  const newlyUnlocked = [];
  for (const ach of ACHIEVEMENTS) {
    if (userData.achievements.includes(ach.id)) continue;
    if (ach.req(stats)) {
      userData.achievements.push(ach.id);
      newlyUnlocked.push(ach);
    }
  }

  if (newlyUnlocked.length > 0) {
    markDirty();
    for (const ach of newlyUnlocked) {
      await addXPFn(userId, username, ach.xp, guild);
      try {
        const ch = guild.channels.cache.get(process.env.LEVELS_CHANNEL_ID);
        if (ch) {
          let member = null;
          try { member = await guild.members.fetch(userId); } catch {}
          const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(`${ach.name} — Achievement Unlocked!`)
            .setDescription(
              `${member || `<@${userId}>`} just unlocked an achievement! 🪽\n\n` +
              `**${ach.name}**\n*${ach.desc}*\n\n` +
              `+**${ach.xp} XP** added to your balance.`
            )
            .setThumbnail(member?.user.displayAvatarURL({ extension: 'png' }) || null)
            .setFooter({ text: 'Elevate 🪽 • Achievement Unlocked' })
            .setTimestamp();
          await ch.send({ embeds: [embed] });
        }
      } catch {}
    }
  }
  return newlyUnlocked;
}

function buildAchievementsPanel() {
  return new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('🏆 Trading Achievements')
    .setDescription(
      '> Log trades to unlock achievements and earn XP.\n' +
      '> Click below to privately check your progress.\n\u200b'
    )
    .addFields(
      {
        name: '📝 Trade Count',
        value: ['`📝 First Trade` +150 XP', '`📊 10 Trades` +150 XP', '`📈 50 Trades` +150 XP', '`💯 100 Trades` +150 XP', '`🏦 500 Trades` +150 XP'].join('\n'),
        inline: true,
      },
      {
        name: '🔥 Win Streaks',
        value: ['`🔥 3 Win Streak` +100 XP', '`⚡ 5 Win Streak` +100 XP', '`💥 10 Win Streak` +100 XP', '`👑 25 Win Streak` +100 XP'].join('\n'),
        inline: true,
      },
      {
        name: '🎯 Win Rate',
        value: ['`✅ 50% Win Rate` +150 XP', '`🎯 60% Win Rate` +150 XP', '`🏹 70% Win Rate` +150 XP'].join('\n'),
        inline: true,
      },
      {
        name: '💰 Weekly Earnings (Admin Verified)',
        value: ['`💰 Profitable Week` +200 XP', '`📅 3 Profitable Weeks` +200 XP', '', '*Submit a screenshot of your weekly PnL — admin approves each week*'].join('\n'),
        inline: false,
      },
      { name: '✨ Per Trade', value: '**+75 XP** for every trade logged', inline: false }
    )
    .setFooter({ text: 'Elevate 🪽 • Journal Achievements' })
    .setTimestamp();
}

function buildMyAchievements(userId) {
  const { getStore } = require('./db');
  const store = getStore();
  const userData = store.journal?.[userId] || {};
  const unlocked = userData.achievements || [];
  const trades = userData.trades || [];
  const wins = trades.filter(t => t.outcome?.toLowerCase().startsWith('w')).length;
  const winRate = trades.length ? ((wins / trades.length) * 100).toFixed(1) : 0;
  let streak = 0;
  for (let i = trades.length - 1; i >= 0; i--) {
    if (trades[i].outcome?.toLowerCase().startsWith('w')) streak++;
    else break;
  }

  const rows = ACHIEVEMENTS.map(ach => {
    const done = unlocked.includes(ach.id);
    return `${done ? '✅' : '⬜'} **${ach.name}** — ${ach.desc} *(+${ach.xp} XP)*`;
  });

  const half = Math.ceil(rows.length / 2);

  return new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('🏆 Your Trading Achievements')
    .setDescription(`**${unlocked.length}/${ACHIEVEMENTS.length}** unlocked\n\u200b`)
    .addFields(
      { name: '📊 Your Stats', value: `Trades: **${trades.length}** • Wins: **${wins}** • Win Rate: **${winRate}%** • Current Streak: **${streak}**`, inline: false },
      { name: 'Progress', value: rows.slice(0, half).join('\n') || 'None yet', inline: false },
      { name: '\u200b', value: rows.slice(half).join('\n') || '\u200b', inline: false },
    )
    .setFooter({ text: 'Elevate 🪽 • Only you can see this' })
    .setTimestamp();
}

function computeStats(trades, verifiedWeeks = 0) {
  const wins = trades.filter(t => t.outcome?.toLowerCase().startsWith('w')).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;
  let streak = 0;
  for (let i = trades.length - 1; i >= 0; i--) {
    if (trades[i].outcome?.toLowerCase().startsWith('w')) streak++;
    else break;
  }
  return { total: trades.length, wins, winRate, streak, verifiedWeeks };
}

module.exports = { ACHIEVEMENTS, checkAchievements, buildAchievementsPanel, buildMyAchievements, computeStats };
