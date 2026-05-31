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
  handleVCJoin, handleVCLeave, startPassiveXP,
  getUser, loadDB: loadLevelsDB, saveDB: saveLevelsDB
} = require('./levels');
const commands = require('./commands');
const { postTicketCard, markTicketUpdated, runTicketCatchup } = require('./tickets');
const { postTradingLeaderboard } = require('./trading-leaderboard');
const { loadDB: loadJournalDB } = require('./journal');

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

  // Journal panel
  try {
    if (guild) {
      const journalChannel = guild.channels.cache.get(process.env.JOURNAL_CHANNEL_ID);
      if (journalChannel) {
        const pinned = await journalChannel.messages.fetchPinned();
        const exists = pinned.some(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.includes('Trading Journal'));
        if (!exists) { await sendJournalPanel(journalChannel); console.log('✅ Journal panel posted.'); }
        else console.log('📌 Journal panel exists.');
      }
    }
  } catch (err) { console.error('❌ Journal panel error:', err); }

  // Leaderboard channel
  try {
    if (guild) {
      const lbChannel = guild.channels.cache.get(process.env.LEADERBOARD_CHANNEL_ID);
      if (lbChannel) {
        const pinned = await lbChannel.messages.fetchPinned();
        const panelExists = pinned.some(m => m.author.id === client.user.id && m.embeds?.[0]?.title === '📊 Your Rank');
        if (!panelExists) { await postLevelsPanel(lbChannel); console.log('✅ Rank panel posted.'); }
        else console.log('📌 Rank panel exists.');
        await updateLeaderboard(guild);
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


  // Trading leaderboard panel
  try {
    if (guild) {
      const lbChannel2 = guild.channels.cache.get(process.env.LEADERBOARD_CHANNEL_ID);
      if (lbChannel2) {
        await postTradingLeaderboard(lbChannel2, guild);
        console.log('✅ Trading leaderboard panel ready.');
      }
    }
  } catch (err) { console.error('❌ Trading leaderboard error:', err); }

  // Ticket catch-up cards
  try {
    if (guild) {
      const ticketsAdminCh = guild.channels.cache.get(process.env.TICKETS_CHANNEL_ID);
      if (ticketsAdminCh) {
        await runTicketCatchup(guild, ticketsAdminCh);
      }
    }
  } catch (err) { console.error('❌ Ticket catchup error:', err); }

  startPassiveXP(client);

  cron.schedule('0 19 * * 0', async () => {
    if (guild) await postWeeklyCalendar(guild, client);
  }, { timezone: 'America/New_York' });


  // Trade of the Week — Sunday 8PM ET
  cron.schedule('0 20 * * 0', async () => {
    try {
      if (!guild) return;
      const winsChannel = guild.channels.cache.get(process.env.WINS_CHANNEL_ID);
      if (!winsChannel) return;
      const journalDb = loadJournalDB();
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      let bestTrade = null, bestRR = -1, bestUserId = null;
      for (const [userId, userData] of Object.entries(journalDb)) {
        if (userId.startsWith('_') || !userData || !userData.trades) continue;
        for (const trade of userData.trades) {
          if (!trade.timestamp || new Date(trade.timestamp) < weekAgo) continue;
          const m = (trade.rr || '').match(/([\d.]+)\s*:\s*([\d.]+)/);
          if (m) {
            const rr = parseFloat(m[2]) / parseFloat(m[1]);
            if (rr > bestRR) { bestRR = rr; bestTrade = trade; bestUserId = userId; }
          }
        }
      }
      if (!bestTrade || !bestUserId) { console.log('📅 No trades logged this week — skipping Trade of the Week.'); return; }
      const winner = await guild.members.fetch(bestUserId).catch(() => null);
      const { EmbedBuilder: EB } = require('discord.js');
      const embed = new EB()
        .setColor(0xffd700)
        .setTitle('🏆 Trade of the Week!')
        .setDescription('Congrats to **' + (winner ? winner.displayName : 'Unknown') + '** for the best trade this week! 🎉')
        .addFields(
          { name: '📊 Pair', value: bestTrade.pair || 'N/A', inline: true },
          { name: '⚖️ R:R', value: bestTrade.rr || 'N/A', inline: true },
          { name: '✅ Outcome', value: bestTrade.outcome || 'N/A', inline: true },
          { name: '💰 PnL', value: bestTrade.pnl || 'N/A', inline: true },
          { name: '🌐 Session', value: bestTrade.session || 'N/A', inline: true },
        )
        .setThumbnail(winner ? winner.user.displayAvatarURL({ extension: 'png' }) : null)
        .setFooter({ text: 'Elevate 🪽 • Trade of the Week' })
        .setTimestamp();
      await winsChannel.send({ embeds: [embed] });
      console.log('🏆 Trade of the Week posted!');
    } catch (err) { console.error('❌ Trade of the Week error:', err); }
  }, { timezone: 'America/New_York' });

  // NY Open — weekdays 9:30 AM ET
  cron.schedule('30 9 * * 1-5', async () => {
    try {
      if (!guild) return;
      const ch = guild.channels.cache.get(process.env.TRADE_RECAPS_CHANNEL_ID);
      if (!ch) return;
      const now = new Date();
      const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
      const dateStr = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
      const { EmbedBuilder: EB2 } = require('discord.js');
      const embed = new EB2()
        .setColor(0x57F287)
        .setTitle('🔔 New York Open')
        .setDescription('**' + dayName + ', ' + dateStr + '**\n\n> The New York session is now live. Stay focused, trust your process. Let\'s get it. 🇺🇸')
        .setFooter({ text: 'Elevate 🪽 • Market Open' })
        .setTimestamp();
      await ch.send({ embeds: [embed] });
    } catch (err) { console.error('❌ NY Open error:', err); }
  }, { timezone: 'America/New_York' });

  // London Open — weekdays 2:00 AM ET
  cron.schedule('0 2 * * 1-5', async () => {
    try {
      if (!guild) return;
      const ch = guild.channels.cache.get(process.env.TRADE_RECAPS_CHANNEL_ID);
      if (!ch) return;
      const now = new Date();
      const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
      const dateStr = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
      const { EmbedBuilder: EB3 } = require('discord.js');
      const embed = new EB3()
        .setColor(0x5865F2)
        .setTitle('🇬🇧 London Open')
        .setDescription('**' + dayName + ', ' + dateStr + '**\n\n> The London session is now live. Early birds get the move. Stay sharp. 🏴󠁧󠁢󠁥󠁮󠁧󠁿')
        .setFooter({ text: 'Elevate 🪽 • Market Open' })
        .setTimestamp();
      await ch.send({ embeds: [embed] });
    } catch (err) { console.error('❌ London Open error:', err); }
  }, { timezone: 'America/New_York' });

  console.log('✅ Cron jobs scheduled: Trade of Week (Sun 8PM), NY Open (9:30AM), London Open (2AM)');
  console.log('📅 Weekly calendar scheduled: Sunday 7PM ET');
});


// Ticket channel created — post card to admin tickets channel
client.on('channelCreate', async (channel) => {
  try {
    const categoryId = process.env.TICKETS_CATEGORY_ID;
    if (!categoryId || channel.parentId !== categoryId) return;
    const guild = channel.guild;
    const adminCh = guild.channels.cache.get(process.env.TICKETS_CHANNEL_ID);
    if (!adminCh) return;
    // Wait briefly for first message
    await new Promise(r => setTimeout(r, 3000));
    const messages = await channel.messages.fetch({ limit: 5 }).catch(() => null);
    const firstMsg = messages ? messages.filter(m => !m.author.bot).last() : null;
    await postTicketCard(guild, channel, adminCh, firstMsg);
  } catch (err) { console.error('❌ channelCreate ticket error:', err); }
});
// Welcome
client.on('guildMemberAdd', async (member) => {
  try {
    const channel = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
    if (!channel) return;
    const joinTimestamp = Math.floor(member.joinedTimestamp / 1000);
    await channel.send(`🎉 Welcome to the community, ${member}🪽
👤 We are now **${member.guild.memberCount}** members!
🕐 Joined: <t:${joinTimestamp}:R>`);
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
  // Check if message is in a ticket channel
  const ticketCategoryId = process.env.TICKETS_CATEGORY_ID;
  if (ticketCategoryId && message.channel.parentId === ticketCategoryId) {
    const ticketsAdminCh = message.guild.channels.cache.get(process.env.TICKETS_CHANNEL_ID);
    if (ticketsAdminCh) markTicketUpdated(message.guild, message.channel, ticketsAdminCh).catch(() => {});
  }
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
  try {
    const guild = interaction.guild;

    // Journal
    if (
      (interaction.isButton() && interaction.customId.startsWith('journal_')) ||
      (interaction.isModalSubmit() && interaction.customId.startsWith('journal_')) ||
      (interaction.isStringSelectMenu() && interaction.customId.startsWith('journal_')) ||
      (interaction.isChatInputCommand() && interaction.commandName === 'journal')
    ) { await handleJournalInteraction(interaction, client); return; }

    // Trading leaderboard refresh
    if (interaction.isButton() && interaction.customId === 'trading_lb_refresh') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const lbCh = guild.channels.cache.get(process.env.LEADERBOARD_CHANNEL_ID);
        if (lbCh) await postTradingLeaderboard(lbCh, guild);
        await interaction.editReply('✅ Trading leaderboard refreshed!');
      } catch (err) {
        console.error('❌ Trading LB refresh error:', err);
        await interaction.editReply('❌ Error refreshing leaderboard.').catch(() => {});
      }
      return;
    }
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
  } catch (err) {
    console.error('Unhandled interaction error:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '❌ Something went wrong. Please try again.' });
      } else {
        await interaction.reply({ content: '❌ Something went wrong. Please try again.', ephemeral: true });
      }
    } catch {}
  }
});

client.login(process.env.BOT_TOKEN);
