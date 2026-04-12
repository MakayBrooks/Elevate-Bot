require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, AttachmentBuilder } = require('discord.js');
const cron = require('node-cron');
const { generateWelcomeCard } = require('./welcomeCard');
const { postWeeklyCalendar } = require('./economicCalendar');
const { handleJournalInteraction, sendJournalPanel } = require('./journal');
const commands = require('./commands');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

client.once('ready', async () => {
  console.log(`✅ Elevate Bot online as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }

  // ── Auto-post journal panel on startup ──────────────────────────────────────
  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) {
      const journalChannel = guild.channels.cache.get(process.env.JOURNAL_CHANNEL_ID);
      if (journalChannel) {
        const { loadDB } = require('./journal');
        const db = loadDB();
        const shouldPost = !db._panelPosted || process.env.RESET_PANEL === 'true';
        if (shouldPost) {
          await sendJournalPanel(journalChannel);
          console.log('✅ Journal panel posted.');
        } else {
          console.log('📌 Journal panel already exists, skipping.');
        }
      } else {
        console.warn('⚠️  JOURNAL_CHANNEL_ID not found.');
      }
    }
  } catch (err) {
    console.error('❌ Journal panel error:', err);
  }

  // ── Weekly calendar: every Sunday 7PM ET ───────────────────────────────────
  cron.schedule('0 19 * * 0', async () => {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) await postWeeklyCalendar(guild, client);
  }, { timezone: 'America/New_York' });

  console.log('📅 Weekly calendar scheduled: Sunday 7PM ET');
});

// ── Welcome new members ───────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  try {
    const channel = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
    if (!channel) return console.warn('⚠️  WELCOME_CHANNEL_ID not set');

    const joinTimestamp = Math.floor(member.joinedTimestamp / 1000);
    const memberCount = member.guild.memberCount;

    await channel.send(
      `🎉 Welcome to the community, ${member}🪽\n` +
      `👤 We are now **${memberCount}** members!\n` +
      `🕐 Joined: <t:${joinTimestamp}:R>`
    );

    const cardBuffer = await generateWelcomeCard(member);
    const attachment = new AttachmentBuilder(cardBuffer, { name: 'welcome.png' });
    await channel.send({ files: [attachment] });

  } catch (err) {
    console.error('❌ Welcome error:', err);
  }
});

// ── All interactions ──────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // Journal button + modals
  if (
    (interaction.isButton() && interaction.customId.startsWith('journal_')) ||
    (interaction.isModalSubmit() && interaction.customId.startsWith('journal_')) ||
    (interaction.isChatInputCommand() && interaction.commandName === 'journal')
  ) {
    await handleJournalInteraction(interaction, client);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'calendar') {
    await interaction.deferReply({ ephemeral: true });
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) await postWeeklyCalendar(guild, client);
    await interaction.editReply('📅 Weekly calendar posted!');
    return;
  }
});

client.login(process.env.BOT_TOKEN);
