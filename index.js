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
const { postStartHerePanel } = require('./startHere');
const { postRulesPanel } = require('./setupRules');

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
console.log(`â Elevate Bot online as ${client.user.tag}`);

await loadAll();
console.log('â Database loaded.');

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
try {
await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
console.log('â Slash commands registered.');
} catch (err) { console.error('â Commands error:', err); }

const guild = client.guilds.cache.get(process.env.GUILD_ID);

// Journal panel â check stored message ID first, fall back to pinned scan
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
if (!exists) { await sendJournalPanel(journalChannel); console.log('â Journal panel posted.'); }
else console.log('ð Journal panel exists.');
}
}
} catch (err) { console.error('â Journal panel error:', err); }

// Leaderboard channel
// DISPLAY ORDER: ð Leaderboard embed FIRST (top), then ð Rank panel + button below.
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
const panelExists = pinned.some(m => m.author.id === client.user.id && m.embeds?.[0]?.title === 'ð Your Rank');
if (!panelExists) { await postLevelsPanel(lbChannel); console.log('â Rank panel posted.'); }
else console.log('ð Rank panel exists.');
}
}
} catch (err) { console.error('â Leaderboard error:', err); }

// Shop panel
try {
if (guild) {
const shopChannel = guild.channels.cache.get(process.env.SHOP_CHANNEL_ID);
if (shopChannel) {
const pinned = await shopChannel.messages.fetchPinned();
const shopExists = pinned.some(m => m.author.id === client.user.id && m.embeds?.[0]?.title === 'ð Elevate Shop');
if (!shopExists) { await postShopPanel(shopChannel); console.log('â Shop panel posted.'); }
else console.log('ð Shop panel exists.');
}
}
} catch (err) { console.error('â Shop panel error:', err); }

startPassiveXP(client);

cron.schedule('0 19 * * 0', async () => {
if (guild) await postWeeklyCalendar(guild, client);
}, { timezone: 'America/New_York' });

console.log('ð Weekly calendar scheduled: Sunday 7PM ET');

// NY session open â 9:30 AM ET, weekdays
cron.schedule('30 9 * * 1-5', async () => {
  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) return;
    const channel = guild.channels.cache.get(process.env.TRADING_CHANNEL_ID);
    if (!channel) { console.warn('â ï¸  NY session cron: TRADING_CHANNEL_ID not found'); return; }
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('ðºð¸ New York Session Open')
      .setDescription('> The **New York session** is now open (9:30 AM ET).\n> Stay disciplined, follow your plan, and manage your risk.')
      .addFields(
        { name: 'â° Session Hours', value: '9:30 AM â 4:00 PM ET', inline: true },
        { name: 'ð Key Markets', value: 'NQ, ES, SPY, Forex majors', inline: true },
      )
      .setFooter({ text: 'Elevate ðª½ â¢ Trading Room' })
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    console.log('â NY session open posted');
  } catch (err) { console.error('â NY session cron error:', err); }
}, { timezone: 'America/New_York' });

console.log('â° NY session open scheduled: weekdays 9:30 AM ET');
});

// Welcome
client.on('guildMemberAdd', async (member) => {
try {
const channel = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
if (!channel) return;
const joinTimestamp = Math.floor(member.joinedTimestamp / 1000);
await channel.send(`ð Welcome to the community, ${member}ðª½\nð¤ We are now **${member.guild.memberCount}** members!\nð Joined: <t:${joinTimestamp}:R>`);
const cardBuffer = await generateWelcomeCard(member);
await channel.send({ files: [new AttachmentBuilder(cardBuffer, { name: 'welcome.png' })] });
} catch (err) { console.error('â Welcome error:', err); }
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
(interaction.isStringSelectMenu() && interaction.customId.startsWith('journal_')) ||
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
if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('â Admins only.');
const target = interaction.options.getUser('user');
const amount = interaction.options.getInteger('amount');
const db = loadLevelsDB();
const user = getUser(db, target.id, target.username);
user.points += amount;
saveLevelsDB(db);
await updateLeaderboard(guild);
await interaction.editReply(`â Added **${amount} pts** to ${target.username}. New balance: **${user.points} pts**`);
}

// /calendar
if (interaction.commandName === 'calendar') {
await interaction.deferReply({ ephemeral: true });
if (guild) await postWeeklyCalendar(guild, client);
await interaction.editReply('ð Calendar posted!');
}

// /setup-leaderboard â admin command to delete and repost panels in correct order
// Order: ð Leaderboard embed (top) â ð Rank panel + button (below)
if (interaction.commandName === 'setup-leaderboard') {
await interaction.deferReply({ ephemeral: true });
if (!interaction.member.permissions.has('Administrator')) return interaction.editReply('â Admins only.');
try {
const lbChannel = guild.channels.cache.get(process.env.LEADERBOARD_CHANNEL_ID);
if (!lbChannel) return interaction.editReply('â Leaderboard channel not found. Check LEADERBOARD_CHANNEL_ID.');

// Delete all bot messages in the channel to start fresh
// Must unpin first â Discord won't delete pinned messages without unpin
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

await interaction.editReply('â Leaderboard channel reset! Order: ð Leaderboard (top) â ð Rank panel (below).');
} catch (err) {
console.error('â setup-leaderboard error:', err);
await interaction.editReply('â Error: ' + err.message);
}
}

// /setup-start-here
if (interaction.commandName === 'setup-start-here') {
await postStartHerePanel(interaction, guild);
}

// /setup-rules
if (interaction.commandName === 'setup-rules') {
await postRulesPanel(interaction);
}
});

client.login(process.env.BOT_TOKEN);
