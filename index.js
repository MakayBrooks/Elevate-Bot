require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const cron = require('node-cron');
const { loadAll } = require('./db');
const { generateWelcomeCard } = require('./welcomeCard');
const { postWeeklyCalendar } = require('./economicCalendar');
const { handleJournalInteraction, sendJournalPanel } = require('./journal');
const {
  addXP, handleBoost, updateLeaderboard, initDB,
  postLevelsPanel, postShopPanel,
  handleCheckRank, handleCheckBalance,
  handleSlot1, handleSlot2, handleEquipSelect, handleShopBuy,
  handleVCJoin, handleVCLeave, startPassiveXP,
  getUser, loadDB: loadLevelsDB, saveDB: saveLevelsDB
} = require('./levels');
const commands = require('./commands');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ]
});

const xpCooldowns = new Map();

client.once('ready', async () => {
  console.log(`✅ Elevate Bot online as ${client.user.tag}`);

  await loadAll();
  console.log('✅ Database loaded.');

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (err) { console.error('❌ Commands error:', err); }

  const guild = client.guilds.cache.get(process.env.GUILD_ID);

  // Journal panel — check stored message ID first, fall back to pinned scan
  try {
    if (guild) {
      const journalChannel = guild.channels.cache.get(process.env.JOURNAL_CHANNEL_ID);
      if (journalChannel) {
        const { loadDB: loadJournalDB } = require('./journal');
        const jdb = loadJournalDB();
        let exists = false;
        if (jdb._panelMessageId) {
          try {
            const msg = await journalChannel.messages.fetch(jdb._panelMessageId);
            if (msg) exists = true;
          } catch { exists = false; }
        }
        if (!exists) {
          const pinned = await journalChannel.messages.fetchPinned().catch(() => new Map());
          exists = pinned.some(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.includes('Trading Journal'));
        }
        if (!exists) { await sendJournalPanel(journalChannel); console.log('✅ Journal panel posted.'); }
        else console.log('📌 Journal panel exists.');
      }
    }
  } catch (err) { console.error('❌ Journal panel error:', err); }

  // Leaderboard channel
  // DISPLAY ORDER: 🏆 Leaderboard embed FIRST (top), then 📊 Rank panel + button below.
  // updateLeaderboard runs first so its message is older (higher in channel).
  // postLevelsPanel runs after so its message is newer (lower in channel).
  try {
    if (guild) {
      const lbChannel = guild.channels.cache.get(process.env.LEADERBOARD_CHANNEL_ID);
      if (lbChannel) {
        // 1. Post/update the leaderboard embed first
        await updateLeaderboard(guild);
        // 2. Then ensure rank panel exists below it
        const pinned = await lbChannel.messages.fetchPinned();
        const panelExists = pinned.some(m => m.author.id === client.user.id && m.embeds?.[0]?.title === '📊 Your Rank');
        if (!panelExists) { await postLevelsPanel(lbChannel); console.log('✅ Rank panel posted.'); }
        else console.log('📌 Rank panel exists.');
      }
    }
  } catch (err) { console.error('❌ Leaderboard error:', err); }

  // Shop panel
  try {
    if (guild) {
      const shopChannel = guild.channels.cache.get(process.env.SHOP_CHANNEL_ID);
      if (shopChannel) {
        const pinned = await shopChannel.messages.fetchPinned();
        const shopExists = pinned.some(m => m.author.id === client.user.id && m.embeds?.[0]?.title === '🛒 Elevate Shop');
        if (!shopExists) { await postShopPanel(shopChannel); console.log('✅ Shop panel posted.'); }
        else console.log('🛒 Shop panel exists.');
      }
    }
  } catch (err) { console.error('❌ Shop panel error:', err); }

  startPassiveXP(client);

  cron.schedule('0 20 * * 0', async () => {
    if (guild) await postWeeklyCalendar(guild, client);
  }, { timezone: 'America/New_York' });

  console.log('📅 Weekly calendar scheduled: Sunday 8PM ET');
});

// Welcome
client.on('guildMemberAdd', async (member) => {
  try {
    const channel = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
    if (!channel) return;
    const joinTimestamp = Math.floor(member.joinedTimestamp / 1000);
    await channel.send(`🎉 Welcome to the community, ${member}🪽\n👤 We are now **${member.guild.memberCount}** members!\n🕐 Joined: <t:${joinTimestamp}:R>`);
    const cardBuffer = await generateWelcomeCard(member);
    await channel.send({ files: [new AttachmentBuilder(cardBuffer, { name: 'welcome.png' })] });
  } catch (err) { console.error('❌ Welcome error:', err); }
});

// Boost
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (!oldMember.premiumSince && newMember.premiumSince) await handleBoost(newMember, newMember.guild);
});

// Message XP
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const now = Date.now();
  const last = xpCooldowns.get(message.author.id) || 0;
  if (now - last < 60000) return;
  xpCooldowns.set(message.author.id, now);
  await addXP(message.author.id, message.author.username, 5, message.guild);
});

// VC XP
client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  if (!oldState.channelId && newState.channelId) handleVCJoin(member);
  else if (oldState.channelId && !newState.channelId) await handleVCLeave(member, guild);
});

// Interactions
client.on('interactionCreate', async (interaction) => {
  const guild = interaction.guild;

  // Journal
  if (
    (interaction.isButton() && interaction.customId.startsWith('journal_')) ||
    (interaction.isModalSubmit() && interaction.customId.startsWith('journal_')) ||
    (interaction.isChatInputCommand() && interaction.commandName === 'journal')
  ) { await handleJournalInteraction(interaction, client); return; }

  // Rank button
  if (interaction.isButton() && interaction.customId === 'levels_check_rank') { await handleCheckRank(interaction, guild); return; }

  // Shop buttons
  if (interaction.isButton() && interaction.customId === 'shop_check_balance') { await handleCheckBalance(interaction); return; }
  if (interaction.isButton() && interaction.customId === 'shop_slot1') { await handleSlot1(interaction); return; }
  if (interaction.isButton() && interaction.customId === 'shop_slot2') { await handleSlot2(interaction); return; }
  if (interaction.isStringSelectMenu() && interaction.customId === 'shop_equip_earned') { await handleEquipSelect(interaction); return; }
  if (interaction.isStringSelectMenu() && interaction.customId === 'shop_equip_bought') { await handleEquipSelect(interaction); return; }
  if (interaction.isButton() && interaction.customId.startsWith('shop_buy_')) { await handleShopBuy(interaction, guild); return; }

  if (!interaction.isChatInputCommand()) return;

  // /addpoints
  if (interaction.commandName === 'addpoints') {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('❌ Admins only.');
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const db = loadLevelsDB();
    const user = getUser(db, target.id, target.username);
    user.points += amount;
    saveLevelsDB(db);
    await updateLeaderboard(guild);
    await interaction.editReply(`✅ Added **${amount} pts** to ${target.username}. New balance: **${user.points} pts**`);
  }

  // /calendar
  if (interaction.commandName === 'calendar') {
    await interaction.deferReply({ ephemeral: true });
    if (guild) await postWeeklyCalendar(guild, client);
    await interaction.editReply('📅 Calendar posted!');
  }

  // /setup-start-here — post the server onboarding embed panel
  if (interaction.commandName === 'setup-start-here') {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('❌ Admins only.');
    try {
      const ch = interaction.channel;

      // ── EMBED 1: Welcome / What is Elevate ──────────────────────────────
      const welcomeEmbed = new EmbedBuilder()
        .setColor(0xF5F0E8)
        .setTitle('🪽 Welcome to Elevate')
        .setDescription(
          '> **Elevate is a trading & growth community built for people who take their development seriously.**\n​\n' +
          'We combine serious trading education with the things that actually make you a better trader — ' +
          'mindset, faith, discipline, and accountability.\n​\n' +
          '**What you\'ll find here:**\n' +
          '🗂️ **Trading** — trade recaps, market news, indicators, a live trading room, and a journal\n' +
          '📚 **Education** — resources, videos, networking, and mentoring\n' +
          '🧠 **Growth** — mindset, purpose, fitness, and faith channels\n' +
          '🏆 **Gamification** — XP, levels, a points shop, badges, and a live leaderboard\n​'
        )
        .setFooter({ text: 'Elevate 🪽 • Read through each section below to get started' });

      // ── EMBED 2: XP & Levels ─────────────────────────────────────────────
      const xpEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📊 XP, Levels & Points')
        .setDescription(
          '> Every action you take in the server earns you **XP** and **points**.\n' +
          '> XP fills your level bar. Points are spent in the shop.\n​'
        )
        .addFields(
          {
            name: '⚡ How to earn XP',
            value: [
              '💬 **Chat** — +5 XP per message (1 min cooldown)',
              '🎙️ **Voice** — +10 XP per minute in VC',
              '📝 **Trade Journal** — +75 XP per trade logged',
              '🏆 **Achievements** — +100–200 XP each',
              '🚀 **Boost** — +500 points instantly',
            ].join('\n'),
            inline: false,
          },
          {
            name: '🎯 Level milestones',
            value: [
              '⭐ Level 5  •  🌟 Level 10  •  💫 Level 20',
              '👑 Level 50  •  💎 Level 100',
              '*Each milestone unlocks an exclusive earned badge.*',
            ].join('\n'),
            inline: false,
          },
          {
            name: '📊 Check your rank',
            value: 'Head to <#' + (process.env.LEADERBOARD_CHANNEL_ID || 'leaderboard') + '> and click **Check My Rank** to see your level, XP bar, points, and server rank privately.',
            inline: false,
          }
        )
        .setFooter({ text: 'Elevate 🪽 • Levels' });

      // ── EMBED 3: Trading Journal ──────────────────────────────────────────
      const journalEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('📝 The Trading Journal')
        .setDescription(
          '> **The journal is the core of the trading side of Elevate.** It\'s how you track, reflect, and improve.\n​'
        )
        .addFields(
          {
            name: '📋 What it does',
            value: [
              '• Log every trade with pair, direction, entry, exit, P&L, and notes',
              '• Track your stats: win rate, total trades, net P&L, average R:R',
              '• Earn **+75 XP** every time you submit a trade',
              '• Weekly earnings are submitted for the **trading leaderboard**',
            ].join('\n'),
            inline: false,
          },
          {
            name: '🚀 How to use it',
            value: 'Go to <#' + (process.env.JOURNAL_CHANNEL_ID || 'journal') + '> → click **Log a Trade** → fill in the details → done. Use `/journal stats` to see your full stats privately anytime.',
            inline: false,
          }
        )
        .setFooter({ text: 'Elevate 🪽 • Journal' });

      // ── EMBED 4: Roles ────────────────────────────────────────────────────
      const rolesEmbed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('🎭 How to Get Roles')
        .setDescription(
          '> Roles are earned through activity, spending points, or reaching milestones.\n​'
        )
        .addFields(
          {
            name: '🛒 Shop Roles — buy with points',
            value: [
              '🌟 **Elevate Gold** — 2,000 pts',
              '💠 **Elevate Platinum** — 5,000 pts',
              '👑 **Elevate Elite** — 10,000 pts',
              '*Buy in <#' + (process.env.SHOP_CHANNEL_ID || 'shop') + '>. Only your highest tier shows.*',
            ].join('\n'),
            inline: false,
          },
          {
            name: '🏅 XP Boost Badges — buy with points',
            value: [
              '🌱 **Rising Star** (1,000 pts) — +5% XP on everything',
              '⚡ **Grinder** (5,000 pts) — +10% XP on everything',
              '🌟 **Veteran** (10,000 pts) — +15% XP on everything',
            ].join('\n'),
            inline: false,
          },
          {
            name: '🎖️ Earned Badges — unlocked through action',
            value: [
              '🥇 Top 1 / 🥈 Top 2 / 🥉 Top 3 — reach top 3 on the leaderboard',
              '🚀 Elevate Booster — boost the server',
              '⭐🌟💫👑💎 — reach Level 5, 10, 20, 50, or 100',
              '*Earned badges can\'t be bought. Equip them in <#' + (process.env.SHOP_CHANNEL_ID || 'shop') + '>.*',
            ].join('\n'),
            inline: false,
          }
        )
        .setFooter({ text: 'Elevate 🪽 • Roles & Badges' });

      // ── Button row ────────────────────────────────────────────────────────
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('📊 Check My Rank')
          .setCustomId('levels_check_rank')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setLabel('🛒 Visit Shop')
          .setURL('https://discord.com/channels/' + guild.id + '/' + (process.env.SHOP_CHANNEL_ID || ''))
          .setStyle(ButtonStyle.Link),
        new ButtonBuilder()
          .setLabel('📝 Open Journal')
          .setURL('https://discord.com/channels/' + guild.id + '/' + (process.env.JOURNAL_CHANNEL_ID || ''))
          .setStyle(ButtonStyle.Link),
      );

      await ch.send({ embeds: [welcomeEmbed] });
      await ch.send({ embeds: [xpEmbed] });
      await ch.send({ embeds: [journalEmbed] });
      await ch.send({ embeds: [rolesEmbed], components: [row] });

      await interaction.editReply('✅ Start here panel posted!');
    } catch (err) {
      console.error('❌ setup-start-here error:', err);
      await interaction.editReply('❌ Error: ' + err.message);
    }
  }

  // /setup-leaderboard — admin command to delete and repost panels in correct order
  // Order: 🏆 Leaderboard embed (top) → 📊 Rank panel + button (below)
  if (interaction.commandName === 'setup-leaderboard') {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('❌ Admins only.');
    try {
      const lbChannel = guild.channels.cache.get(process.env.LEADERBOARD_CHANNEL_ID);
      if (!lbChannel) return interaction.editReply('❌ Leaderboard channel not found. Check LEADERBOARD_CHANNEL_ID.');

      // Delete all bot messages in the channel to start fresh
      // Must unpin first — Discord won't delete pinned messages without unpin
      const fetched = await lbChannel.messages.fetch({ limit: 100 });
      const botMsgs = fetched.filter(m => m.author.id === client.user.id);
      for (const [, msg] of botMsgs) {
        if (msg.pinned) await msg.unpin().catch(() => {});
        await msg.delete().catch(() => {});
      }

      // Clear stored message IDs (stored on store.levels) so they get recreated fresh
      const { getStore, markDirty } = require('./db');
      const store = getStore();
      if (store.levels) {
        delete store.levels.leaderboardMessageId;
        delete store.levels.levelsPanelMessageId;
      }
      markDirty();

      // 1. Post leaderboard first (top)
      await updateLeaderboard(guild);
      // 2. Post rank panel below it
      await postLevelsPanel(lbChannel);

      await interaction.editReply('✅ Leaderboard channel reset! Order: 🏆 Leaderboard (top) → 📊 Rank panel (below).');
    } catch (err) {
      console.error('❌ setup-leaderboard error:', err);
      await interaction.editReply('❌ Error: ' + err.message);
    }
  }
});

client.login(process.env.BOT_TOKEN);
