const { 
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder,
} = require('discord.js');
const { getStore, markDirty } = require('./db');

// ─── DB helpers ───────────────────────────────────────────────────────────────

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
  if (!db.users[userId]) {
    db.users[userId] = {
      username, xp: 0, level: 0, points: 0, inventory: [],
      earnedBadges: [], equippedBought: null, equippedEarned: null,
      totalXPEarned: 0, xpHistory: [],
    };
  }
  const u = db.users[userId];
  if (username) u.username = username;
  if (!u.earnedBadges)                 u.earnedBadges    = [];
  if (u.equippedBought  === undefined) u.equippedBought  = null;
  if (u.equippedEarned  === undefined) u.equippedEarned  = null;
  if (!u.totalXPEarned)                u.totalXPEarned   = 0;
  if (!u.xpHistory)                    u.xpHistory       = [];
  return u;
}

function xpForLevel(level)    { return 100 * (level + 1) * (level + 1); }
function pointsForLevel(level) { return Math.floor(50 * level * 1.5); }

// ─── Static data ──────────────────────────────────────────────────────────────

const BUYABLE_BADGES = [
  { id: 'badge_rising',  name: '🌱 Rising Star', price: 1000,  boost: 0.05, description: '+5% XP boost on all earnings'  },
  { id: 'badge_grinder', name: '⚡ Grinder',      price: 5000,  boost: 0.10, description: '+10% XP boost on all earnings' },
  { id: 'badge_veteran', name: '🌟 Veteran',      price: 10000, boost: 0.15, description: '+15% XP boost on all earnings' },
];

const EARNED_BADGES = [
  { id: 'earned_top1',     name: '🥇 Top 1',           description: 'Reached #1 on the leaderboard'  },
  { id: 'earned_top2',     name: '🥈 Top 2',           description: 'Reached #2 on the leaderboard'  },
  { id: 'earned_top3',     name: '🥉 Top 3',           description: 'Reached top 3 on the leaderboard' },
  { id: 'earned_booster',  name: '🚀 Elevate Booster', description: 'Boosted the Elevate server'       },
  { id: 'earned_level5',   name: '⭐ Level 5',          description: 'Reached Level 5'                 },
  { id: 'earned_level10',  name: '🌟 Level 10',         description: 'Reached Level 10'                },
  { id: 'earned_level20',  name: '💫 Level 20',         description: 'Reached Level 20'                },
  { id: 'earned_level50',  name: '👑 Level 50',         description: 'Reached Level 50'                },
  { id: 'earned_level100', name: '💎 Level 100',        description: 'Reached Level 100'               },
];

const SHOP_ROLES = [
  { id: 'role_gold',     name: '🌟 Elevate Gold',     price: 2000,  roleName: 'Elevate Gold🪽',     tier: 1, description: 'Entry-tier exclusive gold member role'    },
  { id: 'role_platinum', name: '💠 Elevate Platinum', price: 5000,  roleName: 'Elevate Platinum🪽', tier: 2, description: 'Mid-tier exclusive platinum member role'  },
  { id: 'role_elite',   name: '👑 Elevate Elite',     price: 10000, roleName: 'Elevate Elite🪽',    tier: 3, description: 'Top-tier exclusive elite member role'      },
];

const MEDALS = ['🥇', '🥈', '🥉'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserBadgeIcons(user) {
  const icons = [];
  if (user.equippedEarned) { const b = EARNED_BADGES.find(b => b.id === user.equippedEarned);  if (b) icons.push(b.name.split(' ')[0]); }
  if (user.equippedBought) { const b = BUYABLE_BADGES.find(b => b.id === user.equippedBought); if (b) icons.push(b.name.split(' ')[0]); }
  return icons.join(' ');
}

function getXPMultiplier(user) {
  if (!user.equippedBought) return 1;
  const badge = BUYABLE_BADGES.find(b => b.id === user.equippedBought);
  return badge ? 1 + badge.boost : 1;
}

/** Format a point value as e.g. "1k", "2.5k", "500" */
function fmtPts(n) {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}k`;
  }
  return `${n}`;
}

// ─── Badge awarding ───────────────────────────────────────────────────────────

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
        .setColor(0xFFD700)
        .setTitle(`${badge.name.split(' ')[0]} Badge Earned!`)
        .setDescription(`${member || `<@${userId}>`} earned the **${badge.name}** badge! 🪽\n*${badge.description}*`)
        .setThumbnail(member?.user.displayAvatarURL({ extension: 'png' }) || null)
        .setFooter({ text: 'Elevate 🪽 • Earned Badge' })
        .setTimestamp();
      await ch.send({ embeds: [embed] });
    }
  } catch {}
}

// ─── XP & leveling ────────────────────────────────────────────────────────────

async function addXP(userId, username, amount, guild) {
  const db = loadDB();
  const user = getUser(db, userId, username);
  const multiplier = getXPMultiplier(user);
  const gained = Math.floor(amount * multiplier);
  user.xp += gained;

  // Track cumulative XP history (hourly snapshots, 90-day retention)
  user.totalXPEarned += gained;
  const now = Date.now();
  const last = user.xpHistory[user.xpHistory.length - 1];
  if (!last || now - last.t > 3_600_000) {
    user.xpHistory.push({ t: now, cumXP: user.totalXPEarned });
    const cutoff = now - 90 * 24 * 3_600_000;
    if (user.xpHistory.length > 500) user.xpHistory = user.xpHistory.filter(h => h.t >= cutoff);
  }

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
        const icons  = getUserBadgeIcons(user);
        const lvlEmoji = user.level >= 100 ? '💎' : user.level >= 50 ? '👑' : user.level >= 20 ? '💫' : user.level >= 10 ? '🌟' : user.level >= 5 ? '⭐' : '⬆️';
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`${lvlEmoji} Level Up!`)
          .setDescription(`${member || `<@${userId}>`} ${icons} just reached **Level ${user.level}**! 🪽\n+**${earned.toLocaleString()} points** added to your balance.`)
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
  const db   = loadDB();
  const user = getUser(db, member.user.id, member.user.username);
  user.points += 500;
  saveDB(db);
  await awardEarnedBadge(member.user.id, 'earned_booster', guild);
  try {
    const ch = guild.channels.cache.get(process.env.LEVELS_CHANNEL_ID);
    if (ch) {
      const icons = getUserBadgeIcons(user);
      const embed = new EmbedBuilder()
        .setColor(0xFF73FA)
        .setTitle('🚀 Server Boost!')
        .setDescription(`${member} ${icons} just boosted the server! 🎉\n+**500 points** added to your balance. Thank you! 💜`)
        .setThumbnail(member.user.displayAvatarURL({ extension: 'png' }))
        .setFooter({ text: 'Elevate 🪽 • Boost Reward' })
        .setTimestamp();
      await ch.send({ embeds: [embed] });
    }
  } catch {}
  await updateLeaderboard(guild);
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

async function updateLeaderboard(guild) {
  try {
    const ch = guild.channels.cache.get(process.env.LEADERBOARD_CHANNEL_ID);
    if (!ch) return;

    const db     = loadDB();
    const sorted = Object.entries(db.users).sort((a, b) => b[1].points - a[1].points).slice(0, 5);

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🏆 Elevate Leaderboard')
      .setDescription('> The top members of the community.\n​');

    if (sorted.length === 0) {
      embed.addFields({ name: 'No data yet', value: 'Start chatting and leveling up!', inline: false });
    } else {
      for (let i = 0; i < sorted.length; i++) {
        const [uid, data] = sorted[i];
        let displayName = data.username;
        try { const m = await guild.members.fetch(uid).catch(() => null); if (m) displayName = m.displayName; } catch {}
        const badgeTags = [];
        if (data.equippedEarned) { const b = EARNED_BADGES.find(b => b.id === data.equippedEarned);  if (b) badgeTags.push(`\`${b.name}\``); }
        if (data.equippedBought) { const b = BUYABLE_BADGES.find(b => b.id === data.equippedBought); if (b) badgeTags.push(`\`${b.name}\``); }
        const badgeStr = badgeTags.length ? ` ${badgeTags.join(' ')}` : '';
        const medal    = i < 3 ? MEDALS[i] : '';
        embed.addFields({
          name:  `${medal} **${i + 1}.** ${displayName}${badgeStr}`,
          value: `┕ **${data.points.toLocaleString()} pts** • Level **${data.level}**`,
          inline: false,
        });
      }
    }

    embed
      .addFields({ name: '​', value: 'Earn points by chatting, VC, boosting, leveling up & using the trading journal! 🚀\nTop 3 earn exclusive badges 👑', inline: false })
      .setFooter({ text: 'Elevate 🪽 • Updates automatically' })
      .setTimestamp();

    for (let i = 0; i < Math.min(3, sorted.length); i++) {
      await awardEarnedBadge(sorted[i][0], ['earned_top1', 'earned_top2', 'earned_top3'][i], guild);
    }

    // Cross-nav: jump to shop
    const lbComponents = [];
    if (process.env.GUILD_ID && process.env.SHOP_CHANNEL_ID) {
      lbComponents.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('🛒 Visit Shop')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${process.env.GUILD_ID}/${process.env.SHOP_CHANNEL_ID}`),
        )
      );
    }

    if (db.leaderboardMessageId) {
      try {
        const msg = await ch.messages.fetch(db.leaderboardMessageId);
        await msg.edit({ embeds: [embed], components: lbComponents });
        return;
      } catch {}
    }
    try {
      const pinned   = await ch.messages.fetchPinned();
      const existing = pinned.find(m => m.author.id === guild.client.user.id && m.embeds?.[0]?.title === '🏆 Elevate Leaderboard');
      if (existing) {
        await existing.edit({ embeds: [embed], components: lbComponents });
        db.leaderboardMessageId = existing.id;
        saveDB(db);
        return;
      }
    } catch {}
    const msg = await ch.send({ embeds: [embed], components: lbComponents });
    await msg.pin().catch(() => {});
    db.leaderboardMessageId = msg.id;
    saveDB(db);
  } catch (err) { console.error('❌ Leaderboard error:', err); }
}

// ─── Levels panel ─────────────────────────────────────────────────────────────

async function postLevelsPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🏆 Rank & Levels')
    .setDescription('> Track your progress, flex your stats, and see where you stand.\n> Your rank is **private** — only you can see it.\n​')
    .addFields(
      { name: '💬 Message',     value: '+5 XP',        inline: true },
      { name: '🎙️ Voice',       value: '+10 XP / min', inline: true },
      { name: '🚀 Boost',       value: '+500 pts',      inline: true },
      { name: '📝 Trade Log',   value: '+75 XP',        inline: true },
      { name: '🏆 Achievement', value: '+100–200 XP',   inline: true },
      { name: '⬆️ Level Up',    value: 'Earns 🪽 pts',  inline: true },
    )
    .setFooter({ text: 'Elevate 🪽 • Levels' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('levels_check_rank').setLabel('📊 My Rank').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('levels_view_xpchart').setLabel('📈 XP Chart').setStyle(ButtonStyle.Secondary),
  );

  const components = [row1];
  if (process.env.GUILD_ID && process.env.SHOP_CHANNEL_ID) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🛒 Visit Shop')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${process.env.GUILD_ID}/${process.env.SHOP_CHANNEL_ID}`),
      )
    );
  }

  const msg = await channel.send({ embeds: [embed], components });
  await msg.pin().catch(() => {});
  const db = loadDB();
  db.levelsPanelMessageId = msg.id;
  saveDB(db);
  return msg;
}

// ─── Rank card ────────────────────────────────────────────────────────────────

async function handleCheckRank(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });

  const db     = loadDB();
  const user   = getUser(db, interaction.user.id, interaction.user.username);
  saveDB(db);

  const sorted   = Object.entries(db.users).sort((a, b) => b[1].points - a[1].points);
  const rank     = sorted.findIndex(([id]) => id === interaction.user.id) + 1;
  const nextLvlXP = xpForLevel(user.level);
  const progress  = Math.min(10, Math.floor((user.xp / nextLvlXP) * 10));
  const bar       = '█'.repeat(progress) + '░'.repeat(10 - progress);

  const lvlEmoji       = user.level >= 100 ? '💎' : user.level >= 50 ? '👑' : user.level >= 20 ? '💫' : user.level >= 10 ? '🌟' : user.level >= 5 ? '⭐' : '🪽';
  const equippedEarned = user.equippedEarned ? EARNED_BADGES.find(b => b.id === user.equippedEarned)?.name   : 'None';
  const equippedBought = user.equippedBought ? BUYABLE_BADGES.find(b => b.id === user.equippedBought)?.name : 'None';
  const multiplier     = getXPMultiplier(user);
  const boostStr       = multiplier > 1 ? `+${Math.round((multiplier - 1) * 100)}% XP` : 'No boost';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`${lvlEmoji} Your Rank`)
    .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png' }))
    .addFields(
      { name: '⬆️ Level',         value: `**${user.level}**`,                           inline: true },
      { name: '🪽 Points',        value: `**${user.points.toLocaleString()} pts**`,     inline: true },
      { name: '🏆 Server Rank',   value: `**#${rank}**`,                                inline: true },
      { name: `✨ XP — ${user.xp.toLocaleString()} / ${nextLvlXP.toLocaleString()}`, value: `\`[${bar}]\``, inline: false },
      { name: '🎖️ Slot 1 — Earned Badge',          value: equippedEarned,                        inline: true },
      { name: '🏅 Slot 2 — XP Badge',              value: `${equippedBought} *(${boostStr})*`, inline: true },
    )
    .setFooter({ text: 'Elevate 🪽 • Only you can see this' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('levels_view_xpchart').setLabel('📈 XP Chart').setStyle(ButtonStyle.Secondary),
  );
  if (process.env.GUILD_ID && process.env.SHOP_CHANNEL_ID) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('🛒 Visit Shop')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${process.env.GUILD_ID}/${process.env.SHOP_CHANNEL_ID}`),
    );
  }

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─── Shop ─────────────────────────────────────────────────────────────────────

const SHOP_CATS = {
  roles:  { emoji: '🎭', label: 'Member Roles',  items: SHOP_ROLES,     desc: 'Exclusive Discord roles for active members.'         },
  badges: { emoji: '🏅', label: 'XP Badges',     items: BUYABLE_BADGES, desc: 'Equip a badge to boost your XP earnings.'           },
  soon:   { emoji: '🔒', label: 'Coming Soon',   items: [],             desc: 'New items dropping — stay active and check back! 🪽' },
};

const ITEMS_PER_PAGE = 3;

function buildShopMessage(category, page) {
  const catKeys = ['roles', 'badges', 'soon'];
  const catIdx = Math.max(0, catKeys.indexOf(category));
  const cat = SHOP_CATS[category] || SHOP_CATS.roles;
  const items = cat.items;
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = items.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🛒 Elevate Shop')
    .setDescription(`> ${cat.emoji} **${cat.label}**\n> ${cat.desc}\n​`);

  if (category === 'soon') {
    embed.addFields(
      { name: '🔒 Mystery Item', value: '> 👀 Something is brewing...\n> *Stay active to unlock!*', inline: false },
      { name: '🔒 ???', value: '> New drops coming soon.\n> *Keep leveling up 🪽*', inline: false },
      { name: '🔒 More to come...', value: '> Earn points now so you\'re\n> ready when they drop! 💰', inline: false },
    );
  } else {
    for (const item of pageItems) {
      embed.addFields({
        name: item.name,
        value: [
          '> 📦 **Stock:** Unlimited',
          `> 🪽 **Price:** ${item.price.toLocaleString()} pts`,
          `> *${item.description}*`,
        ].join('\n'),
        inline: false,
      });
    }
  }

  embed
    .setFooter({ text: `Elevate 🪽 • ${cat.label}` })
    .setTimestamp();

  const components = [];

  // One buy button per item row — visually corresponds 1:1 with each item above
  if (category !== 'soon' && pageItems.length > 0) {
    for (const item of pageItems) {
      const itemLabel = item.name.split(' ').slice(1).join(' ');
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`shop_buy_${item.id}`)
            .setLabel(`Buy ${itemLabel} — ${fmtPts(item.price)} pts 🪽`)
            .setStyle(ButtonStyle.Primary),
        )
      );
    }
  }

  // Category navigation arrows (replaces dropdown)
  const prevCat = catKeys[Math.max(0, catIdx - 1)];
  const nextCat = catKeys[Math.min(catKeys.length - 1, catIdx + 1)];
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop_p_${catKeys[0]}_0_f`).setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(catIdx === 0),
      new ButtonBuilder().setCustomId(`shop_p_${prevCat}_0_p`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(catIdx === 0),
      new ButtonBuilder().setCustomId('shop_nav_page').setLabel(`${cat.emoji} ${cat.label}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`shop_p_${nextCat}_0_n`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(catIdx >= catKeys.length - 1),
      new ButtonBuilder().setCustomId(`shop_p_${catKeys[catKeys.length - 1]}_0_l`).setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(catIdx >= catKeys.length - 1),
    )
  );

  // Utility buttons
  const utilRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('shop_check_balance').setLabel('💰 My Balance').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shop_slot1').setLabel('🎖️ Equip Badge').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shop_slot2').setLabel('🏅 Equip XP Badge').setStyle(ButtonStyle.Secondary),
  );
  if (process.env.GUILD_ID && process.env.LEADERBOARD_CHANNEL_ID) {
    utilRow.addComponents(
      new ButtonBuilder()
        .setLabel('📊 My Rank')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${process.env.GUILD_ID}/${process.env.LEADERBOARD_CHANNEL_ID}`),
    );
  }
  components.push(utilRow);

  return { embed, components };
}
async function postShopPanel(channel) {
  const { embed, components } = buildShopMessage('roles', 0);
  const msg = await channel.send({ embeds: [embed], components });
  await msg.pin().catch(() => {});
  const db = loadDB();
  db.shopMessageId = msg.id;
  saveDB(db);
  return msg;
}

async function handleShopNav(interaction, category, page) {
  const { embed, components } = buildShopMessage(category, page);
  await interaction.update({ embeds: [embed], components });
}

// ─── Balance ──────────────────────────────────────────────────────────────────

async function handleCheckBalance(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const db   = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);
  saveDB(db);

  const ownedRoles  = SHOP_ROLES.filter(r => user.inventory.includes(r.id)).map(r => r.name);
  const ownedBadges = BUYABLE_BADGES.filter(b => user.inventory.includes(b.id)).map(b => b.name);
  const earnedList  = EARNED_BADGES.filter(b => user.earnedBadges.includes(b.id)).map(b => b.name);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('💰 Your Balance')
    .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png' }))
    .addFields(
      { name: '🪽 Points',          value: `**${user.points.toLocaleString()} pts**`,  inline: true },
      { name: '⬆️ Level',           value: `**${user.level}**`,                         inline: true },
      { name: '🎭 Owned Roles',     value: ownedRoles.length  ? ownedRoles.join('\n')  : '*None yet*', inline: false },
      { name: '🏅 XP Badges',      value: ownedBadges.length ? ownedBadges.join('\n') : '*None yet*', inline: true  },
      { name: '🎖️ Earned Badges',  value: earnedList.length  ? earnedList.join('\n')  : '*None yet*', inline: true  },
    )
    .setFooter({ text: 'Elevate 🪽 • Only you can see this' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─── Badge equip ──────────────────────────────────────────────────────────────

async function handleSlot1(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const db        = loadDB();
  const user      = getUser(db, interaction.user.id, interaction.user.username);
  const available = EARNED_BADGES.filter(b => user.earnedBadges.includes(b.id));
  if (available.length === 0)
    return interaction.editReply('❌ No earned badges yet. Level up, boost the server, or reach top 3!');
  const options = available.map(b => ({ label: b.name, description: b.description, value: b.id }));
  if (user.equippedEarned) options.unshift({ label: '❌ Unequip', description: 'Remove your equipped earned badge', value: 'unequip' });
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('shop_equip_earned').setPlaceholder('Choose an earned badge...').addOptions(options)
  );
  await interaction.editReply({ content: '🎖️ **Slot 1 — Equip Earned Badge**', components: [row] });
}

async function handleSlot2(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const db        = loadDB();
  const user      = getUser(db, interaction.user.id, interaction.user.username);
  const available = BUYABLE_BADGES.filter(b => user.inventory.includes(b.id));
  if (available.length === 0)
    return interaction.editReply('❌ No XP badges yet. Purchase one from the shop! 🏅');
  const options = available.map(b => ({ label: b.name, description: b.description, value: b.id }));
  if (user.equippedBought) options.unshift({ label: '❌ Unequip', description: 'Remove your equipped XP badge', value: 'unequip' });
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('shop_equip_bought').setPlaceholder('Choose an XP badge...').addOptions(options)
  );
  await interaction.editReply({ content: '🏅 **Slot 2 — Equip XP Badge**', components: [row] });
}

async function handleEquipSelect(interaction) {
  await interaction.deferUpdate();
  const db    = loadDB();
  const user  = getUser(db, interaction.user.id, interaction.user.username);
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
    await interaction.editReply({ content: value === 'unequip' ? '✅ XP badge unequipped.' : `✅ **${badge.name}** equipped in Slot 2!`, components: [] });
  }
}

// ─── Shop buy ─────────────────────────────────────────────────────────────────

async function handleShopBuy(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });
  const itemId = interaction.customId.replace('shop_buy_', '');
  const role   = SHOP_ROLES.find(r => r.id === itemId);
  const badge  = BUYABLE_BADGES.find(b => b.id === itemId);
  const item   = role || badge;
  if (!item) return interaction.editReply('❌ Item not found.');

  const db   = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);

  if (user.inventory.includes(item.id))
    return interaction.editReply('✅ You already own this item!');
  if (user.points < item.price)
    return interaction.editReply(`❌ You need **${item.price.toLocaleString()} pts** but only have **${user.points.toLocaleString()} pts**.\nKeep leveling up and earning! 🪽`);

  user.points -= item.price;
  user.inventory.push(item.id);
  saveDB(db);

  if (role) {
    try {
await guild.roles.fetch();
      const member = await guild.members.fetch(interaction.user.id);
      for (const r of SHOP_ROLES) {
        const dr = guild.roles.cache.find(gr => gr.name === r.roleName);
        if (dr && member.roles.cache.has(dr.id)) await member.roles.remove(dr).catch(() => {});
      }
      const highest = SHOP_ROLES.filter(r => user.inventory.includes(r.id)).sort((a, b) => b.tier - a.tier)[0];
      if (highest) {
        const discordRole = guild.roles.cache.find(gr => gr.name === highest.roleName);
        if (discordRole) await member.roles.add(discordRole).catch(() => {});
      }
    } catch (err) { console.error('Role assign error:', err); }
  }

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('✅ Purchase Successful!')
    .setDescription(
      `You bought **${item.name}** for **${item.price.toLocaleString()} pts**! 🪽\n` +
      `New balance: **${user.points.toLocaleString()} pts**` +
      (badge ? '\n\n> Use **🏅 Equip XP Badge** in the shop to activate it!' : '')
    )
    .setFooter({ text: 'Elevate 🪽 • Only you can see this' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─── XP Chart ─────────────────────────────────────────────────────────────────

function buildChartButtons(active) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('xpchart_1d').setLabel('1D').setStyle(active === '1d'  ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('xpchart_1w').setLabel('1W').setStyle(active === '1w'  ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('xpchart_1m').setLabel('1M').setStyle(active === '1m'  ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('xpchart_all').setLabel('All Time').setStyle(active === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

async function handleXPChart(interaction, timeframe = '1w', isUpdate = false) {
  if (isUpdate) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ ephemeral: true });
  }

  const db   = loadDB();
  const user = getUser(db, interaction.user.id, interaction.user.username);
  saveDB(db);

  const now = Date.now();
  const cutoffs = {
    '1d':  now - 86_400_000,
    '1w':  now - 604_800_000,
    '1m':  now - 2_592_000_000,
    'all': 0,
  };
  const cutoff  = cutoffs[timeframe] ?? cutoffs['1w'];
  const history = (user.xpHistory || []).filter(h => h.t >= cutoff);

  const noDataEmbed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📈 XP Growth Chart')
    .setDescription(
      '> Not enough data yet!\n' +
      '> Keep chatting, joining VC and logging trades.\n' +
      '> Your chart will fill in over time 🪽'
    )
    .setFooter({ text: 'Elevate 🪽 • XP Chart' })
    .setTimestamp();

  if (history.length < 2) {
    return interaction.editReply({ embeds: [noDataEmbed], components: [buildChartButtons(timeframe)], files: [] });
  }

  const timeLabels = { '1d': 'Last 24 Hours', '1w': 'Last 7 Days', '1m': 'Last 30 Days', 'all': 'All Time' };

  const labels = history.map(h => {
    const d = new Date(h.t);
    return timeframe === '1d'
      ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const data = history.map(h => h.cumXP);

  const chartConfig = JSON.stringify({
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Total XP',
        data,
        borderColor: '#5865F2',
        backgroundColor: 'rgba(88, 101, 242, 0.15)',
        fill: true,
        tension: 0.4,
        pointRadius: history.length > 30 ? 0 : 3,
        pointBackgroundColor: '#5865F2',
        borderWidth: 2,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#b5bac1', maxTicksLimit: 8, font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.07)' } },
        y: { ticks: { color: '#b5bac1', font: { size: 11 } },                   grid: { color: 'rgba(255,255,255,0.07)' } },
      },
    },
  });

  const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(chartConfig)}&w=700&h=300&bkg=%23313338&f=png`;

  let imageBuffer;
  try {
    const res = await fetch(chartUrl);
    if (!res.ok) throw new Error(`QuickChart ${res.status}`);
    imageBuffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error('❌ XP chart error:', err);
    return interaction.editReply({ content: '❌ Couldn\'t generate the chart right now — try again in a moment!', components: [], files: [] });
  }

  const gained    = data[data.length - 1] - data[0];
  const totalEver = user.totalXPEarned;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📈 ${interaction.user.displayName}'s XP Growth`)
    .setDescription([
      `> 📅 **${timeLabels[timeframe]}**`,
      `> ✨ **+${gained.toLocaleString()} XP** earned this period`,
      `> 🪽 All-time total: **${totalEver.toLocaleString()} XP**`,
    ].join('\n'))
    .setImage('attachment://xp-chart.png')
    .setFooter({ text: 'Elevate 🪽 • XP Chart • Only you can see this' })
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
    files:  [new AttachmentBuilder(imageBuffer, { name: 'xp-chart.png' })],
    components: [buildChartButtons(timeframe)],
  });
}

// ─── Voice XP ─────────────────────────────────────────────────────────────────

const vcJoinTimes = new Map();
function handleVCJoin(member)               { vcJoinTimes.set(member.user.id, Date.now()); }
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

// ─── Fix role assignment ──────────────────────────────────────────────────────

async function fixUserRole(userId, guild) {
const db = loadDB();
const user = db.users?.[userId];
if (!user) return { ok: false, msg: 'User not found in database.' };

await guild.roles.fetch();
const member = await guild.members.fetch(userId).catch(() => null);
if (!member) return { ok: false, msg: 'Member not found in server.' };

// Strip all shop roles first
for (const r of SHOP_ROLES) {
const dr = guild.roles.cache.find(gr => gr.name === r.roleName);
if (dr && member.roles.cache.has(dr.id)) await member.roles.remove(dr).catch(() => {});
}

// Find highest-tier owned role
const highest = SHOP_ROLES
.filter(r => (user.inventory || []).includes(r.id))
.sort((a, b) => b.tier - a.tier)[0];

if (!highest) return { ok: false, msg: 'No shop roles found in this user\'s inventory.' };

const discordRole = guild.roles.cache.find(gr => gr.name === highest.roleName);
if (!discordRole) return { ok: false, msg: `Discord role "${highest.roleName}" not found — check the role name matches exactly.` };

await member.roles.add(discordRole);
return { ok: true, role: highest, member };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  loadDB, saveDB, getUser, initDB,
  addXP, handleBoost,
  updateLeaderboard,
  postLevelsPanel, postShopPanel,
  handleCheckRank, handleCheckBalance,
  handleSlot1, handleSlot2, handleEquipSelect, handleShopBuy,
  handleShopNav,
  handleXPChart,
  handleVCJoin, handleVCLeave, startPassiveXP,
fixUserRole,
};
