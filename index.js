require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const { generateWelcomeCard } = require('./welcomeCard');
const { postWeeklyCalendar } = require('./economicCalendar');
const { handleJournalInteraction, sendJournalPanel, loadDB: loadJournalDB } = require('./journal');
const {
  addXP, handleBoost, updateLeaderboard,
  postLevelsPanel, postShopPanel,
  handleCheckRank, handleCheckBalance, handleShopBuy,
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

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (err) { console.error('❌ Commands error:', err); }

  const guild = client.guilds.cache.get(process.env.GUILD_ID);

  // ── Journal panel ───────────────────────────────────────────────────────────
  try {
    if (guild) {
      const journalChannel = guild.channels.cache.get(process.env.JOURNAL_CHANNEL_ID);
      if (journalChannel) {
        const threads = await journalChannel.threads.fetchActive();
        const exists = threads.threads.some(t => t.name === '📝 Log a Trade — Click Here');
        if (!exists) {
          await sendJournalPanel(journalChannel);
          console.log('✅ Journal panel posted.');
        } else {
          console.log('📌 Journal panel already exists.');
        }
      }
    }
  } catch (err) { console.error('❌ Journal panel error:', err); }

  // ── Levels panel ────────────────────────────────────────────────────────────
  try {
    if (guild) {
      const levelsChannel = guild.channels.cache.get(process.env.LEVELS_CHANNEL_ID);
      if (levelsChannel) {
        const pinned = await levelsChannel.messages.fetchPinned();
        const panelExists = pinned.some(m =>
          m.author.id === client.user.id &&
          m.embeds?.[0]?.title === '📊 Your Rank'
        );
        if (!panelExists) {
          await postLevelsPanel(levelsChannel);
          console.log('✅ Levels panel posted.');
        } else {
          console.log('📌 Levels panel already exists.');
        }
        await updateLeaderboard(guild);
      }
    }
  } catch (err) { console.error('❌ Levels panel error:', err); }

  // ── Shop panel ──────────────────────────────────────────────────────────────
  try {
    if (guild) {
      const shopChannel = guild.channels.cache.get(process.env.SHOP_CHANNEL_ID);
      if (shopChannel) {
        const pinned = await shopChannel.messages.fetchPinned();
        const shopExists = pinned.some(m =>
          m.author.id === client.user.id &&
          m.embeds?.[0]?.title === '🛒 Elevate Shop'
        );
        if (!shopExists) {
          await postShopPanel(shopChannel);
          console.log('✅ Shop panel posted.');
        } else {
          console.log('🛒 Shop panel already exists.');
        }
      }
    }
  } catch (err) { console.error('❌ Shop panel error:', err); }

  // ── Passive XP + calendar ───────────────────────────────────────────────────
  startPassiveXP(client);

  cron.schedule('0 19 * * 0', async () => {
    if (guild) await postWeeklyCalendar(guild, client);
  }, { timezone: 'America/New_York' });

  console.log('📅 Weekly calendar scheduled: Sunday 7PM ET');
});

// ── Welcome ───────────────────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  try {
    const channel = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
    if (!channel) return;
    const joinTimestamp = Math.floor(member.joinedTimestamp / 1000);
    await channel.send(
      `🎉 Welcome to the community, ${member}🪽\n` +
      `👤 We are now **${member.guild.memberCount}** members!\n` +
      `🕐 Joined: <t:${joinTimestamp}:R>`
    );
    const cardBuffer = await generateWelcomeCard(member);
    const attachment = new AttachmentBuilder(cardBuffer, { name: 'welcome.png' });
    await channel.send({ files: [attachment] });
  } catch (err) { console.error('❌ Welcome error:', err); }
});

// ── Boost detection ───────────────────────────────────────────────────────────
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (!oldMember.premiumSince && newMember.premiumSince) {
    await handleBoost(newMember, newMember.guild);
  }
});

// ── Message XP ────────────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const now = Date.now();
  const last = xpCooldowns.get(message.author.id) || 0;
  if (now - last < 60000) return;
  xpCooldowns.set(message.author.id, now);
  await addXP(message.author.id, message.author.username, 5, message.guild);
});

// ── VC XP ─────────────────────────────────────────────────────────────────────
client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  if (!oldState.channelId && newState.channelId) handleVCJoin(member);
  else if (oldState.channelId && !newState.channelId) await handleVCLeave(member, guild);
});

// ── Interactions ──────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  const guild = interaction.guild;

  // Journal
  if (
    (interaction.isButton() && interaction.customId.startsWith('journal_')) ||
    (interaction.isModalSubmit() && interaction.customId.startsWith('journal_')) ||
    (interaction.isChatInputCommand() && interaction.commandName === 'journal')
  ) {
    await handleJournalInteraction(interaction, client);
    return;
  }

  // Check My Rank button
  if (interaction.isButton() && interaction.customId === 'levels_check_rank') {
    await handleCheckRank(interaction, guild);
    return;
  }

  // Check My Balance button
  if (interaction.isButton() && interaction.customId === 'shop_check_balance') {
    await handleCheckBalance(interaction);
    return;
  }

  // Shop buy buttons
  if (interaction.isButton() && interaction.customId.startsWith('shop_buy_')) {
    await handleShopBuy(interaction, guild);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  // /addpoints (admin)
  if (interaction.commandName === 'addpoints') {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.editReply('❌ Admins only.');
    }
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
});

client.login(process.env.BOT_TOKEN);
