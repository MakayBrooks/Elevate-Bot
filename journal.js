const {
  EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, ThreadAutoArchiveDuration
} = require('discord.js');
const { getStore, markDirty } = require('./db');
const { checkAchievements, buildAchievementsPanel, buildMyAchievements, computeStats } = require('./achievements');

// In-memory pending store — survives between modal 1 and 2 within same session
const pendingTrades = new Map();

function loadDB() {
  const store = getStore();
  if (!store.journal) store.journal = {};
  return store.journal;
}
function saveDB(data) {
  const store = getStore();
  store.journal = data;
  markDirty();
}

function getUserRecord(userId) {
  const db = loadDB();
  if (!db[userId]) db[userId] = { trades: [], threadId: null, achievements: [], verifiedWeeks: 0 };
  return { db, user: db[userId] };
}

// ── Get or create public forum thread ────────────────────────────────────────
async function getOrCreateForumThread(member, forumChannel, db, userRecord) {
  if (userRecord.threadId) {
    try {
      const existing = await forumChannel.threads.fetch(userRecord.threadId);
      if (existing) {
        if (existing.archived) await existing.setArchived(false);
        return existing;
      }
    } catch {}
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
            `> Trading journal for **${member.user.username}**.\n\n` +
            `All trade entries are logged here.\n` +
            `📎 **Attach chart screenshots directly after each entry.**`
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

// ── Send journal panel (achievements + log button) ────────────────────────────
async function sendJournalPanel(forumChannel) {
  // Achievement panel embed
  const achEmbed = buildAchievementsPanel();

  // Log trade panel embed
  const logEmbed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('📒 Elevate Trading Journal')
    .setDescription(
      '> Log your trades, unlock achievements, and earn XP.\n\n' +
      '**Click the button below to log a new trade.**\n' +
      '📎 Attach chart screenshots directly in your thread after submitting.\n\u200b'
    )
    .addFields(
      { name: '✨ XP Per Trade', value: '+75 XP for every trade logged', inline: true },
      { name: '🏆 Achievements', value: 'Earn bonus XP for milestones', inline: true },
    )
    .setFooter({ text: 'Elevate 🪽 • Trading Journal' })
    .setTimestamp();

  const logBtn = new ButtonBuilder()
    .setCustomId('journal_open_modal_1')
    .setLabel('📝 Log a Trade')
    .setStyle(ButtonStyle.Primary);

  const achBtn = new ButtonBuilder()
    .setCustomId('journal_check_achievements')
    .setLabel('🏆 My Achievements')
    .setStyle(ButtonStyle.Secondary);

  const earningsBtn = new ButtonBuilder()
    .setCustomId('journal_submit_earnings')
    .setLabel('💰 Submit Weekly Earnings')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(logBtn, achBtn, earningsBtn);

  const thread = await forumChannel.threads.create({
    name: '📝 Log a Trade — Click Here',
    message: { embeds: [logEmbed, achEmbed], components: [row] },
    reason: 'Journal panel',
  });

  await thread.setLocked(true);
  const db = loadDB();
  db._panelPosted = true;
  db._panelThreadId = thread.id;
  saveDB(db);
  return thread;
}

// ── Single modal (Discord only allows 1 modal per interaction) ───────────────
function buildTradeModal() {
  return new ModalBuilder()
    .setCustomId('journal_modal_submit')
    .setTitle('📝 Log Trade')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pair_session')
          .setLabel('Pair & Session (e.g. NQ — New York)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('NQ — New York')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('position_rr_outcome')
          .setLabel('Position, R:R, Outcome (e.g. Long | 1:2 | Win)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('Long | 1:2 | Win')
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
          .setCustomId('confluences')
          .setLabel('Confluences (comma separated)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('HTF OB, FVG, London sweep, CRT')
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

// ── Weekly earnings submission modal ─────────────────────────────────────────
function buildEarningsModal() {
  return new ModalBuilder()
    .setCustomId('journal_earnings_modal')
    .setTitle('💰 Submit Weekly Earnings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('weekly_pnl').setLabel('Total Weekly PnL (e.g. +$1,250)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('+$1,250')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('screenshot_note').setLabel('Screenshot proof (paste link or describe)').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Paste image link or attach in thread after submitting')
      )
    );
}

// ── Build trade embed ─────────────────────────────────────────────────────────
function buildTradeEmbed(member, data, tradeNumber) {
  const outcome = data.outcome.trim().toLowerCase();
  const position = data.position.trim().toLowerCase();
  const outcomeEmoji = outcome.startsWith('w') ? '✅' : outcome.startsWith('l') ? '❌' : '➖';
  const outcomeLabel = outcome.startsWith('w') ? 'Win' : outcome.startsWith('l') ? 'Loss' : 'Breakeven';
  const posEmoji = position.startsWith('l') ? '📈' : '📉';
  const posLabel = position.startsWith('l') ? 'Long' : 'Short';
  const color = outcome.startsWith('w') ? 0x00c853 : outcome.startsWith('l') ? 0xff1744 : 0xaaaaaa;
  const sessionEmojis = { london: '🇬🇧', newyork: '🇺🇸', ny: '🇺🇸', asia: '🌏' };
  const sessionKey = data.session.trim().toLowerCase().replace(/\s/g, '');
  const sessionEmoji = sessionEmojis[sessionKey] || '🌐';
  const confluenceTags = data.confluences ? data.confluences.split(',').map(t => `\`${t.trim()}\``).join(' ') : '`None`';

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${member.user.username} • Trade #${tradeNumber}`, iconURL: member.user.displayAvatarURL({ extension: 'png' }) })
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
  const { addXP } = require('./levels');

  // Button: open trade modal
  if (interaction.isButton() && interaction.customId === 'journal_open_modal_1') {
    await interaction.showModal(buildTradeModal());
    return;
  }

  // Button: check achievements
  if (interaction.isButton() && interaction.customId === 'journal_check_achievements') {
    await interaction.deferReply({ ephemeral: true });
    const embed = buildMyAchievements(interaction.user.id);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Button: submit weekly earnings
  if (interaction.isButton() && interaction.customId === 'journal_submit_earnings') {
    await interaction.showModal(buildEarningsModal());
    return;
  }

  // Single modal submit
  if (interaction.isModalSubmit() && interaction.customId === 'journal_modal_submit') {
    await interaction.deferReply({ ephemeral: true });

    const pairSession = interaction.fields.getTextInputValue('pair_session');
    const posRrOutcome = interaction.fields.getTextInputValue('position_rr_outcome');
    const pnl = interaction.fields.getTextInputValue('pnl');
    const confluences = interaction.fields.getTextInputValue('confluences');
    const notes = interaction.fields.getTextInputValue('notes');

    // Parse "Long | 1:2 | Win" — be lenient with separators
    const parts = posRrOutcome.split(/[|\-,\/]/).map(s => s.trim());
    const position = parts[0] || posRrOutcome;
    const rr = parts[1] || 'N/A';
    const outcome = parts[2] || 'N/A';

    // Parse "NQ — New York" for pair and session
    const pairParts = pairSession.split(/[|\-—]/).map(s => s.trim());
    const pair = pairParts[0] || pairSession;
    const session = pairParts[1] || 'N/A';

    const data = {
      pair, session, position, rr, outcome, pnl, confluences,
      notes, datetime: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      timestamp: new Date().toISOString(),
    };

    const db = loadDB();
    if (!db[interaction.user.id]) db[interaction.user.id] = { trades: [], threadId: null, achievements: [], verifiedWeeks: 0 };
    const userRecord = db[interaction.user.id];
    userRecord.trades.push(data);
    saveDB(db);

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!forumChannel) return interaction.editReply('⚠️ Journal channel not found. Ask admin to check JOURNAL_CHANNEL_ID.');

    const thread = await getOrCreateForumThread(member, forumChannel, db, userRecord);
    const embed = buildTradeEmbed(member, data, userRecord.trades.length);
    await thread.send({ embeds: [embed] });

    await addXP(interaction.user.id, interaction.user.username, 75, interaction.guild);
    const stats = computeStats(userRecord.trades, userRecord.verifiedWeeks || 0);
    await checkAchievements(interaction.user.id, interaction.user.username, stats, interaction.guild, addXP);

    await interaction.editReply(`✅ Trade #${userRecord.trades.length} logged! +**75 XP** earned. 📎 Attach chart screenshots in your thread.`);
    return;
  }

  // Weekly earnings modal submit
  if (interaction.isModalSubmit() && interaction.customId === 'journal_earnings_modal') {
    await interaction.deferReply({ ephemeral: true });
    const weeklyPnl = interaction.fields.getTextInputValue('weekly_pnl');
    const screenshotNote = interaction.fields.getTextInputValue('screenshot_note');

    // Post to admin channel for approval
    const adminChannel = interaction.guild.channels.cache.get(process.env.ADMIN_CHANNEL_ID);
    if (adminChannel) {
      const approveBtn = new ButtonBuilder()
        .setCustomId(`journal_earnings_approve_${interaction.user.id}`)
        .setLabel('✅ Approve')
        .setStyle(ButtonStyle.Success);

      const denyBtn = new ButtonBuilder()
        .setCustomId(`journal_earnings_deny_${interaction.user.id}`)
        .setLabel('❌ Deny')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(approveBtn, denyBtn);

      const embed = new EmbedBuilder()
        .setColor(0xF5F0E8)
        .setTitle('💰 Weekly Earnings Submission')
        .setDescription(`**${interaction.user.username}** submitted their weekly earnings for verification.`)
        .addFields(
          { name: '💰 Reported PnL', value: weeklyPnl, inline: true },
          { name: '👤 User', value: `${interaction.user}`, inline: true },
          { name: '📎 Proof', value: screenshotNote, inline: false },
        )
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png' }))
        .setFooter({ text: 'Elevate 🪽 • Approve or Deny below' })
        .setTimestamp();

      await adminChannel.send({ embeds: [embed], components: [row] });
    }

    await interaction.editReply('✅ Weekly earnings submitted for admin review! You\'ll be notified once approved.');
    return;
  }

  // Admin approve/deny earnings
  if (interaction.isButton() && interaction.customId.startsWith('journal_earnings_approve_')) {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Admins only.', ephemeral: true });
      return;
    }
    const targetId = interaction.customId.replace('journal_earnings_approve_', '');
    await interaction.deferUpdate();

    const db = loadDB();
    if (!db[targetId]) db[targetId] = { trades: [], verifiedWeeks: 0 };
    db[targetId].verifiedWeeks = (db[targetId].verifiedWeeks || 0) + 1;
    saveDB(db);

    // Check achievements
    const stats = computeStats(db[targetId].trades || [], db[targetId].verifiedWeeks);
    const targetUser = await interaction.guild.members.fetch(targetId).catch(() => null);
    await checkAchievements(targetId, targetUser?.user.username || 'User', stats, interaction.guild, addXP);

    // Award XP
    await addXP(targetId, targetUser?.user.username || 'User', 200, interaction.guild);

    await interaction.editReply({
      content: `✅ Approved! +200 XP awarded to ${targetUser || targetId}.`,
      components: [],
    });

    // Notify the user
    try {
      await targetUser?.send('✅ Your weekly earnings submission was **approved**! +200 XP added to your balance. 🪽');
    } catch {}
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('journal_earnings_deny_')) {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Admins only.', ephemeral: true });
      return;
    }
    const targetId = interaction.customId.replace('journal_earnings_deny_', '');
    await interaction.deferUpdate();
    const targetUser = await interaction.guild.members.fetch(targetId).catch(() => null);
    await interaction.editReply({ content: `❌ Denied submission from ${targetUser || targetId}.`, components: [] });
    try {
      await targetUser?.send('❌ Your weekly earnings submission was **denied**. Please ensure you include valid screenshot proof.');
    } catch {}
    return;
  }

  // /journal stats
  if (interaction.isChatInputCommand() && interaction.commandName === 'journal') {
    await interaction.deferReply({ ephemeral: true });
    const db = loadDB();
    const userData = db[interaction.user.id];
    if (!userData?.trades?.length) return interaction.editReply('No trades logged yet!');
    const stats = computeStats(userData.trades, userData.verifiedWeeks || 0);
    const embed = new EmbedBuilder()
      .setColor(0xF5F0E8)
      .setTitle(`📊 ${interaction.user.username}'s Stats`)
      .addFields(
        { name: '📋 Total Trades', value: `${stats.total}`, inline: true },
        { name: '🏆 Win Rate', value: `${stats.winRate.toFixed(1)}%`, inline: true },
        { name: '🔥 Current Streak', value: `${stats.streak}`, inline: true },
        { name: '✅ Wins', value: `${stats.wins}`, inline: true },
        { name: '💰 Verified Weeks', value: `${stats.verifiedWeeks}`, inline: true },
      )
      .setFooter({ text: 'Elevate 🪽 • Only you can see this' });
    await interaction.editReply({ embeds: [embed] });
  }
}

module.exports = { handleJournalInteraction, sendJournalPanel, loadDB };
