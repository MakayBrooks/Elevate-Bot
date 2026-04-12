require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const cron = require('node-cron');
const { generateWelcomeCard } = require('./welcomeCard');
const { postWeeklyCalendar } = require('./economicCalendar');
const { handleJournalCommand } = require('./journal');
const commands = require('./commands');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// ── Ready ────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Elevate Bot online as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }

  // Schedule weekly calendar: every Sunday at 7:00 PM Eastern
  cron.schedule('0 19 * * 0', async () => {
    console.log('📅 Posting weekly economic calendar...');
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) await postWeeklyCalendar(guild, client);
  }, { timezone: 'America/New_York' });

  console.log('📅 Weekly calendar scheduled: Sunday 7PM ET');
});

// ── New member welcome ───────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  try {
    const channel = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
    if (!channel) return console.warn('⚠️  WELCOME_CHANNEL_ID not set in .env');

    const embed = await generateWelcomeCard(member);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('❌ Welcome error:', err);
  }
});

// ── Slash commands ───────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'journal') {
    await handleJournalCommand(interaction, client);
  }

  if (interaction.commandName === 'calendar') {
    await interaction.deferReply({ ephemeral: true });
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) await postWeeklyCalendar(guild, client);
    await interaction.editReply('📅 Weekly calendar posted!');
  }
});

client.login(process.env.BOT_TOKEN);
