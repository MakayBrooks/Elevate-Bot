const {
  EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, ThreadAutoArchiveDuration
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'journals.json');

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

function getUserRecord(userId) {
  const db = loadDB();
  if (!db[userId]) db[userId] = { trades: [], threadId: null };
  return { db, user: db[userId] };
}

// ── Get or create the user's forum post ──────────────────────────────────────
async function getOrCreateForumThread(member, forumChannel, db, userRecord) {
  if (userRecord.threadId) {
    try {
      const existing = await forumChannel.threads.fetch(userRecord.threadId);
      if (existing && !existing.archived) return existing;
      if (existing && existing.archived) {
        await existing.setArchived(false);
        return existing;
      }
    } catch { /* thread deleted, make new one */ }
  }

  const thread = await forumChannel.threads.create({
    name: `📒 ${member.user.username}`,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    message: {
      embeds: [
        new EmbedBuilder()
          .setColor(0xF5F0E8)
          .setTitle(`📒 ${member.user.username}'s Trading Journal`)
          .setDescription(
            `> This is **${member.user.username}'s** private trading journal.\n\n` +
            `All trade entries are logged here automatically.\n` +
            `📎 **Attach chart screenshots directly in this thread after each entry.**`
          )
          .setThumbnail(member.user.displayAvatarURL({ extension: 'png' }))
          .setFooter({ text: 'Elevate 🪽 • Trading Journal' })
          .setTimestamp()
      ]
    }
  });

  userRecord.threadId = thread.id;
  saveDB(db);
  return thread;
}

// ── Send the journal panel as a pinned forum post ────────────────────────────
async function sendJournalPanel(forumChannel) {
  const embed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('📒 Elevate Trading Journal')
    .setDescription(
      '> Log your trades, track your progress, and build discipline.\n\n' +
      '**Click the button below to log a new trade.**\n' +
      'Your journal is private — only you can see your entries.\n\n' +
      '📎 After submitting, attach any chart screenshots directly in your thread.'
    )
    .addFields(
      { name: '📊 What gets logged', value: 'Pair • Date & Session • Confluences • Position • R:R • Outcome • PnL • Notes', inline: false },
    )
    .setFooter({ text: 'Elevate 🪽 • Private Trading Journal' })
    .setTimestamp();

  const button = new ButtonBuilder()
    .setCustomId('journal_open_modal_1')
    .setLabel('📝 Log a Trade')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  // Post as a forum thread
  const thread = await forumChannel.threads.create({
    name: '📝 Log a Trade — Click Here',
    message: { embeds: [embed], components: [row] },
    reason: 'Journal panel',
  });

  // Mark as posted in DB so we don't repost on restart
  const db = loadDB();
  db._panelPosted = true;
  db._panelThreadId = thread.id;
  saveDB(db);

  return thread;
}

module.exports = { handleJournalInteraction, sendJournalPanel, loadDB };

// ── Modal 1: Trade Setup ──────────────────────────────────────────────────────
function buildModal1() {
  return new ModalBuilder()
    .setCustomId('journal_modal_1')
    .setTitle('📝 Log Trade — Setup (1/2)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pair')
          .setLabel('Pair / Asset (e.g. EUR/USD, NQ, AAPL)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('EUR/USD')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('datetime')
          .setLabel('Date & Time (e.g. Apr 12 2026, 9:30am)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('Apr 12 2026, 9:30am')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('session')
          .setLabel('Session (London / New York / Asia)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('New York')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('position')
          .setLabel('Position (Long / Short)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('Long')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('confluences')
          .setLabel('Confluences (your tags, comma separated)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder('e.g. HTF OB, FVG, London sweep, CRT')
      )
    );
}

// ── Modal 2: Trade Result ─────────────────────────────────────────────────────
function buildModal2() {
  return new ModalBuilder()
    .setCustomId('journal_modal_2')
    .setTitle('📝 Log Trade — Result (2/2)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rr')
          .setLabel('Risk/Reward Ratio (e.g. 1:2 or 2.76)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('1:2')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('outcome')
          .setLabel('Outcome (Win / Loss / Breakeven)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('Win')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pnl')
          .setLabel('PnL (e.g. +$250 or -$80)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('+$250')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('notes')
          .setLabel('Post Trade Clarity / Notes')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder('What did you do well? What could be better?')
      )
    );
}

// ── Build the final trade embed ───────────────────────────────────────────────
function buildTradeEmbed(member, data, tradeNumber) {
  const outcome = data.outcome.trim().toLowerCase();
  const position = data.position.trim().toLowerCase();

  const outcomeEmoji = outcome.startsWith('w') ? '✅' : outcome.startsWith('l') ? '❌' : '➖';
  const outcomeLabel = outcome.startsWith('w') ? 'Win' : outcome.startsWith('l') ? 'Loss' : 'Breakeven';
  const posEmoji = position.startsWith('l') ? '📈' : '📉';
  const posLabel = position.startsWith('l') ? 'Long' : 'Short';
  const color = outcome.startsWith('w') ? 0x00c853 : outcome.startsWith('l') ? 0xff1744 : 0xaaaaaa;

  const sessionEmojis = { london: '🇬🇧', 'new york': '🇺🇸', newyork: '🇺🇸', ny: '🇺🇸', asia: '🌏' };
  const sessionKey = data.session.trim().toLowerCase().replace(/\s/g, '');
  const sessionEmoji = sessionEmojis[sessionKey] || sessionEmojis[data.session.trim().toLowerCase()] || '🌐';

  const confluenceTags = data.confluences
    ? data.confluences.split(',').map(t => `\`${t.trim()}\``).join(' ')
    : '`None`';

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: `${member.user.username} • Trade #${tradeNumber}`,
      iconURL: member.user.displayAvatarURL({ extension: 'png' })
    })
    .setTitle(`${outcomeEmoji} ${data.pair.toUpperCase()} — ${outcomeLabel}`)
    .addFields(
      { name: '📅 Date & Time', value: data.datetime, inline: true },
      { name: `${sessionEmoji} Session`, value: data.session, inline: true },
      { name: `${posEmoji} Position`, value: posLabel, inline: true },
      { name: '⚖️ Risk/Reward', value: `\`${data.rr}\``, inline: true },
      { name: `${outcomeEmoji} Outcome`, value: outcomeLabel, inline: true },
      { name: '💰 PnL', value: `**${data.pnl}**`, inline: true },
      { name: '🔗 Confluences', value: confluenceTags, inline: false },
      ...(data.notes ? [{ name: '🧠 Post Trade Clarity', value: data.notes, inline: false }] : []),
      { name: '📎 Charts', value: 'Attach screenshots below this message ↓', inline: false }
    )
    .setFooter({ text: 'Elevate 🪽 • Trading Journal' })
    .setTimestamp();
}

// ── Handle all journal interactions ──────────────────────────────────────────
async function handleJournalInteraction(interaction, client) {
  const forumChannel = interaction.guild.channels.cache.get(process.env.JOURNAL_CHANNEL_ID);

  // Button: open modal 1
  if (interaction.isButton() && interaction.customId === 'journal_open_modal_1') {
    await interaction.showModal(buildModal1());
    return;
  }

  // Modal 1 submit: store data, open modal 2
  if (interaction.isModalSubmit() && interaction.customId === 'journal_modal_1') {
    const db = loadDB();
    if (!db._pending) db._pending = {};
    db._pending[interaction.user.id] = {
      pair: interaction.fields.getTextInputValue('pair'),
      datetime: interaction.fields.getTextInputValue('datetime'),
      session: interaction.fields.getTextInputValue('session'),
      position: interaction.fields.getTextInputValue('position'),
      confluences: interaction.fields.getTextInputValue('confluences'),
    };
    saveDB(db);
    await interaction.showModal(buildModal2());
    return;
  }

  // Modal 2 submit: combine data, post to forum thread
  if (interaction.isModalSubmit() && interaction.customId === 'journal_modal_2') {
    await interaction.deferReply({ ephemeral: true });

    const db = loadDB();
    const pending = db._pending?.[interaction.user.id];
    if (!pending) {
      return interaction.editReply('⚠️ Something went wrong — please start over by clicking the button again.');
    }

    const data = {
      ...pending,
      rr: interaction.fields.getTextInputValue('rr'),
      outcome: interaction.fields.getTextInputValue('outcome'),
      pnl: interaction.fields.getTextInputValue('pnl'),
      notes: interaction.fields.getTextInputValue('notes'),
    };

    delete db._pending[interaction.user.id];

    const { user: userRecord } = getUserRecord(interaction.user.id);
    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (!forumChannel) {
      return interaction.editReply('⚠️ Journal forum channel not found. Check JOURNAL_CHANNEL_ID.');
    }

    userRecord.trades.push({ ...data, timestamp: new Date().toISOString() });
    db[interaction.user.id] = userRecord;
    saveDB(db);

    const thread = await getOrCreateForumThread(member, forumChannel, db, userRecord);
    const embed = buildTradeEmbed(member, data, userRecord.trades.length);
    await thread.send({ embeds: [embed] });

    await interaction.editReply(
      `✅ Trade #${userRecord.trades.length} logged in your journal! Attach any chart screenshots directly in your thread.`
    );
    return;
  }

  // Legacy slash command stats
  if (interaction.isChatInputCommand() && interaction.commandName === 'journal') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'stats') {
      await interaction.deferReply({ ephemeral: true });
      const { user: userRecord } = getUserRecord(interaction.user.id);
      const trades = userRecord.trades;
      if (!trades.length) return interaction.editReply('No trades logged yet!');

      const wins = trades.filter(t => t.outcome?.toLowerCase().startsWith('w')).length;
      const losses = trades.filter(t => t.outcome?.toLowerCase().startsWith('l')).length;
      const be = trades.length - wins - losses;
      const winRate = ((wins / trades.length) * 100).toFixed(1);

      const embed = new EmbedBuilder()
        .setColor(0xF5F0E8)
        .setTitle(`📊 ${interaction.user.username}'s Stats`)
        .addFields(
          { name: '📋 Total Trades', value: `${trades.length}`, inline: true },
          { name: '🏆 Win Rate', value: `${winRate}%`, inline: true },
          { name: '✅ Wins', value: `${wins}`, inline: true },
          { name: '❌ Losses', value: `${losses}`, inline: true },
          { name: '➖ Breakeven', value: `${be}`, inline: true },
        )
        .setFooter({ text: 'Elevate 🪽 • Only you can see this' });

      await interaction.editReply({ embeds: [embed] });
    }
  }
}


