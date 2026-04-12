const { EmbedBuilder, ThreadAutoArchiveDuration, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'journals.json');

// ── Simple JSON file-based storage ──────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify({}));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function getUserJournal(userId) {
  const db = loadDB();
  if (!db[userId]) db[userId] = { trades: [], threadId: null };
  return { db, user: db[userId] };
}

// ── Get or create a private thread for this user ─────────────────────────────
async function getOrCreateThread(member, channel, db, userRecord) {
  // Try to find existing thread
  if (userRecord.threadId) {
    try {
      const existing = await channel.threads.fetch(userRecord.threadId);
      if (existing) return existing;
    } catch { /* thread deleted, make a new one */ }
  }

  // Create a new private thread
  const thread = await channel.threads.create({
    name: `📒 ${member.user.username}'s Journal`,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    type: ChannelType.PrivateThread,
    reason: `Trading journal for ${member.user.username}`,
  });

  // Add only the user to the thread
  await thread.members.add(member.user.id);

  // Save thread ID
  userRecord.threadId = thread.id;
  saveDB(db);

  // Post intro message
  await thread.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xF5F0E8)
        .setTitle('📒 Your Private Trading Journal')
        .setDescription(
          `Hey ${member}, this is your **private journal thread**.\n\n` +
          `Only you (and server admins) can see this.\n\n` +
          `Use \`/journal log\` to add trades and \`/journal stats\` for your summary.`
        )
        .setFooter({ text: 'Elevate 🪽 • Private Journal' })
    ]
  });

  return thread;
}

// ── Handle all journal subcommands ───────────────────────────────────────────
async function handleJournalCommand(interaction, client) {
  const sub = interaction.options.getSubcommand();

  // Defer ephemerally for privacy
  await interaction.deferReply({ ephemeral: true });

  const journalChannel = interaction.guild.channels.cache.get(process.env.JOURNAL_CHANNEL_ID);
  if (!journalChannel) {
    return interaction.editReply('⚠️ Journal channel not configured. Ask an admin to set `JOURNAL_CHANNEL_ID` in the bot config.');
  }

  const { db, user: userRecord } = getUserJournal(interaction.user.id);
  const member = await interaction.guild.members.fetch(interaction.user.id);

  // ── LOG ──────────────────────────────────────────────────────────────────
  if (sub === 'log') {
    const pair = interaction.options.getString('pair').toUpperCase();
    const direction = interaction.options.getString('direction');
    const result = interaction.options.getString('result');
    const pnl = interaction.options.getNumber('pnl');
    const notes = interaction.options.getString('notes') || '';
    const timestamp = new Date().toISOString();

    const trade = { id: Date.now(), pair, direction, result, pnl, notes, timestamp };
    userRecord.trades.push(trade);
    saveDB(db);

    // Post to their private thread
    const thread = await getOrCreateThread(member, journalChannel, db, userRecord);

    const resultEmoji = result === 'Win' ? '✅' : result === 'Loss' ? '❌' : '➖';
    const dirEmoji = direction === 'Long' ? '📈' : '📉';
    const pnlStr = pnl >= 0 ? `+$${pnl}` : `-$${Math.abs(pnl)}`;
    const pnlColor = result === 'Win' ? 0x00c853 : result === 'Loss' ? 0xff1744 : 0xF5F0E8;

    const tradeEmbed = new EmbedBuilder()
      .setColor(pnlColor)
      .setTitle(`${resultEmoji} Trade #${userRecord.trades.length} — ${pair}`)
      .addFields(
        { name: 'Direction', value: `${dirEmoji} ${direction}`, inline: true },
        { name: 'Result', value: `${resultEmoji} ${result}`, inline: true },
        { name: 'P&L', value: `**${pnlStr}**`, inline: true },
        ...(notes ? [{ name: 'Notes', value: notes, inline: false }] : [])
      )
      .setTimestamp(new Date(timestamp))
      .setFooter({ text: 'Elevate 🪽 • Private Journal' });

    await thread.send({ embeds: [tradeEmbed] });

    await interaction.editReply(`✅ Trade logged! Check your private journal thread in <#${journalChannel.id}>.`);
  }

  // ── VIEW ─────────────────────────────────────────────────────────────────
  else if (sub === 'view') {
    if (userRecord.trades.length === 0) {
      return interaction.editReply('📒 You have no trades logged yet. Use `/journal log` to add one!');
    }

    const thread = await getOrCreateThread(member, journalChannel, db, userRecord);
    await interaction.editReply(`📒 Your journal is in <#${thread.id}> — only you can see it!`);
  }

  // ── STATS ────────────────────────────────────────────────────────────────
  else if (sub === 'stats') {
    const trades = userRecord.trades;
    if (trades.length === 0) {
      return interaction.editReply('📊 No trades yet. Log some trades first with `/journal log`!');
    }

    const wins = trades.filter(t => t.result === 'Win').length;
    const losses = trades.filter(t => t.result === 'Loss').length;
    const be = trades.filter(t => t.result === 'Breakeven').length;
    const winRate = ((wins / trades.length) * 100).toFixed(1);
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const bestTrade = trades.reduce((a, b) => a.pnl > b.pnl ? a : b);
    const worstTrade = trades.reduce((a, b) => a.pnl < b.pnl ? a : b);

    // Most traded pair
    const pairCount = {};
    trades.forEach(t => pairCount[t.pair] = (pairCount[t.pair] || 0) + 1);
    const topPair = Object.entries(pairCount).sort((a, b) => b[1] - a[1])[0][0];

    const statsEmbed = new EmbedBuilder()
      .setColor(totalPnl >= 0 ? 0x00c853 : 0xff1744)
      .setTitle(`📊 ${interaction.user.username}'s Trading Stats`)
      .addFields(
        { name: '📋 Total Trades', value: `${trades.length}`, inline: true },
        { name: '🏆 Win Rate', value: `${winRate}%`, inline: true },
        { name: '💰 Total P&L', value: totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`, inline: true },
        { name: '✅ Wins', value: `${wins}`, inline: true },
        { name: '❌ Losses', value: `${losses}`, inline: true },
        { name: '➖ Breakeven', value: `${be}`, inline: true },
        { name: '🔥 Best Trade', value: `${bestTrade.pair} +$${bestTrade.pnl}`, inline: true },
        { name: '💀 Worst Trade', value: `${worstTrade.pair} -$${Math.abs(worstTrade.pnl)}`, inline: true },
        { name: '📌 Most Traded', value: topPair, inline: true },
      )
      .setFooter({ text: 'Elevate 🪽 • Private — only you can see this' })
      .setTimestamp();

    await interaction.editReply({ embeds: [statsEmbed] });
  }
}

module.exports = { handleJournalCommand };
