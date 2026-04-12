const {
  EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'levels.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: {}, shopMessageId: null, leaderboardMessageId: null }));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

function getUser(db, userId, username) {
  if (!db.users[userId]) {
    db.users[userId] = { username, xp: 0, level: 0, points: 0, inventory: [], rankMessageId: null, shopMessageId: null };
  }
  if (username) db.users[userId].username = username;
  return db.users[userId];
}

function xpForLevel(level) { return 100 * (level + 1) * (level + 1); }
function pointsForLevel(level) { return Math.floor(50 * level * 1.5); }

// ── Build rank card embed for a user ─────────────────────────────────────────
function buildRankEmbed(user, member, rank) {
  const nextLevelXP = xpForLevel(user.level);
  const progress = Math.min(10, Math.floor((user.xp / nextLevelXP) * 10));
  const bar = '█'.repeat(progress) + '░'.repeat(10 - progress);
  const levelEmoji = user.level >= 20 ? '💎' : user.level >= 10 ? '🔥' : user.level >= 5 ? '⭐' : '🪽';

  return new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setAuthor({
      name: member ? member.displayName : user.username,
      iconURL: member?.user.displayAvatarURL({ extension: 'png' }) || undefined,
    })
    .addFields(
      { name: `${levelEmoji} Level`, value: `**${user.level}**`, inline: true },
      { name: '💰 Points', value: `**${user.points}**`, inline: true },
      { name: '🏆 Rank', value: `**#${rank}**`, inline: true },
      { name: `✨ XP — ${user.xp} / ${nextLevelXP}`, value: `\`[${bar}]\``, inline: false },
    )
    .setFooter({ text: 'Elevate 🪽 • Levels' })
    .setTimestamp();
}

// ── Build shop balance card for a user ────────────────────────────────────────
function buildBalanceEmbed(user, member) {
  const inventory = user.inventory || [];
  const ownedNames = SHOP_ITEMS.filter(i => inventory.includes(i.id)).map(i => i.name);

  return new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setAuthor({
      name: member ? member.displayName : user.username,
      iconURL: member?.user.displayAvatarURL({ extension: 'png' }) || undefined,
    })
    .addFields(
      { name: '💰 Points Balance', value: `**${user.points} pts**`, inline: true },
      { name: '📦 Owned Items', value: ownedNames.length ? ownedNames.join(', ') : 'None yet', inline: true },
    )
    .setFooter({ text: 'Elevate 🪽 • Shop' })
    .setTimestamp();
}

// ── Post or update a user's rank card in levels channel ───────────────────────
async function updateUserRankCard(userId, guild) {
  try {
    const db = loadDB();
    const user = db.users[userId];
    if (!user) return;

    const levelsChannel = guild.channels.cache.get(process.env.LEVELS_CHANNEL_ID);
    if (!levelsChannel) return;

    const sorted = Object.entries(db.users).sort((a, b) => b[1].points - a[1].points);
    const rank = sorted.findIndex(([id]) => id === userId) + 1;

    let member = null;
    try { member = await guild.members.fetch(userId); } catch {}

    const embed = buildRankEmbed(user, member, rank);

    if (user.rankMessageId) {
      try {
        const msg = await levelsChannel.messages.fetch(user.rankMessageId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch { /* message deleted, repost */ }
    }

    const msg = await levelsChannel.send({ embeds: [embed] });
    user.rankMessageId = msg.id;
    saveDB(db);
  } catch (err) {
    console.error('❌ Rank card update error:', err);
  }
}

// ── Post or update a user's balance card in shop channel ──────────────────────
async function updateUserBalanceCard(userId, guild) {
  try {
    const db = loadDB();
    const user = db.users[userId];
    if (!user) return;

    const shopChannel = guild.channels.cache.get(process.env.SHOP_CHANNEL_ID);
    if (!shopChannel) return;

    let member = null;
    try { member = await guild.members.fetch(userId); } catch {}

    const embed = buildBalanceEmbed(user, member);

    if (user.shopCardMessageId) {
      try {
        const msg = await shopChannel.messages.fetch(user.shopCardMessageId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch {}
    }

    const msg = await shopChannel.send({ embeds: [embed] });
    user.shopCardMessageId = msg.id;
    saveDB(db);
  } catch (err) {
    console.error('❌ Balance card update error:', err);
  }
}

// ── Add XP and handle level ups ───────────────────────────────────────────────
async function addXP(userId, username, amount, guild) {
  const db = loadDB();
  const user = getUser(db, userId, username);
  user.xp += amount;

  let leveledUp = false;
  while (user.xp >= xpForLevel(user.level)) {
    user.xp -= xpForLevel(user.level);
    user.level += 1;
    const earned = pointsForLevel(user.level);
    user.points += earned;
    leveledUp = true;

    try {
      const ch = guild.channels.cache.get(process.env.LEVELS_CHANNEL_ID);
      if (ch) {
        let member = null;
        try { member = await guild.members.fetch(userId); } catch {}
        const embed = new EmbedBuilder()
          .setColor(0xF5F0E8)
          .setTitle('⬆️ Level Up!')
          .setDescription(
            `${member ? member : `<@${userId}>`} just reached **Level ${user.level}**! 🪽\n` +
            `+**${earned} points** added to your balance.`
          )
          .setThumbnail(member?.user.displayAvatarURL({ extension: 'png' }) || null)
          .setFooter({ text: 'Elevate 🪽 • Levels' })
          .setTimestamp();
        await ch.send({ embeds: [embed] });
      }
    } catch {}
  }

  saveDB(db);

  // Update this user's rank card and balance card
  await updateUserRankCard(userId, guild);
  await updateUserBalanceCard(userId, guild);

  // Update leaderboard top 3
  if (leveledUp) await updateLeaderboard(guild);

  return user;
}

// ── Boost reward ──────────────────────────────────────────────────────────────
async function handleBoost(member, guild) {
  const db = loadDB();
  const user = getUser(db, member.user.id, member.user.username);
  user.points += 500;
  saveDB(db);

  try {
    const ch = guild.channels.cache.get(process.env.LEVELS_CHANNEL_ID);
    if (ch) {
      const embed = new EmbedBuilder()
        .setColor(0xff73fa)
        .setTitle('🚀 Server Boost!')
        .setDescription(
          `${member} just boosted the server! 🎉\n` +
          `+**500 points** added to your balance. Thank you! 💜`
        )
        .setThumbnail(member.user.displayAvatarURL({ extension: 'png' }))
        .setFooter({ text: 'Elevate 🪽 • Boost Reward' })
        .setTimestamp();
      await ch.send({ embeds: [embed] });
    }
  } catch {}

  await updateUserRankCard(member.user.id, guild);
  await updateUserBalanceCard(member.user.id, guild);
  await updateLeaderboard(guild);
}

// ── Leaderboard top 3 ─────────────────────────────────────────────────────────
const MEDALS = ['🥇', '🥈', '🥉'];
const MEDAL_LABELS = ['GOLD', 'SILVER', 'BRONZE'];

async function updateLeaderboard(guild) {
  try {
    const ch = guild.channels.cache.get(process.env.LEVELS_CHANNEL_ID);
    if (!ch) return;

    const db = loadDB();
    const sorted = Object.entries(db.users)
      .sort((a, b) => b[1].points - a[1].points)
      .slice(0, 3);

    const embed = new EmbedBuilder()
      .setColor(0xF5F0E8)
      .setTitle('🏆 Elevate Leaderboard')
      .setDescription('> The top members of the community.\n\u200b');

    if (sorted.length === 0) {
      embed.addFields({ name: 'No data yet', value: 'Start chatting and leveling up!', inline: false });
    } else {
      for (let i = 0; i < sorted.length; i++) {
        const [uid, data] = sorted[i];
        let displayName = data.username;
        try {
          const member = await guild.members.fetch(uid).catch(() => null);
          if (member) displayName = member.displayName;
        } catch {}
        embed.addFields({
          name: `${MEDALS[i]} ${MEDAL_LABELS[i]} — ${displayName}`,
          value: `**${data.points} pts** • Level **${data.level}**`,
          inline: false,
        });
      }
    }

    embed
      .addFields({ name: '\u200b', value: 'Earn points by chatting, VC, boosting & leveling up! 🚀', inline: false })
      .setFooter({ text: 'Elevate 🪽 • Updates automatically' })
      .setTimestamp();

    if (db.leaderboardMessageId) {
      try {
        const msg = await ch.messages.fetch(db.leaderboardMessageId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch {}
    }

    const msg = await ch.send({ embeds: [embed] });
    await msg.pin().catch(() => {});
    db.leaderboardMessageId = msg.id;
    saveDB(db);
  } catch (err) {
    console.error('❌ Leaderboard error:', err);
  }
}

// ── Shop items ────────────────────────────────────────────────────────────────
const SHOP_ITEMS = [
  { id: 'color_gold',    name: '🌟 Gold Name',        price: 500,  description: 'Exclusive gold colored name role' },
  { id: 'color_red',     name: '🔴 Red Name',          price: 300,  description: 'Bold red colored name role' },
  { id: 'color_blue',    name: '🔵 Blue Name',         price: 300,  description: 'Cool blue colored name role' },
  { id: 'badge_elite',   name: '💎 Elite Badge',       price: 1000, description: 'Exclusive Elite member role badge' },
  { id: 'badge_veteran', name: '🎖️ Veteran Badge',    price: 750,  description: 'Veteran member role badge' },
  { id: 'badge_trader',  name: '📈 Top Trader Badge',  price: 500,  description: 'Top Trader role badge' },
];

// ── Shop pinned panel with buy buttons ───────────────────────────────────────
async function postShopPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('🛒 Elevate Shop')
    .setDescription(
      '> Spend your points on exclusive roles and badges.\n' +
      '> Click a button below to purchase. Only you can see the result.\n\n' +
      'Your personal balance card is posted below. 👇\n\u200b'
    );

  for (const item of SHOP_ITEMS) {
    embed.addFields({
      name: `${item.name} — ${item.price} pts`,
      value: item.description,
      inline: true,
    });
  }

  embed
    .addFields({ name: '\u200b', value: '💡 More items coming soon!\nEarn by leveling up, chatting, VC & boosting 🚀', inline: false })
    .setFooter({ text: 'Elevate 🪽 • Shop' })
    .setTimestamp();

  // Split into rows of 3 (Discord max 5 buttons per row, 5 rows)
  const rows = [];
  for (let i = 0; i < SHOP_ITEMS.length; i += 3) {
    const row = new ActionRowBuilder();
    SHOP_ITEMS.slice(i, i + 3).forEach(item => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`shop_buy_${item.id}`)
          .setLabel(`${item.name} — ${item.price} pts`)
          .setStyle(ButtonStyle.Secondary)
      );
    });
    rows.push(row);
  }

  const msg = await channel.send({ embeds: [embed], components: rows });
  await msg.pin().catch(() => {});

  const db = loadDB();
  db.shopMessageId = msg.id;
  saveDB(db);
  return msg;
}

// ── Handle buy (from button) ──────────────────────────────────────────────────
async function handleShopBuy(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });
  const itemId = interaction.customId.replace('shop_buy_', '');
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return interaction.editReply('❌ Item not found.');

  const db = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);

  if (user.inventory.includes(item.id)) return interaction.editReply('✅ You already own this!');
  if (user.points < item.price) {
    return interaction.editReply(`❌ Need **${item.price} pts** but you only have **${user.points} pts**.\nKeep leveling up to earn more! 🪽`);
  }

  user.points -= item.price;
  user.inventory.push(item.id);
  saveDB(db);

  try {
    const member = await guild.members.fetch(interaction.user.id);
    const roleName = item.name.replace(/[^\w\s]/g, '').trim().split(' ').slice(-2).join(' ');
    const role = guild.roles.cache.find(r => r.name.toLowerCase().includes(roleName.toLowerCase()));
    if (role) await member.roles.add(role);
  } catch {}

  await updateUserBalanceCard(interaction.user.id, guild);

  const embed = new EmbedBuilder()
    .setColor(0x00c853)
    .setTitle('✅ Purchase Successful!')
    .setDescription(`You bought **${item.name}** for **${item.price} pts**!\nNew balance: **${user.points} pts**`)
    .setFooter({ text: 'Elevate 🪽 • Shop' });

  await interaction.editReply({ embeds: [embed] });
}

// ── VC tracking ───────────────────────────────────────────────────────────────
const vcJoinTimes = new Map();

function handleVCJoin(member) {
  vcJoinTimes.set(member.user.id, Date.now());
}

async function handleVCLeave(member, guild) {
  const joinTime = vcJoinTimes.get(member.user.id);
  if (!joinTime) return;
  vcJoinTimes.delete(member.user.id);
  const minutes = Math.floor((Date.now() - joinTime) / 60000);
  if (minutes > 0) await addXP(member.user.id, member.user.username, minutes * 10, guild);
}

// ── Passive XP every 5 min ────────────────────────────────────────────────────
function startPassiveXP(client) {
  setInterval(async () => {
    try {
      for (const [, guild] of client.guilds.cache) {
        const db = loadDB();
        for (const [uid, data] of Object.entries(db.users)) {
          await addXP(uid, data.username, 2, guild);
        }
      }
    } catch {}
  }, 5 * 60 * 1000);
}

module.exports = {
  loadDB, saveDB, getUser, addXP, handleBoost,
  updateLeaderboard, updateUserRankCard, updateUserBalanceCard,
  postShopPanel, handleShopBuy,
  handleVCJoin, handleVCLeave, startPassiveXP,
  SHOP_ITEMS
};
