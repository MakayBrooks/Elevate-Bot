const {
  EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ThreadAutoArchiveDuration
} = require('discord.js');
const { getStore, markDirty } = require('./db');
const { checkAchievements, buildAchievementsPanel, buildMyAchievements, computeStats } = require('./achievements');

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

// -- Get or create public forum thread
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
            `> Trading journal for **${member.user.username}**.

` +
            `All trade entries are logged here automatically.
` +
            `📎 **Attach chart screenshots directly after each entry.**`
          )
          .setThumbnail(member.user.displayAvatarURL({ extension: 'png' }))
          .setFooter({ text: 'Elevate 🪹 • Trading Journal' })
          .setTimestamp()
      ]
    }
  });
  userRecord.threadId = thread.id;
  saveDB(db);
  return thread;
}

// -- Journal panel embed
async function sendJournalPanel(forumChannel) {
  const logEmbed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('📒 Elevate Trading Journal')
    .setDescription(
      '> Log your trades, unlock achievements, and earn XP.\n' +
      '> Click **Log a Trade** to submit a trade entry.\n' +
      '> Click **My Achievements** to see your private progress.\n' +
      '> Click **Submit Weekly Earnings** for verified leaderboard.\n\u200b'
    )
    .addFields(
      { name: '✨ XP Per Trade', value: '+75 XP for every trade logged', inline: true },
      { name: '🏆 Achievements', value: 'Earn bonus XP for milestones', inline: true },
      { name: '📎 Charts', value: 'Attach screenshots in your thread', inline: true },
    )
    .setFooter({ text: 'Elevate 🪹 • Trading Journal' })
    .setTimestamp();

  const achEmbed = buildAchievementsPanel();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('journal_log_trade').setLabel('📝 Log a Trade').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('journal_check_achievements').setLabel('🏆 My Achievements').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('journal_submit_earnings').setLabel('💰 Submit Weekly Earnings').setStyle(ButtonStyle.Success),
  );

  const thread = await forumChannel.threads.create({
    name: '📝 Log a Trade — Click Here',
    message: { embeds: [logEmbed, achEmbed], components: [row] },
    reason: 'Journal panel',
  });

  const db = loadDB();
  db._panelPosted = true;
  db._panelThreadId = thread.id;
  saveDB(db);
  return thread;
}

// -- Trade log modal
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
          .setLabel('Position | R:R | Outcome (e.g. Long | 1:2 | Win)')
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
          .setPlaceholder('HTF OB, FVG, London sweep')
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

// -- Weekly earnings modal
function buildEarningsModal() {
  return new ModalBuilder()
    .setCustomId('journal_earnings_modal')
    .setTitle('💰 Submit Weekly Earnings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('weekly_pnl')
          .setLabel('Total Weekly PnL (e.g. +$1,250)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('+$1,250')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('screenshot_note')
          .setLabel('Screenshot proof (paste image link)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('Paste image link or describe your proof')
      )
    );
}

// -- Trade embed
function buildTradeEmbed(member, data, tradeNumber) {
  const outcome = (data.outcome || '').trim().toLowerCase();
  const position = (data.position || '').trim().toLowerCase();
  const outcomeEmoji = outcome.startsWith('w') ? '✅' : outcome.startsWith('l') ? '❌' : '➖';
  const outcomeLabel = outcome.startsWith('w') ? 'Win' : outcome.startsWith('l') ? 'Loss' : 'Breakeven';
  const posEmoji = position.startsWith('l') ? '📈' : '📉';
  const posLabel = position.startsWith('l') ? 'Long' : 'Short';
  const color = outcome.startsWith('w') ? 0x00c853 : outcome.startsWith('l') ? 0xff1744 : 0xaaaaaa;
  const sessionMap = { london: '🇬🇧', newyork: '🇺🇸', ny: '🇺🇸', asia: '🌏' };
  const sessionKey = (data.session || '').trim().toLowerCase().replace(/s/g, '');
  const sessionEmoji = sessionMap[sessionKey] || '🌐';
  const confluenceTags = data.confluences
    ? data.confluences.split(',').map(t => `\`${t.trim()}\``).join(' ')
    : '`None`';

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${member.user.username} • Trade #${tradeNumber}`, iconURL: member.user.displayAvatarURL({ extension: 'png' }) })
    .setTitle(`${outcomeEmoji} ${(data.pair || 'N/A').toUpperCase()} — ${outcomeLabel}`)
    .addFields(
      { name: '📅 Date', value: data.datetime || new Date().toLocaleDateString(), inline: true },
      { name: `${sessionEmoji} Session`, value: data.session || 'N/A', inline: true },
      { name: `${posEmoji} Position`, value: posLabel, inline: true },
      { name: '⚖️ R:R', value: `\`${data.rr || 'N/A'}\``, inline: true },
      { name: `${outcomeEmoji} Outcome`, value: outcomeLabel, inline: true },
      { name: '💰 PnL', value: `**${data.pnl || 'N/A'}**`, inline: true },
      { name: '🔗 Confluences', value: confluenceTags, inline: false },
      ...(data.notes ? [{ name: '🧠 Post Trade Clarity', value: data.notes, inline: false }] : []),
      { name: '📎 Charts', value: 'Attach screenshots below ↓', inline: false }
    )
    .setFooter({ text: 'Elevate 🪹 • Trading Journal' })
    .setTimestamp();
}

// -- Handle all journal interactions
async function handleJournalInteraction(interaction, client) {
  const forumChannel = interaction.guild.channels.cache.get(process.env.JOURNAL_CHANNEL_ID);
  const { addXP } = require('./levels');

  if (interaction.isButton() && interaction.customId === 'journal_log_trade') {
    await interaction.showModal(buildTradeModal());
    return;
  }

  if (interaction.isButton() && interaction.customId === 'journal_check_achievements') {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({ embeds: [buildMyAchievements(interaction.user.id)] });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'journal_submit_earnings') {
    await interaction.showModal(buildEarningsModal());
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'journal_modal_submit') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const pairSession = interaction.fields.getTextInputValue('pair_session');
      const posRrOutcome = interaction.fields.getTextInputValue('position_rr_outcome');
      const pnl = interaction.fields.getTextInputValue('pnl');
      const confluences = interaction.fields.getTextInputValue('confluences');
      const notes = interaction.fields.getTextInputValue('notes');

      const psParts = pairSession.split(/[|\-—]/).map(s => s.trim());
      const pair = psParts[0] || pairSession;
      const session = psParts[1] || 'N/A';

      const parts = posRrOutcome.split(/[|,]/).map(s => s.trim());
      const position = parts[0] || posRrOutcome;
      const rr = parts[1] || 'N/A';
      const outcome = parts[2] || 'N/A';

      const data = {
        pair, session, position, rr, outcome, pnl, confluences, notes,
        datetime: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        timestamp: new Date().toISOString(),
      };

      const db = loadDB();
      if (!db[interaction.user.id]) db[interaction.user.id] = { trades: [], threadId: null, achievements: [], verifiedWeeks: 0 };
      const userRecord = db[interaction.user.id];
      userRecord.trades.push(data);
      saveDB(db);

      if (!forumChannel) return interaction.editReply('⚠️ Journal channel not found. Ask admin to check JOURNAL_CHANNEL_ID.');

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const thread = await getOrCreateForumThread(member, forumChannel, db, userRecord);
      await thread.send({ embeds: [buildTradeEmbed(member, data, userRecord.trades.length)] });

      await addXP(interaction.user.id, interaction.user.username, 75, interaction.guild);
      const stats = computeStats(userRecord.trades, userRecord.verifiedWeeks || 0);
      await checkAchievements(interaction.user.id, interaction.user.username, stats, interaction.guild, addXP);

      await interaction.editReply(`✅ Trade #${userRecord.trades.length} logged! +**75 XP** earned. 📎 Attach chart screenshots in your thread.`);
    } catch (err) {
      console.error('Journal modal error:', err);
      await interaction.editReply('❌ Error logging trade. Please try again.').catch(() => {});
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'journal_earnings_modal') {
    await interaction.deferReply({ ephemeral: true });
    const weeklyPnl = interaction.fields.getTextInputValue('weekly_pnl');
    const screenshotNote = interaction.fields.getTextInputValue('screenshot_note');

    const adminChannel = interaction.guild.channels.cache.get(process.env.ADMIN_CHANNEL_ID);
    if (adminChannel) {
      const embed = new EmbedBuilder()
        .setColor(0xF5F0E8)
        .setTitle('💰 Weekly Earnings Submission')
        .setDescription(`**${interaction.user.username}** submitted weekly earnings for verification.`)
        .addFields(
          { name: '💰 Reported PnL', value: weeklyPnl, inline: true },
          { name: '👤 User', value: `${interaction.user}`, inline: true },
          { name: '📎 Proof', value: screenshotNote, inline: false },
        )
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png' }))
        .setFooter({ text: 'Elevate 🪹 • Approve or Deny' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`journal_earnings_approve_${interaction.user.id}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`journal_earnings_deny_${interaction.user.id}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
      );
      await adminChannel.send({ embeds: [embed], components: [row] });
    }
    await interaction.editReply('✅ Submitted for admin review! You will be notified once approved.');
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('journal_earnings_approve_')) {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return;
    }
    const targetId = interaction.customId.replace('journal_earnings_approve_', '');
    await interaction.deferUpdate();
    const db = loadDB();
    if (!db[targetId]) db[targetId] = { trades: [], verifiedWeeks: 0 };
    db[targetId].verifiedWeeks = (db[targetId].verifiedWeeks || 0) + 1;
    saveDB(db);
    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    await checkAchievements(targetId, targetMember?.user.username || 'User', computeStats(db[targetId].trades || [], db[targetId].verifiedWeeks), interaction.guild, addXP);
    await addXP(targetId, targetMember?.user.username || 'User', 200, interaction.guild);
    await interaction.editReply({ content: `✅ Approved! +200 XP awarded to ${targetMember || targetId}.`, components: [] });
    try { await targetMember?.send('✅ Your weekly earnings were **approved**! +200 XP added. 🪹'); } catch {}
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('journal_earnings_deny_')) {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return;
    }
    const targetId = interaction.customId.replace('journal_earnings_deny_', '');
    await interaction.deferUpdate();
    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    await interaction.editReply({ content: `❌ Denied submission from ${targetMember || targetId}.`, components: [] });
    try { await targetMember?.send('❌ Your weekly earnings submission was **denied**. Please include valid screenshot proof.'); } catch {}
    return;
  }

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
      .setFooter({ text: 'Elevate 🪹 • Only you can see this' });
    await interaction.editReply({ embeds: [embed] });
  }
}

module.exports = { handleJournalInteraction, sendJournalPanel, loadDB };
