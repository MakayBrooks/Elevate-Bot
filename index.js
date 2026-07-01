require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, AttachmentBuilder } = require('discord.js');
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
  handleShopNav, handleXPChart,
  handleVCJoin, handleVCLeave, startPassiveXP,
  fixUserRole,
  giveItem,
  getUser, loadDB: loadLevelsDB, saveDB: saveLevelsDB,
} = require('./levels');
const commands = require('./commands');
const { postStartHerePanel } = require('./startHere');
const { postRulesPanel } = require('./setupRules');
const { postTradingLeaderboard, refreshTradingLeaderboard: handleTradingLbRefresh, getOrCreateTradingLbChannel } = require('./trading-leaderboard');
const { setupTicketHub, onTicketCreated, onTicketMessage, handleTicketButton } = require('./tickets');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

const xpCooldowns = new Map();

client.once('ready', async () => {
  console.log('\u2705 Elevate Bot online as ' + client.user.tag);

  await loadAll();
  console.log('\u2705 Database loaded.');

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('\u2705 Slash commands registered.');
  } catch (err) { console.error('\u274C Commands error:', err); }

  const guild = client.guilds.cache.get(process.env.GUILD_ID);

  // \u2500\u2500 Journal panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  try {
    if (guild) {
      const journalChannel = guild.channels.cache.get(process.env.JOURNAL_CHANNEL_ID);
      if (journalChannel) {
        const { loadDB: loadJournalDB } = require('./journal');
        const jdb = loadJournalDB();
        let exists = false;
        if (jdb._panelMessageId) {
          try { const msg = await journalChannel.messages.fetch(jdb._panelMessageId); if (msg) exists = true; } catch { exists = false; }
        }
        if (!exists) {
          const pinned = await journalChannel.messages.fetchPinned().catch(() => new Map());
          exists = pinned.some(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.includes('Trading Journal'));
        }
        if (!exists) { await sendJournalPanel(journalChannel); console.log('\u2705 Journal panel posted.'); }
        else console.log('\u{1F4CC} Journal panel exists.');
      }
    }
  } catch (err) { console.error('\u274C Journal panel error:', err); }

  // \u2500\u2500 Leaderboard + rank panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  try {
    if (guild) {
      const lbChannel = guild.channels.cache.get(process.env.LEADERBOARD_CHANNEL_ID);
      if (lbChannel) await updateLeaderboard(guild);
    }
  } catch (err) { console.error('\u274C Leaderboard error:', err); }

  // Rank panel \u2014 your-rank channel
  try {
    if (guild) {
      const rankChannel = guild.channels.cache.get(process.env.RANK_CHANNEL_ID);
      if (rankChannel) {
        const pinned = await rankChannel.messages.fetchPinned();
        const panelExists = pinned.some(m => m.author.id === client.user.id && m.embeds?.[0]?.title === '\u{1F3C6} Rank & Levels');
        if (!panelExists) { await postLevelsPanel(rankChannel); console.log('\u2705 Rank panel posted.'); }
        else console.log('\u{1F4CC} Rank panel exists.');
      }
    }
  } catch (err) { console.error('\u274C Rank panel error:', err); }

  // \u2500\u2500 Shop panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  try {
    if (guild) {
      const shopChannel = guild.channels.cache.get(process.env.SHOP_CHANNEL_ID);
      if (shopChannel) {
        const pinned = await shopChannel.messages.fetchPinned();
        const shopExists = pinned.some(m => m.author.id === client.user.id && m.embeds?.[0]?.title === '\u{1F6D2} Elevate Shop');
        if (!shopExists) { await postShopPanel(shopChannel); console.log('\u2705 Shop panel posted.'); }
        else console.log('\u{1F4CC} Shop panel exists.');
      }
    }
  } catch (err) { console.error('\u274C Shop panel error:', err); }

  // \u2500\u2500 Trading Leaderboard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  try {
    if (guild) {
      const lbCh = await getOrCreateTradingLbChannel(guild);
      if (lbCh) { await postTradingLeaderboard(lbCh); console.log('\u2705 Trading leaderboard posted.'); }
    }
  } catch (err) { console.error('\u274C Trading leaderboard error:', err); }

  startPassiveXP(client);

  // \u2500\u2500 Scheduled tasks \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  cron.schedule('0 19 * * 0', async () => {
    if (guild) await postWeeklyCalendar(guild, client);
  }, { timezone: 'America/New_York' });
  console.log('\u{1F4C5} Weekly calendar scheduled: Sunday 7PM ET');

  cron.schedule('30 9 * * 1-5', async () => {
    try {
      const guild = client.guilds.cache.get(process.env.GUILD_ID);
      if (!guild) return;
      const channel = guild.channels.cache.get(process.env.TRADING_CHANNEL_ID);
      if (!channel) { console.warn('\u26A0\uFE0F NY session cron: TRADING_CHANNEL_ID not found'); return; }
      const { EmbedBuilder } = require('discord.js');
      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('\u{1F1FA}\u{1F1F8} New York Session Open')
        .setDescription('> The **New York session** is now open (9:30 AM ET).\n> Stay disciplined, follow your plan, and manage your risk.')
        .addFields(
          { name: '\u23F0 Session Hours', value: '9:30 AM \u2192 4:00 PM ET', inline: true },
          { name: '\u{1F4C8} Key Markets', value: 'NQ, ES, SPY, Forex majors', inline: true },
        )
        .setFooter({ text: 'Elevate \u{1FABD} \u2022 Trading Room' })
        .setTimestamp();
      await channel.send({ embeds: [embed] });
      console.log('\u2705 NY session open posted');
    } catch (err) { console.error('\u274C NY session cron error:', err); }
  }, { timezone: 'America/New_York' });
  console.log('\u23F0 NY session open scheduled: weekdays 9:30 AM ET');

  // ── Ticket hub setup ──────────────────────────────────────────────
  if (guild) await setupTicketHub(guild).catch(e => console.error('❌ Ticket hub setup:', e));
});

// \u2500\u2500 Member events \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

client.on('guildMemberAdd', async (member) => {
  try {
    const channel = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
    if (!channel) return;
    const joinTimestamp = Math.floor(member.joinedTimestamp / 1000);
    await channel.send(`\u{1F44B} Welcome to the community, ${member} \u{1FABD}\n\u{1F91D} We are now **${member.guild.memberCount}** members!\n\u{1F4C5} Joined: <t:${joinTimestamp}:R>`);
    const cardBuffer = await generateWelcomeCard(member);
    await channel.send({ files: [new AttachmentBuilder(cardBuffer, { name: 'welcome.png' })] });
  } catch (err) { console.error('\u274C Welcome error:', err); }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (!oldMember.premiumSince && newMember.premiumSince) await handleBoost(newMember, newMember.guild);
});

// \u2500\u2500 Message XP \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  // Ticket message tracking
  if (message.channel.name?.startsWith('ticket-')) {
    await onTicketMessage(message.guild, message.channel, message).catch(e => console.error('❌ onTicketMessage:', e));
    return;
  }
  const now = Date.now();
  const last = xpCooldowns.get(message.author.id) || 0;
  if (now - last < 60000) return;
  xpCooldowns.set(message.author.id, now);
  await addXP(message.author.id, message.author.username, 5, message.guild);
});

// ── Ticket channel detection ──────────────────────────────────────────────

client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  if (!channel.name.startsWith('ticket-')) return;
  await onTicketCreated(channel.guild, channel).catch(e => console.error('❌ onTicketCreated:', e));
});

// \u2500\u2500 Voice XP \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  if (!oldState.channelId && newState.channelId) handleVCJoin(member);
  else if (oldState.channelId && !newState.channelId) await handleVCLeave(member, guild);
});

// \u2500\u2500 Interactions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

client.on('interactionCreate', async (interaction) => {
  const guild = interaction.guild;

  // ── Ticket buttons ─────────────────────────────────────────────────────
  if (interaction.isButton() && (interaction.customId.startsWith('ticket_greet_') || interaction.customId.startsWith('ticket_read_'))) {
    await handleTicketButton(interaction, guild).catch(e => console.error('❌ handleTicketButton:', e));
    return;
  }

  // \u2500\u2500 Journal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (
    (interaction.isButton() && interaction.customId.startsWith('journal_')) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith('journal_')) ||
    (interaction.isModalSubmit() && interaction.customId.startsWith('journal_')) ||
    (interaction.isChatInputCommand() && interaction.commandName === 'journal')
  ) {
    await handleJournalInteraction(interaction, client);
    // Refresh trading leaderboard in background after any journal action
    if (guild) {
      getOrCreateTradingLbChannel(guild)
        .then(ch => { if (ch) postTradingLeaderboard(ch).catch(() => {}); })
        .catch(() => {});
    }
    return;
  }

  // \u2500\u2500 Trading leaderboard refresh button \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (interaction.isButton() && interaction.customId === 'trading_lb_refresh') {
    await handleTradingLbRefresh(interaction); return;
  }

  // \u2500\u2500 Rank \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (interaction.isButton() && interaction.customId === 'levels_check_rank') {
    await handleCheckRank(interaction, guild); return;
  }

  // \u2500\u2500 XP Chart \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (interaction.isButton() && interaction.customId === 'levels_view_xpchart') {
    await handleXPChart(interaction, '1w', false); return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('xpchart_')) {
    const tf = interaction.customId.replace('xpchart_', '');
    await handleXPChart(interaction, tf, true); return;
  }

  // \u2500\u2500 Shop navigation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (interaction.isButton() && interaction.customId.startsWith('shop_p_')) {
    const parts = interaction.customId.split('_');
    const category = parts[2];
    const page = parseInt(parts[3]) || 0;
    await handleShopNav(interaction, category, page); return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'shop_category') {
    await handleShopNav(interaction, interaction.values[0], 0); return;
  }

  // \u2500\u2500 Shop utility \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (interaction.isButton() && interaction.customId === 'shop_check_balance') { await handleCheckBalance(interaction); return; }
  if (interaction.isButton() && interaction.customId === 'shop_slot1') { await handleSlot1(interaction); return; }
  if (interaction.isButton() && interaction.customId === 'shop_slot2') { await handleSlot2(interaction); return; }
  if (interaction.isStringSelectMenu() && interaction.customId === 'shop_equip_earned') { await handleEquipSelect(interaction); return; }
  if (interaction.isStringSelectMenu() && interaction.customId === 'shop_equip_bought') { await handleEquipSelect(interaction); return; }
  if (interaction.isButton() && interaction.customId.startsWith('shop_buy_')) { await handleShopBuy(interaction, guild); return; }

  // \u2500\u2500 Slash commands \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (!interaction.isChatInputCommand()) return;

  // /xp-chart
  if (interaction.commandName === 'xp-chart') {
    await handleXPChart(interaction, '1w', false); return;
  }

  // /addpoints
  if (interaction.commandName === 'addpoints') {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('\u274C Admins only.');
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const db = loadLevelsDB();
    const user = getUser(db, target.id, target.username);
    user.points += amount;
    saveLevelsDB(db);
    await updateLeaderboard(guild);
    await interaction.editReply(`\u2705 Added **${amount} pts** to ${target.username}. New balance: **${user.points.toLocaleString()} pts**`);
    return;
  }

  // /calendar
  if (interaction.commandName === 'calendar') {
    await interaction.deferReply({ ephemeral: true });
    if (guild) await postWeeklyCalendar(guild, client);
    await interaction.editReply('\u{1F4C5} Calendar posted!');
    return;
  }

  // /setup-leaderboard
  if (interaction.commandName === 'setup-leaderboard') {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('\u274C Admins only.');
    try {
      const lbChannel = guild.channels.cache.get(process.env.LEADERBOARD_CHANNEL_ID);
      if (!lbChannel) return interaction.editReply('\u274C Leaderboard channel not found. Check LEADERBOARD_CHANNEL_ID.');
      const fetched = await lbChannel.messages.fetch({ limit: 100 });
      const botMsgs = fetched.filter(m => m.author.id === client.user.id);
      for (const [, msg] of botMsgs) {
        if (msg.pinned) await msg.unpin().catch(() => {});
        await msg.delete().catch(() => {});
      }
      const { getStore, markDirty } = require('./db');
      const store = getStore();
      if (store.levels) {
        delete store.levels.leaderboardMessageId;
        delete store.levels.levelsPanelMessageId;
      }
      markDirty();
      // 1. Repost leaderboard
      await updateLeaderboard(guild);
      // 2. Repost rank panel to rank channel
      const rankChannel = guild.channels.cache.get(process.env.RANK_CHANNEL_ID);
      if (rankChannel) {
        const rankFetched = await rankChannel.messages.fetch({ limit: 100 });
        for (const [, msg] of rankFetched.filter(m => m.author.id === client.user.id)) {
          if (msg.pinned) await msg.unpin().catch(() => {});
          await msg.delete().catch(() => {});
        }
        await postLevelsPanel(rankChannel);
      }
      await interaction.editReply('\u2705 Done! Leaderboard stays in leaderboard channel; rank panel reposted in your-rank channel.');
    } catch (err) {
      console.error('\u274C setup-leaderboard error:', err);
      await interaction.editReply('\u274C Error: ' + err.message);
    }
    return;
  }

  // /setup-shop
  if (interaction.commandName === 'setup-shop') {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('\u274C Admins only.');
    try {
      const shopChannel = guild.channels.cache.get(process.env.SHOP_CHANNEL_ID);
      if (!shopChannel) return interaction.editReply('\u274C Shop channel not found. Check SHOP_CHANNEL_ID.');
      const fetched = await shopChannel.messages.fetch({ limit: 100 });
      const botMsgs = fetched.filter(m => m.author.id === client.user.id);
      for (const [, msg] of botMsgs) {
        if (msg.pinned) await msg.unpin().catch(() => {});
        await msg.delete().catch(() => {});
      }
      const { getStore, markDirty } = require('./db');
      const store = getStore();
      if (store.levels) delete store.levels.shopMessageId;
      markDirty();
      await postShopPanel(shopChannel);
      await interaction.editReply('\u2705 Shop reset and reposted!');
    } catch (err) {
      console.error('\u274C setup-shop error:', err);
      await interaction.editReply('\u274C Error: ' + err.message);
    }
    return;
  }

  // /setup-start-here
  if (interaction.commandName === 'setup-start-here') {
    await postStartHerePanel(interaction, guild); return;
  }

  // /setup-rules
  if (interaction.commandName === 'setup-rules') {
    await postRulesPanel(interaction); return;
  }

  // /setup-trading-lb
  if (interaction.commandName === 'setup-trading-lb') {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('\u274C Admins only.');
    try {
      const { getStore, markDirty } = require('./db');
      const { loadDB: loadJournalDB } = require('./journal');
      const jdb = loadJournalDB();
      delete jdb._tradingLbMessageId;
      markDirty();
      const lbCh = await getOrCreateTradingLbChannel(guild);
      if (!lbCh) return interaction.editReply('\u274C No trading LB channel found. Set TRADING_LB_CHANNEL_ID env var.');
      // Clear existing bot messages in channel
      const fetched = await lbCh.messages.fetch({ limit: 100 });
      for (const [, msg] of fetched.filter(m => m.author.id === client.user.id)) {
        if (msg.pinned) await msg.unpin().catch(() => {});
        await msg.delete().catch(() => {});
      }
      await postTradingLeaderboard(lbCh);
      await interaction.editReply('\u2705 Trading leaderboard reposted!');
    } catch (err) {
      console.error('\u274C setup-trading-lb error:', err);
      await interaction.editReply('\u274C Error: ' + err.message);
    }
    return;
  }


  // /inventory
  if (interaction.commandName === 'inventory') {
    await interaction.deferReply({ ephemeral: false });
    if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('â Admins only.');
    try {
      const { EmbedBuilder } = require('discord.js');
      const target = interaction.options.getUser('user');
      const db = loadLevelsDB();
      const user = db.users?.[target.id];
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('ð¦ Inventory â ' + target.username)
        .setThumbnail(target.displayAvatarURL({ extension: 'png' }))
        .setFooter({ text: 'Elevate ðª½ â¢ Admin View' })
        .setTimestamp();
      if (!user) {
        embed.setDescription('â No data found for this user in the database.');
      } else {
        const SHOP_ROLE_IDS = { role_gold: 'ð Elevate Gold', role_platinum: 'ð  Elevate Platinum', role_elite: 'ð Elevate Elite' };
        const BADGE_IDS = { badge_rising: 'ð± Rising Star', badge_grinder: 'â¡ Grinder', badge_veteran: 'ð Veteran' };
        const ALL_ITEMS = { ...SHOP_ROLE_IDS, ...BADGE_IDS };
        const ownedItems = (user.inventory || []).map(id => ALL_ITEMS[id] ? ALL_ITEMS[id] + ' (`' + id + '`)' : '`' + id + '`');
        const log = (user.purchaseLog || []);
        const logLines = log.map(p => {
          const d = new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const tag = p.grantedByAdmin ? ' ð¡ï¸ admin grant' : '';
          return 'â¢ **' + (ALL_ITEMS[p.id] || p.id) + '** â ' + (p.price ? p.price.toLocaleString() + ' pts â ' : '') + d + tag;
        });
        embed.addFields(
          { name: 'ðª Points', value: (user.points || 0).toLocaleString() + ' pts', inline: true },
          { name: 'â¬ï¸ Level', value: String(user.level || 0), inline: true },
          { name: 'ð¦ Inventory (' + (user.inventory || []).length + ' items)', value: ownedItems.length ? ownedItems.join('\n') : '*Empty*', inline: false },
          { name: 'ð Purchase Log', value: logLines.length ? logLines.join('\n') : '*No history recorded yet (history added Jun 29, 2026 â only new purchases will appear)*', inline: false },
        );
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('â inventory error:', err);
      await interaction.editReply('â Error: ' + err.message).catch(() => {});
    }
    return;
  }

  // /giveitem
  if (interaction.commandName === 'giveitem') {
    await interaction.deferReply({ ephemeral: false });
    if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('â Admins only.');
    try {
      const target = interaction.options.getUser('user');
      const itemId = interaction.options.getString('item');
      const member = await guild.members.fetch(target.id).catch(() => null);
      const username = member?.user.username || target.username;
      const result = await giveItem(target.id, username, itemId, guild);
      if (!result.ok) return interaction.editReply('â ' + result.msg);
      const status = result.alreadyOwned ? 'already owned â role re-checked' : 'added to inventory';
      await interaction.editReply('â **' + result.item.name + '** ' + status + ' for ' + (member?.displayName || target.username) + '.');
    } catch (err) {
      console.error('â giveitem error:', err);
      await interaction.editReply('â Error: ' + err.message).catch(() => {});
    }
    return;
  }

  // /fixroles-all
  if (interaction.commandName === 'fixroles-all') {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('Admins only.');
    const dbData = loadLevelsDB();
    const userEntries = Object.entries(dbData.users || {});
    let fixed = 0, skipped = 0, errList = [];
    for (const [userId, u] of userEntries) {
      if (!(u.inventory || []).some(id => id.startsWith('role_'))) { skipped++; continue; }
      const result = await fixUserRole(userId, guild).catch(e => ({ ok: false, msg: e.message }));
      if (result.ok) fixed++;
      else errList.push(userId.slice(0, 8) + '\u2026: ' + result.msg);
    }
    const errMsg = errList.length ? '\n\nErrors:\n' + errList.slice(0, 5).join('\n') : '';
    return interaction.editReply(`\u2705 Done! Fixed: **${fixed}**, Skipped: **${skipped}**, Errors: **${errList.length}**${errMsg}`);
  }

  // /fixrole
  if (interaction.commandName === 'fixrole') {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('\u274C Admins only.');
    try {
      const target = interaction.options.getUser('user');
      const result = await fixUserRole(target.id, guild);
      if (!result.ok) return interaction.editReply('\u274C ' + result.msg);
      await interaction.editReply('\u2705 Role fixed: **' + result.role.roleName + '** \u2192 ' + result.member.displayName);
    } catch (err) {
      console.error('\u274C fixrole error:', err);
      await interaction.editReply('\u274C Error: ' + err.message).catch(() => {});
    }
    return;
  }
});

client.login(process.env.BOT_TOKEN);
