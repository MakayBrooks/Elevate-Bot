const {
  EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'levels.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: {}, leaderboardMessageId: null, shopMessageId: null }));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

function getUser(db, userId, username) {
  if (!db.users[userId]) {
    db.users[userId] = {
      username, xp: 0, level: 0, points: 0,
      inventory: [], earnedBadges: [],
      equippedBought: null, equippedEarned: null
    };
  }
  if (username) db.users[userId].username = username;
  if (!db.users[userId].earnedBadges) db.users[userId].earnedBadges = [];
  if (db.users[userId].equippedBought === undefined) db.users[userId].equippedBought = null;
  if (db.users[userId].equippedEarned === undefined) db.users[userId].equippedEarned = null;
  return db.users[userId];
}

function xpForLevel(level) { return 100 * (level + 1) * (level + 1); }
function pointsForLevel(level) { return Math.floor(50 * level * 1.5); }

// ── Buyable badges (slot 1) ───────────────────────────────────────────────────
const BUYABLE_BADGES = [
  { id: 'badge_rising',   name: '🌱 Rising Star',  price: 300,  boost: 0.05, description: '+5% XP boost on all earnings' },
  { id: 'badge_grinder',  name: '⚡ Grinder',       price: 600,  boost: 0.10, description: '+10% XP boost on all earnings' },
  { id: 'badge_veteran',  name: '🌟 Veteran',        price: 1000, boost: 0.15, description: '+15% XP boost on all earnings' },
];

// ── Earned badges (slot 2) ────────────────────────────────────────────────────
const EARNED_BADGES = [
  { id: 'earned_top1',      name: '🥇 Top 1',            description: 'Reached #1 on the leaderboard' },
  { id: 'earned_top2',      name: '🥈 Top 2',             description: 'Reached #2 on the leaderboard' },
  { id: 'earned_top3',      name: '🥉 Top 3',             description: 'Reached top 3 on the leaderboard' },
  { id: 'earned_booster',   name: '🚀 Elevate Booster',   description: 'Boosted the Elevate server' },
  { id: 'earned_level5',    name: '⭐ Level 5',            description: 'Reached Level 5' },
  { id: 'earned_level10',   name: '🌟 Level 10',           description: 'Reached Level 10' },
  { id: 'earned_level20',   name: '💫 Level 20',           description: 'Reached Level 20' },
  { id: 'earned_level50',   name: '👑 Level 50',           description: 'Reached Level 50' },
  { id: 'earned_level100',  name: '💎 Level 100',          description: 'Reached Level 100' },
];

// ── Shop roles ────────────────────────────────────────────────────────────────
const SHOP_ROLES = [
  { id: 'role_gold',     name: '🌟 Elevate Gold',     price: 500,  roleName: 'Elevate Gold🪽',     tier: 1 },
  { id: 'role_platinum', name: '💠 Elevate Platinum',  price: 1000, roleName: 'Elevate Platinum🪽', tier: 2 },
  { id: 'role_elite',    name: '👑 Elevate Elite',     price: 2000, roleName: 'Elevate Elite🪽',    tier: 3 },
];

// ── Get badge display icon for bot messages ───────────────────────────────────
function getUserBadgeIcons(user) {
  const icons = [];
  if (user.equippedEarned) {
    const b = EARNED_BADGES.find(b => b.id === user.equippedEarned);
    if (b) icons.push(b.name.split(' ')[0]);
  }
  if (user.equippedBought) {
    const b = BUYABLE_BADGES.find(b => b.id === user.equippedBought);
    if (b) icons.push(b.name.split(' ')[0]);
  }
  return icons.join(' ');
}

// ── Get XP multiplier for a user ─────────────────────────────────────────────
function getXPMultiplier(user) {
  if (!user.equippedBought) return 1;
  const badge = BUYABLE_BADGES.find(b => b.id === user.equippedBought);
  return badge ? 1 + badge.boost : 1;
}

// ── Award earned badge ────────────────────────────────────────────────────────
async function awardEarnedBadge(userId, badgeId, guild) {
  const db = loadDB();
  const user = db.users[userId];
  if (!user) return;
  if (user.earnedBadges.includes(badgeId)) return;

  user.earnedBadges.push(badgeId);
  const badge = EARNED_BADGES.find(b => b.id === badgeId);
  saveDB(db);

  try {
    const ch = guild.channels.cache.get(process.env.LEVELS_CHANNEL_ID);
    if (ch && badge) {
      const member = await guild.members.fetch(userId).catch(() => null);
      const icons = getUserBadgeIcons(user);
      const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle(`${badge.name.split(' ')[0]} Badge Earned!`)
        .setDescription(
          `${member || `<@${userId}>`} ${icons} earned the **${badge.name}** badge! 🪽\n` +
          `*${badge.description}*`
        )
        .setThumbnail(member?.user.displayAvatarURL({ extension: 'png' }) || null)
        .setFooter({ text: 'Elevate 🪽 • Earned Badge' })
        .setTimestamp();
      await ch.send({ embeds: [embed] });
    }
  } catch {}
}

// ── Add XP with boost multiplier ──────────────────────────────────────────────
async function addXP(userId, username, amount, guild) {
  const db = loadDB();
  const user = getUser(db, userId, username);

  const multiplier = getXPMultiplier(user);
  const boosted = Math.floor(amount * multiplier);
  user.xp += boosted;

  const levelMilestones = { 5: 'earned_level5', 10: 'earned_level10', 20: 'earned_level20', 50: 'earned_level50', 100: 'earned_level100' };

  while (user.xp >= xpForLevel(user.level)) {
    user.xp -= xpForLevel(user.level);
    user.level += 1;
    const earned = pointsForLevel(user.level);
    user.points += earned;

    // Level up announcement
    try {
      const ch = guild.channels.cache.get(process.env.LEVELS_CHANNEL_ID);
      if (ch) {
        const member = await guild.members.fetch(userId).catch(() => null);
        const icons = getUserBadgeIcons(user);
        const lvlEmoji = user.level >= 100 ? '💎' : user.level >= 50 ? '👑' : user.level >= 20 ? '💫' : user.level >= 10 ? '🌟' : user.level >= 5 ? '⭐' : '⬆️';
        const embed = new EmbedBuilder()
          .setColor(0xF5F0E8)
          .setTitle(`${lvlEmoji} Level Up!`)
          .setDescription(
            `${member || `<@${userId}>`} ${icons} just reached **Level ${user.level}**! 🪽\n` +
            `+**${earned} points** added to your balance.`
          )
          .setThumbnail(member?.user.displayAvatarURL({ extension: 'png' }) || null)
          .setFooter({ text: 'Elevate 🪽 • Levels' })
          .setTimestamp();
        await ch.send({ embeds: [embed] });
      }
    } catch {}

    // Award level milestone badges
    if (levelMilestones[user.level]) {
      saveDB(db);
      await awardEarnedBadge(userId, levelMilestones[user.level], guild);
    }
  }

  saveDB(db);
  await updateLeaderboard(guild);
  return user;
}

// ── Boost reward ──────────────────────────────────────────────────────────────
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
      const embed = new EmbedBuilder()
        .setColor(0xff73fa)
        .setTitle('🚀 Server Boost!')
        .setDescription(
          `${member} ${icons} just boosted the server! 🎉\n` +
          `+**500 points** added to your balance. Thank you! 💜`
        )
        .setThumbnail(member.user.displayAvatarURL({ extension: 'png' }))
        .setFooter({ text: 'Elevate 🪽 • Boost Reward' })
        .setTimestamp();
      await ch.send({ embeds: [embed] });
    }
  } catch {}

  await updateLeaderboard(guild);
}

// ── Leaderboard top 5 ─────────────────────────────────────────────────────────
const MEDALS = ['🥇', '🥈', '🥉'];

async function updateLeaderboard(guild) {
  try {
    const ch = guild.channels.cache.get(process.env.LEADERBOARD_CHANNEL_ID);
    if (!ch) return;

    const db = loadDB();
    const sorted = Object.entries(db.users)
      .sort((a, b) => b[1].points - a[1].points)
      .slice(0, 5);

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
        const icons = getUserBadgeIcons(data);
        const prefix = i < 3 ? MEDALS[i] : `**${i + 1}.**`;
        embed.addFields({
          name: `${prefix} ${displayName} ${icons}`,
          value: `**${data.points} pts** • Level **${data.level}**`,
          inline: false,
        });
      }
    }

    embed
      .addFields({ name: '\u200b', value: 'Earn points by chatting, VC, boosting & leveling up! 🚀\nTop 3 earn exclusive badges 👑', inline: false })
      .setFooter({ text: 'Elevate 🪽 • Updates automatically' })
      .setTimestamp();

    // Award top 3 earned badges
    for (let i = 0; i < Math.min(3, sorted.length); i++) {
      const badgeIds = ['earned_top1', 'earned_top2', 'earned_top3'];
      await awardEarnedBadge(sorted[i][0], badgeIds[i], guild);
    }

    // Try to edit existing pinned message
    if (db.leaderboardMessageId) {
      try {
        const msg = await ch.messages.fetch(db.leaderboardMessageId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch {}
    }
    try {
      const pinned = await ch.messages.fetchPinned();
      const existing = pinned.find(m =>
        m.author.id === guild.client.user.id &&
        m.embeds?.[0]?.title === '🏆 Elevate Leaderboard'
      );
      if (existing) {
        await existing.edit({ embeds: [embed] });
        db.leaderboardMessageId = existing.id;
        saveDB(db);
        return;
      }
    } catch {}

    const msg = await ch.send({ embeds: [embed] });
    await msg.pin().catch(() => {});
    db.leaderboardMessageId = msg.id;
    saveDB(db);
  } catch (err) {
    console.error('❌ Leaderboard error:', err);
  }
}

// ── Levels panel (leaderboard channel) ───────────────────────────────────────
async function postLevelsPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('📊 Your Rank')
    .setDescription(
      '> Click the button below to privately check your level, XP, rank and points.\n' +
      '> Only **you** can see your stats.\n\u200b'
    )
    .addFields(
      { name: '💬 Chat', value: '+5 XP per message', inline: true },
      { name: '🎙️ Voice', value: '+10 XP per minute', inline: true },
      { name: '🚀 Boost', value: '+500 points instantly', inline: true },
    )
    .setFooter({ text: 'Elevate 🪽 • Levels' })
    .setTimestamp();

  const button = new ButtonBuilder()
    .setCustomId('levels_check_rank')
    .setLabel('📊 Check My Rank')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(button);
  const msg = await channel.send({ embeds: [embed], components: [row] });
  await msg.pin().catch(() => {});

  const db = loadDB();
  db.levelsPanelMessageId = msg.id;
  saveDB(db);
  return msg;
}

// ── Handle Check My Rank ──────────────────────────────────────────────────────
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
  const levelEmoji = user.level >= 100 ? '💎' : user.level >= 50 ? '👑' : user.level >= 20 ? '💫' : user.level >= 10 ? '🌟' : user.level >= 5 ? '⭐' : '🪽';

  const equippedEarned = user.equippedEarned ? EARNED_BADGES.find(b => b.id === user.equippedEarned)?.name : 'None';
  const equippedBought = user.equippedBought ? BUYABLE_BADGES.find(b => b.id === user.equippedBought)?.name : 'None';
  const multiplier = getXPMultiplier(user);
  const boostStr = multiplier > 1 ? `+${Math.round((multiplier - 1) * 100)}% XP` : 'No boost';

  const embed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle(`${levelEmoji} Your Rank`)
    .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png' }))
    .addFields(
      { name: '⬆️ Level', value: `**${user.level}**`, inline: true },
      { name: '💰 Points', value: `**${user.points}**`, inline: true },
      { name: '🏆 Server Rank', value: `**#${rank}**`, inline: true },
      { name: `✨ XP — ${user.xp} / ${nextLevelXP}`, value: `\`[${bar}]\``, inline: false },
      { name: '🎖️ Slot 1 — Earned Badge', value: equippedEarned, inline: true },
      { name: '🏅 Slot 2 — Bought Badge', value: `${equippedBought} (${boostStr})`, inline: true },
    )
    .setFooter({ text: 'Elevate 🪽 • Only you can see this' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ── Shop panel ────────────────────────────────────────────────────────────────
async function postShopPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('🛒 Elevate Shop')
    .setDescription(
      '> Spend your points on exclusive roles and badges.\n' +
      '> **Earned badges** are stronger and cannot be bought — they must be unlocked.\n' +
      '> Click **Check My Balance** to see your points privately.\n\u200b'
    )
    .addFields(
      {
        name: '🎭 Roles',
        value: SHOP_ROLES.map(r => `**${r.name}** — ${r.price} pts`).join('\n'),
        inline: false
      },
      {
        name: '🏅 Buyable Badges (Slot 2) — add XP boosts',
        value: BUYABLE_BADGES.map(b => `**${b.name}** — ${b.price} pts • ${b.description}`).join('\n'),
        inline: false
      },
      {
        name: '🎖️ Earned Badges (Slot 1) — stronger, cannot be bought',
        value: [
          '**🥇 Top 1 / 🥈 Top 2 / 🥉 Top 3** — Reach top 3 on the leaderboard',
          '**🚀 Elevate Booster** — Boost the server',
          '**⭐ Level 5 / 🌟 Level 10 / 💫 Level 20 / 👑 Level 50 / 💎 Level 100**',
        ].join('\n'),
        inline: false
      },
      {
        name: '📋 Badge Rules',
        value: '• Max **1 earned badge** (Slot 1) + **1 bought badge** (Slot 2) equipped\n• Earned badges show in all bot messages\n• Click the badge slots below to equip/swap',
        inline: false
      }
    )
    .setFooter({ text: 'Elevate 🪽 • Shop' })
    .setTimestamp();

  const balanceBtn = new ButtonBuilder()
    .setCustomId('shop_check_balance')
    .setLabel('💰 Check My Balance')
    .setStyle(ButtonStyle.Secondary);

  const slot1Btn = new ButtonBuilder()
    .setCustomId('shop_slot1')
    .setLabel('🎖️ Slot 1 — Equip Earned Badge')
    .setStyle(ButtonStyle.Success);

  const slot2Btn = new ButtonBuilder()
    .setCustomId('shop_slot2')
    .setLabel('🏅 Slot 2 — Equip Bought Badge')
    .setStyle(ButtonStyle.Primary);

  const utilRow = new ActionRowBuilder().addComponents(balanceBtn, slot1Btn, slot2Btn);

  // Role buy buttons
  const roleRow = new ActionRowBuilder();
  SHOP_ROLES.forEach(r => {
    roleRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`shop_buy_${r.id}`)
        .setLabel(`${r.name} — ${r.price} pts`)
        .setStyle(ButtonStyle.Secondary)
    );
  });

  // Badge buy buttons
  const badgeRow = new ActionRowBuilder();
  BUYABLE_BADGES.forEach(b => {
    badgeRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`shop_buy_${b.id}`)
        .setLabel(`${b.name} — ${b.price} pts`)
        .setStyle(ButtonStyle.Secondary)
    );
  });

  const msg = await channel.send({ embeds: [embed], components: [utilRow, roleRow, badgeRow] });
  await msg.pin().catch(() => {});

  const db = loadDB();
  db.shopMessageId = msg.id;
  saveDB(db);
  return msg;
}

// ── Handle Check My Balance ───────────────────────────────────────────────────
async function handleCheckBalance(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const db = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);
  saveDB(db);

  const ownedRoles = SHOP_ROLES.filter(r => user.inventory.includes(r.id)).map(r => r.name);
  const ownedBadges = BUYABLE_BADGES.filter(b => user.inventory.includes(b.id)).map(b => b.name);
  const earnedList = EARNED_BADGES.filter(b => user.earnedBadges.includes(b.id)).map(b => b.name);

  const embed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('💰 Your Balance')
    .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png' }))
    .addFields(
      { name: '💰 Points', value: `**${user.points} pts**`, inline: true },
      { name: '⬆️ Level', value: `**${user.level}**`, inline: true },
      { name: '🎭 Owned Roles', value: ownedRoles.length ? ownedRoles.join('\n') : 'None', inline: false },
      { name: '🏅 Owned Buyable Badges', value: ownedBadges.length ? ownedBadges.join('\n') : 'None', inline: true },
      { name: '🎖️ Earned Badges', value: earnedList.length ? earnedList.join('\n') : 'None yet', inline: true },
    )
    .setFooter({ text: 'Elevate 🪽 • Only you can see this' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ── Handle Slot 1 (Earned Badge equip) ───────────────────────────────────────
async function handleSlot1(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const db = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);

  const available = EARNED_BADGES.filter(b => user.earnedBadges.includes(b.id));
  if (available.length === 0) {
    return interaction.editReply('❌ You have no earned badges yet. Level up, boost the server, or reach the top 3 leaderboard!');
  }

  const options = available.map(b => ({ label: b.name, description: b.description, value: b.id }));
  if (user.equippedEarned) options.unshift({ label: '❌ Unequip', description: 'Remove your equipped earned badge', value: 'unequip' });

  const select = new StringSelectMenuBuilder()
    .setCustomId('shop_equip_earned')
    .setPlaceholder('Choose an earned badge to equip...')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(select);
  await interaction.editReply({ content: '🎖️ **Slot 1 — Equip Earned Badge**\nChoose from your earned badges:', components: [row] });
}

// ── Handle Slot 2 (Bought Badge equip) ───────────────────────────────────────
async function handleSlot2(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const db = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);

  const available = BUYABLE_BADGES.filter(b => user.inventory.includes(b.id));
  if (available.length === 0) {
    return interaction.editReply('❌ You have no bought badges yet. Purchase one from the shop!');
  }

  const options = available.map(b => ({ label: b.name, description: b.description, value: b.id }));
  if (user.equippedBought) options.unshift({ label: '❌ Unequip', description: 'Remove your equipped bought badge', value: 'unequip' });

  const select = new StringSelectMenuBuilder()
    .setCustomId('shop_equip_bought')
    .setPlaceholder('Choose a badge to equip...')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(select);
  await interaction.editReply({ content: '🏅 **Slot 2 — Equip Bought Badge**\nChoose from your owned badges:', components: [row] });
}

// ── Handle equip selections ───────────────────────────────────────────────────
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
    await interaction.editReply({ content: value === 'unequip' ? '✅ Bought badge unequipped.' : `✅ **${badge.name}** equipped in Slot 2!`, components: [] });
  }
}

// ── Handle shop buy (roles + badges) ─────────────────────────────────────────
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
  if (user.points < item.price) {
    return interaction.editReply(`❌ Need **${item.price} pts** but you have **${user.points} pts**. Keep leveling up! 🪽`);
  }

  user.points -= item.price;
  user.inventory.push(item.id);
  saveDB(db);

  // Handle role assignment — only apply highest tier owned
  if (role) {
    try {
      const member = await guild.members.fetch(interaction.user.id);
      const allRoleNames = SHOP_ROLES.map(r => r.roleName);

      // Remove all shop roles first
      for (const rn of allRoleNames) {
        const r = guild.roles.cache.find(gr => gr.name === rn);
        if (r && member.roles.cache.has(r.id)) await member.roles.remove(r).catch(() => {});
      }

      // Find highest owned tier
      const ownedRoles = SHOP_ROLES.filter(r => user.inventory.includes(r.id));
      const highest = ownedRoles.sort((a, b) => b.tier - a.tier)[0];
      if (highest) {
        const discordRole = guild.roles.cache.find(gr => gr.name === highest.roleName);
        if (discordRole) await member.roles.add(discordRole).catch(() => {});
      }
    } catch (err) { console.error('Role assign error:', err); }
  }

  const embed = new EmbedBuilder()
    .setColor(0x00c853)
    .setTitle('✅ Purchase Successful!')
    .setDescription(`You bought **${item.name}** for **${item.price} pts**!\nNew balance: **${user.points} pts**${badge ? '\n\nUse the **Slot 2** button to equip your badge!' : ''}`)
    .setFooter({ text: 'Elevate 🪽 • Only you can see this' });

  await interaction.editReply({ embeds: [embed] });
}

// ── VC tracking ───────────────────────────────────────────────────────────────
const vcJoinTimes = new Map();
function handleVCJoin(member) { vcJoinTimes.set(member.user.id, Date.now()); }
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
  updateLeaderboard, postLevelsPanel, postShopPanel,
  handleCheckRank, handleCheckBalance,
  handleSlot1, handleSlot2, handleEquipSelect,
  handleShopBuy, handleVCJoin, handleVCLeave, startPassiveXP,
};
