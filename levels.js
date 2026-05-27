const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getStore, markDirty } = require('./db');

function loadDB() {
  const store = getStore();
  if (!store.levels) store.levels = {};
  if (!store.levels.users) store.levels.users = {};
  return store.levels;
}
function saveDB(data) {
  const store = getStore();
  store.levels = data;
  markDirty();
}
async function initDB() {
  const { loadAll } = require('./db');
  await loadAll();
  const store = getStore();
  if (!store.levels) store.levels = {};
  if (!store.levels.users) store.levels.users = {};
  return store.levels;
}

function getUser(db, userId, username) {
  if (!db.users[userId]) db.users[userId] = { username, xp: 0, level: 0, points: 0, inventory: [], earnedBadges: [], equippedBought: null, equippedEarned: null };
  if (username) db.users[userId].username = username;
  if (!db.users[userId].earnedBadges) db.users[userId].earnedBadges = [];
  if (db.users[userId].equippedBought === undefined) db.users[userId].equippedBought = null;
  if (db.users[userId].equippedEarned === undefined) db.users[userId].equippedEarned = null;
  return db.users[userId];
}

function xpForLevel(level) { return 100 * (level + 1) * (level + 1); }
function pointsForLevel(level) { return Math.floor(50 * level * 1.5); }

const BUYABLE_BADGES = [
  { id: 'badge_rising',  name: '🌱 Rising Star', price: 1000,  boost: 0.05, description: '+5% XP boost on all earnings' },
  { id: 'badge_grinder', name: '⚡ Grinder',      price: 5000,  boost: 0.10, description: '+10% XP boost on all earnings' },
  { id: 'badge_veteran', name: '🌟 Veteran',       price: 10000, boost: 0.15, description: '+15% XP boost on all earnings' },
];

const EARNED_BADGES = [
  { id: 'earned_top1',     name: '🥇 Top 1',          description: 'Reached #1 on the leaderboard' },
  { id: 'earned_top2',     name: '🥈 Top 2',           description: 'Reached #2 on the leaderboard' },
  { id: 'earned_top3',     name: '🥉 Top 3',           description: 'Reached top 3 on the leaderboard' },
  { id: 'earned_booster',  name: '🚀 Elevate Booster', description: 'Boosted the Elevate server' },
  { id: 'earned_level5',   name: '⭐ Level 5',          description: 'Reached Level 5' },
  { id: 'earned_level10',  name: '🌟 Level 10',         description: 'Reached Level 10' },
  { id: 'earned_level20',  name: '💫 Level 20',         description: 'Reached Level 20' },
  { id: 'earned_level50',  name: '👑 Level 50',         description: 'Reached Level 50' },
  { id: 'earned_level100', name: '💎 Level 100',        description: 'Reached Level 100' },
];

const SHOP_ROLES = [
  { id: 'role_gold',     name: '🌟 Elevate Gold',    price: 2000,  roleName: 'Elevate Gold🪽',     tier: 1 },
  { id: 'role_platinum', name: '💠 Elevate Platinum', price: 5000,  roleName: 'Elevate Platinum🪽', tier: 2 },
  { id: 'role_elite',    name: '👑 Elevate Elite',    price: 10000, roleName: 'Elevate Elite🪽',    tier: 3 },
];

const MEDALS = ['🥇', '🥈', '🥉'];

function getUserBadgeIcons(user) {
  const icons = [];
  if (user.equippedEarned) { const b = EARNED_BADGES.find(b => b.id === user.equippedEarned); if (b) icons.push(b.name.split(' ')[0]); }
  if (user.equippedBought) { const b = BUYABLE_BADGES.find(b => b.id === user.equippedBought); if (b) icons.push(b.name.split(' ')[0]); }
  return icons.join(' ');
}

function getXPMultiplier(user) {
  if (!user.equippedBought) return 1;
  const badge = BUYABLE_BADGES.find(b => b.id === user.equippedBought);
  return badge ? 1 + badge.boost : 1;
}

async function awardEarnedBadge(userId, badgeId, guild) {
  const db = loadDB();
  const user = db.users[userId];
  if (!user || user.earnedBadges.includes(badgeId)) return;
  user.earnedBadges.push(badgeId);
  const badge = EARNED_BADGES.find(b => b.id === badgeId);
  saveDB(db);
  try {
    const ch = guild.channels.cache.get(process.env.LEVELS_CHANNEL_ID);
    if (ch && badge) {
      const member = await guild.members.fetch(userId).catch(() => null);
      const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle(`${badge.name.split(' ')[0]} Badge Earned!`)
        .setDescription(`${member || `<@${userId}>`} earned the **${badge.name}** badge! 🪽\n*${badge.description}*`)
        .setThumbnail(member?.user.displayAvatarURL({ extension: 'png' }) || null)
        .setFooter({ text: 'Elevate 🪽 • Earned Badge' })
        .setTimestamp();
      await ch.send({ embeds: [embed] });
    }
  } catch {}
}

async function addXP(userId, username, amount, guild) {
  const db = loadDB();
  const user = getUser(db, userId, username);
  const multiplier = getXPMultiplier(user);
  user.xp += Math.floor(amount * multiplier);

  const levelMilestones = { 5: 'earned_level5', 10: 'earned_level10', 20: 'earned_level20', 50: 'earned_level50', 100: 'earned_level100' };

  while (user.xp >= xpForLevel(user.level)) {
    user.xp -= xpForLevel(user.level);
    user.level += 1;
    const earned = pointsForLevel(user.level);
    user.points += earned;
    try {
      const ch = guild.channels.cache.get(process.env.LEVELS_CHANNEL_ID);
      if (ch) {
        const member = await guild.members.fetch(userId).catch(() => null);
        const icons = getUserBadgeIcons(user);
        const lvlEmoji = user.level >= 100 ? '💎' : user.level >= 50 ? '👑' : user.level >= 20 ? '💫' : user.level >= 10 ? '🌟' : user.level >= 5 ? '⭐' : '⬆️';
        const embed = new EmbedBuilder()
          .setColor(0xF5F0E8)
          .setTitle(`${lvlEmoji} Level Up!`)
          .setDescription(`${member || `<@${userId}>`} ${icons} just reached **Level ${user.level}**! 🪽\n+**${earned} points** added to your balance.`)
          .setThumbnail(member?.user.displayAvatarURL({ extension: 'png' }) || null)
          .setFooter({ text: 'Elevate 🪽 • Levels' })
          .setTimestamp();
        await ch.send({ embeds: [embed] });
      }
    } catch {}
    if (levelMilestones[user.level]) { saveDB(db); await awardEarnedBadge(userId, levelMilestones[user.level], guild); }
  }
  saveDB(db);
  await updateLeaderboard(guild);
  return user;
}

async function handleBoost(member, guild) {
  const db = loadDB();
  const user = getUser(db, member.user.id, member.user.username);
  user.points += 500;
  saveDB(db);
  await awardEarnedBadge(member.user.id, 'earned_booster', guild);
  try {
    const ch = guild.channels.cache.get(process.env.LEVELS_CHANNEL_ID);
    if (ch) {
      const icons = getUserBadgeIcons(user);
      const embed = new EmbedBuilder().setColor(0xff73fa).setTitle('🚀 Server Boost!')
        .setDescription(`${member} ${icons} just boosted the server! 🎉\n+**500 points** added to your balance. Thank you! 💜`)
        .setThumbnail(member.user.displayAvatarURL({ extension: 'png' }))
        .setFooter({ text: 'Elevate 🪽 • Boost Reward' }).setTimestamp();
      await ch.send({ embeds: [embed] });
    }
  } catch {}
  await updateLeaderboard(guild);
}

async function updateLeaderboard(guild) {
  try {
    const ch = guild.channels.cache.get(process.env.LEADERBOARD_CHANNEL_ID);
    if (!ch) return;
    const db = loadDB();
    const sorted = Object.entries(db.users).sort((a, b) => b[1].points - a[1].points).slice(0, 5);
    const embed = new EmbedBuilder().setColor(0xF5F0E8).setTitle('🏆 Elevate Leaderboard').setDescription('> The top members of the community.\n\u200b');
    if (sorted.length === 0) {
      embed.addFields({ name: 'No data yet', value: 'Start chatting and leveling up!', inline: false });
    } else {
      for (let i = 0; i < sorted.length; i++) {
        const [uid, data] = sorted[i];
        let displayName = data.username;
        try { const m = await guild.members.fetch(uid).catch(() => null); if (m) displayName = m.displayName; } catch {}
        const badgeTags = [];
        if (data.equippedEarned) { const b = EARNED_BADGES.find(b => b.id === data.equippedEarned); if (b) badgeTags.push(`\`${b.name}\``); }
        if (data.equippedBought) { const b = BUYABLE_BADGES.find(b => b.id === data.equippedBought); if (b) badgeTags.push(`\`${b.name}\``); }
        const badgeStr = badgeTags.length ? `  ${badgeTags.join('  ')}` : '';
        const medal = i < 3 ? MEDALS[i] : '';
        embed.addFields({
          name: `${medal}**${i + 1}.**  ${displayName}${badgeStr}`,
          value: `┕ **${data.points} pts**  •  Level **${data.level}**`,
          inline: false,
        });
      }
    }
    embed.addFields({ name: '\u200b', value: 'Earn points by chatting, VC, boosting, leveling up & using the trading journal! 🚀\nTop 3 earn exclusive badges 👑', inline: false })
      .setFooter({ text: 'Elevate 🪽 • Updates automatically' }).setTimestamp();

    for (let i = 0; i < Math.min(3, sorted.length); i++) {
      await awardEarnedBadge(sorted[i][0], ['earned_top1','earned_top2','earned_top3'][i], guild);
    }

    if (db.leaderboardMessageId) {
      try { const msg = await ch.messages.fetch(db.leaderboardMessageId); await msg.edit({ embeds: [embed] }); return; } catch {}
    }
    try {
      const pinned = await ch.messages.fetchPinned();
      const existing = pinned.find(m => m.author.id === guild.client.user.id && m.embeds?.[0]?.title === '🏆 Elevate Leaderboard');
      if (existing) { await existing.edit({ embeds: [embed] }); db.leaderboardMessageId = existing.id; saveDB(db); return; }
    } catch {}
    const msg = await ch.send({ embeds: [embed] });
    await msg.pin().catch(() => {});
    db.leaderboardMessageId = msg.id;
    saveDB(db);
  } catch (err) { console.error('❌ Leaderboard error:', err); }
}

async function postLevelsPanel(channel) {
  const embed = new EmbedBuilder().setColor(0xF5F0E8).setTitle('📊 Your Rank')
    .setDescription('> Click the button below to privately check your level, XP, rank and points.\n> Only **you** can see your stats.\n\u200b')
    .addFields(
      { name: '💬 Chat', value: '+5 XP per message', inline: true },
      { name: '🎙️ Voice', value: '+10 XP per minute', inline: true },
      { name: '🚀 Boost', value: '+500 points instantly', inline: true },
      { name: '📝 Trade Log', value: '+75 XP per trade', inline: true },
      { name: '🏆 Achievements', value: '+100–200 XP each', inline: true },
    )
    .setFooter({ text: 'Elevate 🪽 • Levels' }).setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('levels_check_rank').setLabel('📊 Check My Rank').setStyle(ButtonStyle.Secondary)
  );
  const msg = await channel.send({ embeds: [embed], components: [row] });
  await msg.pin().catch(() => {});
  const db = loadDB(); db.levelsPanelMessageId = msg.id; saveDB(db);
  return msg;
}

async function handleCheckRank(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });
  const db = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);
  saveDB(db);
  const sorted = Object.entries(db.users).sort((a, b) => b[1].points - a[1].points);
  const rank = sorted.findIndex(([id]) => id === interaction.user.id) + 1;
  const nextLevelXP = xpForLevel(user.level);
  const progress = Math.min(10, Math.floor((user.xp / nextLevelXP) * 10));
  const bar = '█'.repeat(progress) + '░'.repeat(10 - progress);
  const lvlEmoji = user.level >= 100 ? '💎' : user.level >= 50 ? '👑' : user.level >= 20 ? '💫' : user.level >= 10 ? '🌟' : user.level >= 5 ? '⭐' : '🪽';
  const equippedEarned = user.equippedEarned ? EARNED_BADGES.find(b => b.id === user.equippedEarned)?.name : 'None';
  const equippedBought = user.equippedBought ? BUYABLE_BADGES.find(b => b.id === user.equippedBought)?.name : 'None';
  const multiplier = getXPMultiplier(user);
  const boostStr = multiplier > 1 ? `+${Math.round((multiplier - 1) * 100)}% XP` : 'No boost';
  const embed = new EmbedBuilder().setColor(0xF5F0E8).setTitle(`${lvlEmoji} Your Rank`)
    .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png' }))
    .addFields(
      { name: '⬆️ Level', value: `**${user.level}**`, inline: true },
      { name: '💰 Points', value: `**${user.points}**`, inline: true },
      { name: '🏆 Server Rank', value: `**#${rank}**`, inline: true },
      { name: `✨ XP — ${user.xp} / ${nextLevelXP}`, value: `\`[${bar}]\``, inline: false },
      { name: '🎖️ Slot 1 — Earned Badge', value: equippedEarned, inline: true },
      { name: '🏅 Slot 2 — Bought Badge', value: `${equippedBought} (${boostStr})`, inline: true },
    )
    .setFooter({ text: 'Elevate 🪽 • Only you can see this' }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function postShopPanel(channel) {
  // Message 1: Main info + utility buttons
  const mainEmbed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('🛒 Elevate Shop')
    .setDescription(
      '> Spend your points on exclusive roles and badges.\n' +
      '> **Earned badges** are stronger and cannot be bought — they must be unlocked.\n\u200b'
    )
    .addFields(
      { name: '🎖️ Earned Badges (Slot 1) — cannot be bought', value: ['**🥇 Top 1 / 🥈 Top 2 / 🥉 Top 3** — Reach top 3 on the leaderboard', '**🚀 Elevate Booster** — Boost the server', '**⭐ Lvl 5 / 🌟 Lvl 10 / 💫 Lvl 20 / 👑 Lvl 50 / 💎 Lvl 100**'].join('\n'), inline: false },
      { name: '📋 Badge Rules', value: '• Max **1 earned** (Slot 1) + **1 bought** (Slot 2) equipped\n• Earned badges appear in bot messages\n• Use equip buttons below to swap', inline: false },
      { name: '\u200b', value: '💡 More items coming soon! Earn by leveling up, chatting, VC, trading & boosting 🚀', inline: false }
    )
    .setFooter({ text: 'Elevate 🪽 • Shop' })
    .setTimestamp();

  const utilRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('shop_check_balance').setLabel('💰 Check My Balance').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shop_slot1').setLabel('🎖️ Equip Earned Badge').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shop_slot2').setLabel('🏅 Equip Bought Badge').setStyle(ButtonStyle.Secondary),
  );

  // Message 2: Roles embed + role buy buttons
  const rolesEmbed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎭 Member Roles')
    .setDescription('Purchase an exclusive member role. Only your **highest owned** tier will be shown.\n\u200b')
    .addFields(
      ...SHOP_ROLES.map(r => ({
        name: `${r.name} — ${r.price.toLocaleString()} pts`,
        value: r.id === 'role_gold' ? 'Entry tier gold member role' : r.id === 'role_platinum' ? 'Mid tier platinum member role' : 'Top tier elite member role',
        inline: true,
      }))
    );

  const roleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('shop_buy_role_gold').setLabel('🌟 Gold — 2,000 pts').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('shop_buy_role_platinum').setLabel('💠 Platinum — 5,000 pts').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('shop_buy_role_elite').setLabel('👑 Elite — 10,000 pts').setStyle(ButtonStyle.Primary),
  );

  // Message 3: XP Boosts embed + badge buy buttons
  const badgesEmbed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('🏅 XP Boost Badges (Slot 2)')
    .setDescription('Purchase a badge that boosts all XP you earn. Equip in **Slot 2**.\n\u200b')
    .addFields(
      ...BUYABLE_BADGES.map(b => ({
        name: `${b.name} — ${b.price.toLocaleString()} pts`,
        value: b.description,
        inline: true,
      }))
    );

  const badgeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('shop_buy_badge_rising').setLabel('🌱 Rising Star — 1,000 pts').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shop_buy_badge_grinder').setLabel('⚡ Grinder — 5,000 pts').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shop_buy_badge_veteran').setLabel('🌟 Veteran — 10,000 pts').setStyle(ButtonStyle.Secondary),
  );

  const msg1 = await channel.send({ embeds: [mainEmbed], components: [utilRow] });
  await channel.send({ embeds: [rolesEmbed], components: [roleRow] });
  await channel.send({ embeds: [badgesEmbed], components: [badgeRow] });
  await msg1.pin().catch(() => {});

  const db = loadDB(); db.shopMessageId = msg1.id; saveDB(db);
  return msg1;
}

async function handleCheckBalance(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const db = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);
  saveDB(db);
  const ownedRoles = SHOP_ROLES.filter(r => user.inventory.includes(r.id)).map(r => r.name);
  const ownedBadges = BUYABLE_BADGES.filter(b => user.inventory.includes(b.id)).map(b => b.name);
  const earnedList = EARNED_BADGES.filter(b => user.earnedBadges.includes(b.id)).map(b => b.name);
  const embed = new EmbedBuilder().setColor(0xF5F0E8).setTitle('💰 Your Balance')
    .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png' }))
    .addFields(
      { name: '💰 Points', value: `**${user.points} pts**`, inline: true },
      { name: '⬆️ Level', value: `**${user.level}**`, inline: true },
      { name: '🎭 Owned Roles', value: ownedRoles.length ? ownedRoles.join('\n') : 'None', inline: false },
      { name: '🏅 Owned Buyable Badges', value: ownedBadges.length ? ownedBadges.join('\n') : 'None', inline: true },
      { name: '🎖️ Earned Badges', value: earnedList.length ? earnedList.join('\n') : 'None yet', inline: true },
    )
    .setFooter({ text: 'Elevate 🪽 • Only you can see this' }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleSlot1(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const db = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);
  const available = EARNED_BADGES.filter(b => user.earnedBadges.includes(b.id));
  if (available.length === 0) return interaction.editReply('❌ No earned badges yet. Level up, boost the server, or reach top 3!');
  const options = available.map(b => ({ label: b.name, description: b.description, value: b.id }));
  if (user.equippedEarned) options.unshift({ label: '❌ Unequip', description: 'Remove equipped earned badge', value: 'unequip' });
  const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('shop_equip_earned').setPlaceholder('Choose an earned badge...').addOptions(options));
  await interaction.editReply({ content: '🎖️ **Slot 1 — Equip Earned Badge**', components: [row] });
}

async function handleSlot2(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const db = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);
  const available = BUYABLE_BADGES.filter(b => user.inventory.includes(b.id));
  if (available.length === 0) return interaction.editReply('❌ No bought badges yet. Purchase one from the shop!');
  const options = available.map(b => ({ label: b.name, description: b.description, value: b.id }));
  if (user.equippedBought) options.unshift({ label: '❌ Unequip', description: 'Remove equipped badge', value: 'unequip' });
  const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('shop_equip_bought').setPlaceholder('Choose a badge...').addOptions(options));
  await interaction.editReply({ content: '🏅 **Slot 2 — Equip Bought Badge**', components: [row] });
}

async function handleEquipSelect(interaction) {
  await interaction.deferUpdate();
  const db = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);
  const value = interaction.values[0];
  if (interaction.customId === 'shop_equip_earned') {
    user.equippedEarned = value === 'unequip' ? null : value;
    const badge = value === 'unequip' ? null : EARNED_BADGES.find(b => b.id === value);
    saveDB(db);
    await interaction.editReply({ content: value === 'unequip' ? '✅ Earned badge unequipped.' : `✅ **${badge.name}** equipped in Slot 1!`, components: [] });
  }
  if (interaction.customId === 'shop_equip_bought') {
    user.equippedBought = value === 'unequip' ? null : value;
    const badge = value === 'unequip' ? null : BUYABLE_BADGES.find(b => b.id === value);
    saveDB(db);
    await interaction.editReply({ content: value === 'unequip' ? '✅ Badge unequipped.' : `✅ **${badge.name}** equipped in Slot 2!`, components: [] });
  }
}

async function handleShopBuy(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });
  const itemId = interaction.customId.replace('shop_buy_', '');
  const role = SHOP_ROLES.find(r => r.id === itemId);
  const badge = BUYABLE_BADGES.find(b => b.id === itemId);
  const item = role || badge;
  if (!item) return interaction.editReply('❌ Item not found.');
  const db = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);
  if (user.inventory.includes(item.id)) return interaction.editReply('✅ You already own this!');
  if (user.points < item.price) return interaction.editReply(`❌ Need **${item.price} pts** but you have **${user.points} pts**. Keep leveling up! 🪽`);
  user.points -= item.price;
  user.inventory.push(item.id);
  saveDB(db);
  if (role) {
    try {
      const member = await guild.members.fetch(interaction.user.id);
      for (const r of SHOP_ROLES) {
        const dr = guild.roles.cache.find(gr => gr.name === r.roleName);
        if (dr && member.roles.cache.has(dr.id)) await member.roles.remove(dr).catch(() => {});
      }
      const ownedRoles = SHOP_ROLES.filter(r => user.inventory.includes(r.id)).sort((a, b) => b.tier - a.tier)[0];
      if (ownedRoles) {
        const discordRole = guild.roles.cache.find(gr => gr.name === ownedRoles.roleName);
        if (discordRole) await member.roles.add(discordRole).catch(() => {});
      }
    } catch (err) { console.error('Role assign error:', err); }
  }
  const embed = new EmbedBuilder().setColor(0x00c853).setTitle('✅ Purchase Successful!')
    .setDescription(`You bought **${item.name}** for **${item.price} pts**!\nNew balance: **${user.points} pts**${badge ? '\n\nUse **Slot 2** button to equip!' : ''}`)
    .setFooter({ text: 'Elevate 🪽 • Only you can see this' });
  await interaction.editReply({ embeds: [embed] });
}

const vcJoinTimes = new Map();
function handleVCJoin(member) { vcJoinTimes.set(member.user.id, Date.now()); }
async function handleVCLeave(member, guild) {
  const joinTime = vcJoinTimes.get(member.user.id);
  if (!joinTime) return;
  vcJoinTimes.delete(member.user.id);
  const minutes = Math.floor((Date.now() - joinTime) / 60000);
  if (minutes > 0) await addXP(member.user.id, member.user.username, minutes * 10, guild);
}

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
  loadDB, saveDB, getUser, initDB, addXP, handleBoost,
  updateLeaderboard, postLevelsPanel, postShopPanel,
  handleCheckRank, handleCheckBalance,
  handleSlot1, handleSlot2, handleEquipSelect, handleShopBuy,
  handleVCJoin, handleVCLeave, startPassiveXP,
};
