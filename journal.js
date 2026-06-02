const {
EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
MessageFlags, ChannelType,
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
  markDirty()
}

// In-memory state for multi-step trade form
const tradeFormState = new Map();

// ââ Thread management ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function getOrCreateUserThread(member, channel, db, userRecord) {
  if (userRecord.threadId) {
    try {
      const existing = await channel.threads.fetch(userRecord.threadId);
      if (existing) {
        if (existing.archived) await existing.setArchived(false);
        return existing;
      }
    } catch {}
  }
  let thread;
  try {
    thread = await channel.threads.create({
      name: `\u{1F4DA} ${member.user.username}`,
      type: ChannelType.PrivateThread,
      autoArchiveDuration: 10080,
      invitable: false,
    });
    await thread.members.add(member.id);
  await thread.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xF5F0E8)
        .setTitle(`\u{1F4DA} ${member.user.username}'s Trading Journal`)
        .setDescription(
          `Trade log for **${member.user.username}**.\n\n` +
          `All entries are logged here automatically.\n` +
          `\u{1F4CE} **Attach chart screenshots directly after each entry.**`
        )
        .setThumbnail(member.user.displayAvatarURL({ extension: 'png' }))
        .setFooter({ text: 'Elevate \u{1FABD} \u2022 Trading Journal' })
        .setTimestamp()
    ]
  });
  } catch {
    // Fallback: public thread (server may not have Community enabled)
    thread = await channel.threads.create({
      name: `\u{1F4DA} ${member.user.username}`,
      autoArchiveDuration: 10080,
    });
  }
  userRecord.threadId = thread.id;
  saveDB(db);
  return thread;
}

// ââ Journal panel ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// ── Journal panel ──────────────────────────────────────────────────────────
async function sendJournalPanel(channel) {
    // Skip repost if panel already exists
      const db = loadDB();
        if (db._panelMessageId) {
            try {
                  const existing = await channel.messages.fetch(db._panelMessageId);
                        if (existing) return existing;
                            } catch {} // message deleted, fall through
                              }
  const logEmbed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('\u{1F4DA} Elevate Trading Journal')
    .setDescription(
      '> Log your trades, unlock achievements, and earn XP.\n' +
      '> Click **Log a Trade** to submit a new trade entry.\n' +
      '> Click **Submit Weekly Earnings** for verified leaderboard.\n\u200b'
    )
    .addFields(
      { name: '\u2728 XP Per Trade', value: '+75 XP for every trade logged', inline: true },
      { name: '\u{1F3C6} Milestones', value: 'Earn roles & bonus XP', inline: true },
      { name: '\u{1F4CE} Charts', value: 'Attach screenshots in your thread', inline: true },
    )
    .setFooter({ text: 'Elevate \u{1FABD} \u2022 Trading Journal' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('journal_log_trade').setLabel('\u{1F4DD} Log a Trade').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('journal_submit_earnings').setLabel('\u{1F4B0} Submit Weekly Earnings').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('journal_my_journal').setLabel('\u{1F4DA} My Journal').setStyle(ButtonStyle.Secondary),
  );

  // Delete any existing bot journal panels before posting fresh one
  try {
    const pinned = await channel.messages.fetchPinned();
    const oldPanels = pinned.filter(m => m.author.id === channel.client.user.id && m.embeds?.[0]?.title?.includes('Trading Journal'));
    for (const [, msg] of oldPanels) { await msg.unpin().catch(()=>{}); await msg.delete().catch(()=>{}); }
    // Also scan recent messages for duplicates
    const recent = await channel.messages.fetch({ limit: 20 });
    const oldRecent = recent.filter(m => m.author.id === channel.client.user.id && (m.embeds?.[0]?.title?.includes('Trading Journal') || m.embeds?.[0]?.title?.includes('Trading Achievements') || m.embeds?.[1]?.title?.includes('Trading Achievements')));
    for (const [, msg] of oldRecent) { await msg.delete().catch(()=>{}); }
  } catch {}

  const msg = await channel.send({ embeds: [logEmbed], components: [row] });
  await msg.pin().catch(() => {});
  db._panelMessageId = msg.id;
  saveDB(db);
  return msg;
}

// ââ Step 1 selection message âââââââââââââââââââââââââââââââââââââââââââââââ
function buildTradeFormMessage(state = {}) {
  const outcome = state.outcome || null;
  const position = state.position || null;
  const session = state.session || null;
  const rr = state.rr || null;

  const lines = [
    outcome  ? `\u2705 Outcome: **${outcome}**`  : '\u26AA Outcome: *not selected*',
    position ? `\u2705 Position: **${position}**` : '\u26AA Position: *not selected*',
    session  ? `\u2705 Session: **${session}**`   : '\u26AA Session: *not selected*',
    rr       ? `\u2705 R:R: **${rr}**`            : '\u26AA R:R: *not selected*',
  ];

  const embed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('\u{1F4DD} Log a Trade')
    .setDescription('Select your trade details below, then click **Continue** to add notes.')
    .addFields({ name: 'Selections', value: lines.join('\n'), inline: false })
    .setFooter({ text: 'Elevate \u{1FABD} \u2022 Only you can see this' });

  const outcomeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('journal_form_outcome')
      .setPlaceholder(outcome ? `Outcome: ${outcome}` : '\u{1F3AF} Select Outcome...')
      .addOptions([
        { label: '\u2705 Win', value: 'Win', emoji: '\u2705' },
        { label: '\u274C Loss', value: 'Loss', emoji: '\u274C' },
        { label: '\u27B0 Breakeven', value: 'Breakeven', emoji: '\u27B0' },
      ])
  );

  const posRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('journal_form_position')
      .setPlaceholder(position ? `Position: ${position}` : '\u{1F4C8} Select Position...')
      .addOptions([
        { label: '\u{1F4C8} Long', value: 'Long', emoji: '\u{1F4C8}' },
        { label: '\u{1F4C9} Short', value: 'Short', emoji: '\u{1F4C9}' },
      ])
  );

  const sessionRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('journal_form_session')
      .setPlaceholder(session ? `Session: ${session}` : '\u{1F310} Select Session...')
      .addOptions([
        { label: '\u{1F1EC}\u{1F1E7} London', value: 'London' },
        { label: '\u{1F1FA}\u{1F1F8} New York', value: 'New York' },
        { label: '\u{1F30F} Asia', value: 'Asia' },
        { label: '\u{1F1EC}\u{1F1E7}\u{1F1FA}\u{1F1F8} London/NY Overlap', value: 'London/NY Overlap' },
        { label: '\u{1F303} London Close', value: 'London Close' },
      ])
  );

  const rrRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('journal_form_rr')
      .setPlaceholder(rr ? `R:R: ${rr}` : '\u2696\uFE0F Select R:R...')
      .addOptions([
        { label: '1:1', value: '1:1' },
        { label: '1:2', value: '1:2' },
        { label: '1:3', value: '1:3' },
        { label: '1:4', value: '1:4' },
        { label: '1:5', value: '1:5' },
        { label: '2:1', value: '2:1' },
        { label: '3:1', value: '3:1' },
        { label: 'Partials', value: 'Partials' },
        { label: 'Scratch', value: 'Scratch' },
      ])
  );

  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('journal_form_continue')
      .setLabel('Continue \u2192')
      .setStyle(outcome && position && session && rr ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!(outcome && position && session && rr))
  );

  return { embeds: [embed], components: [outcomeRow, posRow, sessionRow, rrRow, btnRow], flags: MessageFlags.Ephemeral };
}

// ââ Step 2 modal (pair, pnl, notes only) ââââââââââââââââââââââââââââââââââ
function buildTradeModal2() {
  return new ModalBuilder()
    .setCustomId('journal_modal_submit')
    .setTitle('\u{1F4DD} Trade Details')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pair_session')
          .setLabel('Pair (e.g. NQ, ES, EURUSD)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('NQ')
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

// ââ Weekly earnings modal ââââââââââââââââââââââââââââââââââââââââââââââââââ
function buildEarningsModal() {
  return new ModalBuilder()
    .setCustomId('journal_earnings_modal')
    .setTitle('\u{1F4B0} Submit Weekly Earnings')
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

// ââ Trade embed ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function buildTradeEmbed(member, data, tradeNumber) {
  const outcome = (data.outcome || '').trim().toLowerCase();
  const position = (data.position || '').trim().toLowerCase();
  const outcomeEmoji = outcome.startsWith('w') ? '\u2705' : outcome.startsWith('l') ? '\u274C' : '\u27B0';
  const outcomeLabel = outcome.startsWith('w') ? 'Win' : outcome.startsWith('l') ? 'Loss' : 'Breakeven';
  const posEmoji = position.startsWith('l') ? '\u{1F4C8}' : '\u{1F4C9}';
  const posLabel = position.startsWith('l') ? 'Long' : 'Short';
  const color = outcome.startsWith('w') ? 0x00c853 : outcome.startsWith('l') ? 0xff1744 : 0xaaaaaa;
  const sessionMap = { london: '\u{1F1EC}\u{1F1E7}', newyork: '\u{1F1FA}\u{1F1F8}', 'newyork': '\u{1F1FA}\u{1F1F8}', ny: '\u{1F1FA}\u{1F1F8}', asia: '\u{1F30F}' };
  const sessionKey = (data.session || '').trim().toLowerCase().replace(/\s/g, '');
  const sessionEmoji = sessionMap[sessionKey] || '\u{1F310}';
  const confluenceTags = data.confluences
    ? data.confluences.split(',').map(t => `\`${t.trim()}\``).join(' ')
    : '\`None\`';

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${member.user.username} \u2022 Trade #${tradeNumber}`, iconURL: member.user.displayAvatarURL({ extension: 'png' }) })
    .setTitle(`${outcomeEmoji} ${(data.pair || 'N/A').toUpperCase()} \u2014 ${outcomeLabel}`)
    .addFields(
      { name: '\u{1F4C5} Date', value: data.datetime || new Date().toLocaleDateString(), inline: true },
      { name: `${sessionEmoji} Session`, value: data.session || 'N/A', inline: true },
      { name: `${posEmoji} Position`, value: posLabel, inline: true },
      { name: '\u2696\uFE0F R:R', value: `\`${data.rr || 'N/A'}\``, inline: true },
      { name: `${outcomeEmoji} Outcome`, value: outcomeLabel, inline: true },
      { name: '\u{1F4B0} PnL', value: `**${data.pnl || 'N/A'}**`, inline: true },
      { name: '\u{1F517} Confluences', value: confluenceTags, inline: false },
      ...(data.notes ? [{ name: '\u{1F9E0} Post Trade Clarity', value: data.notes, inline: false }] : []),
      { name: '\u{1F4CE} Charts', value: 'Attach screenshots below \u2193', inline: false }
    )
    .setFooter({ text: 'Elevate \u{1FABD} \u2022 Trading Journal' })
    .setTimestamp();
}

// ââ My Journal helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââ
const TRADES_PER_PAGE = 5;

function buildJournalPageEmbed(trades, page, username) {
  const totalPages = Math.max(1, Math.ceil(trades.length / TRADES_PER_PAGE));
  const start = page * TRADES_PER_PAGE;
  const slice = trades.slice(start, start + TRADES_PER_PAGE);
  const wins = trades.filter(t => (t.outcome||'').trim().toLowerCase().startsWith('w')).length;
  const losses = trades.filter(t => (t.outcome||'').trim().toLowerCase().startsWith('l')).length;
  const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : '0.0';
  const rrValues = trades.map(t => {
    const m = (t.rr||'').match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[2]) / parseFloat(m[1]) : null;
  }).filter(v => v !== null);
  const avgRR = rrValues.length > 0 ? (rrValues.reduce((a,b) => a+b, 0) / rrValues.length).toFixed(2) : 'N/A';
  const totalPnl = trades.reduce((sum, t) => {
    const m = (t.pnl||'').replace(/,/g,'').match(/([+-]?\d+(?:\.\d+)?)/);
    return sum + (m ? parseFloat(m[1]) : 0);
  }, 0);
  const pnlStr = (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2);
  const tradeLines = slice.map((t, i) => {
    const globalIdx = start + i;
    const outcome = (t.outcome||'').trim().toLowerCase();
    const emoji = outcome.startsWith('w') ? '\u{1F7E2}' : outcome.startsWith('l') ? '\u{1F534}' : '\u{1F7E1}';
    const pair = (t.pair||'N/A').toUpperCase();
    const outcomeLabel = outcome.startsWith('w') ? 'Win' : outcome.startsWith('l') ? 'Loss' : 'Breakeven';
    return `${emoji} **#${globalIdx+1}** ${pair} | ${outcomeLabel} | ${t.pnl||'N/A'} | ${t.datetime||'N/A'}`;
  }).join('\n') || 'No trades on this page.';

  return new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('\u{1F4DA} Your Trading Journal')
    .addFields(
      { name: '\u{1F4CB} Total Trades', value: `${trades.length}`, inline: true },
      { name: '\u{1F3C6} Win Rate', value: `${winRate}%`, inline: true },
      { name: '\u2696\uFE0F Avg R:R', value: `1:${avgRR}`, inline: true },
      { name: '\u{1F4B0} Total PnL', value: pnlStr, inline: true },
      { name: '\u2705 Wins', value: `${wins}`, inline: true },
      { name: '\u274C Losses', value: `${losses}`, inline: true },
      { name: `\u{1F4C5} Recent Trades \u2014 Page ${page+1} of ${totalPages}`, value: tradeLines, inline: false },
    )
    .setFooter({ text: `Elevate \u{1FABD} \u2022 Only you can see this \u2022 Page ${page+1}/${totalPages}` })
    .setTimestamp();
}

function buildJournalComponents(trades, page, userId) {
  const totalPages = Math.max(1, Math.ceil(trades.length / TRADES_PER_PAGE));
  const start = page * TRADES_PER_PAGE;
  const slice = trades.slice(start, start + TRADES_PER_PAGE);
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`journal_page_${page-1}_${userId}`).setLabel('\u2B05\uFE0F Previous').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`journal_page_${page+1}_${userId}`).setLabel('\u27A1\uFE0F Next').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
    new ButtonBuilder().setCustomId('journal_close').setLabel('\u274C Close').setStyle(ButtonStyle.Danger),
  );
  const components = [navRow];
  if (slice.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`journal_trade_select_${userId}`)
      .setPlaceholder('\u{1F50D} View trade details...')
      .addOptions(slice.map((t, i) => {
        const globalIdx = start + i;
        const outcome = (t.outcome||'').trim().toLowerCase();
        const emoji = outcome.startsWith('w') ? '\u{1F7E2}' : outcome.startsWith('l') ? '\u{1F534}' : '\u{1F7E1}';
        return {
          label: `#${globalIdx+1} ${(t.pair||'N/A').toUpperCase()} \u2014 ${t.datetime||'N/A'}`,
          description: `${outcome.startsWith('w')?'Win':outcome.startsWith('l')?'Loss':'Breakeven'} | ${t.pnl||'N/A'}`,
          value: `${globalIdx}`,
          emoji: emoji,
        };
      }));
    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }
  return components;
}

function buildTradeDetailEmbed(trade, tradeIdx) {
  const outcome = (trade.outcome||'').trim().toLowerCase();
  const position = (trade.position||'').trim().toLowerCase();
  const outcomeEmoji = outcome.startsWith('w') ? '\u2705' : outcome.startsWith('l') ? '\u274C' : '\u27B0';
  const outcomeLabel = outcome.startsWith('w') ? 'Win' : outcome.startsWith('l') ? 'Loss' : 'Breakeven';
  const posEmoji = position.startsWith('l') ? '\u{1F4C8}' : '\u{1F4C9}';
  const posLabel = position.startsWith('l') ? 'Long' : 'Short';
  const color = outcome.startsWith('w') ? 0x00c853 : outcome.startsWith('l') ? 0xff1744 : 0xaaaaaa;
  const confluenceTags = trade.confluences ? trade.confluences.split(',').map(t => `\`${t.trim()}\``).join(' ') : '\`None\`';
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${outcomeEmoji} Trade #${tradeIdx+1} \u2014 ${(trade.pair||'N/A').toUpperCase()}`)
    .addFields(
      { name: '\u{1F4C5} Date', value: trade.datetime || 'N/A', inline: true },
      { name: '\u{1F310} Session', value: trade.session || 'N/A', inline: true },
      { name: `${posEmoji} Position`, value: posLabel, inline: true },
      { name: '\u2696\uFE0F R:R', value: `\`${trade.rr||'N/A'}\``, inline: true },
      { name: `${outcomeEmoji} Outcome`, value: outcomeLabel, inline: true },
      { name: '\u{1F4B0} PnL', value: `**${trade.pnl||'N/A'}**`, inline: true },
      { name: '\u{1F517} Confluences', value: confluenceTags, inline: false },
      ...(trade.notes ? [{ name: '\u{1F9E0} Post Trade Clarity', value: trade.notes, inline: false }] : []),
    )
    .setFooter({ text: 'Elevate \u{1FABD} \u2022 Trade Detail' })
    .setTimestamp();
  if (trade.screenshot) embed.setImage(trade.screenshot);
  return embed;
}

async function handleMyJournal(interaction, page = 0) {
  const db = loadDB();
  const userData = db[interaction.user.id];
  if (!userData?.trades?.length) {
    const empty = new EmbedBuilder()
      .setColor(0xF5F0E8)
      .setTitle('\u{1F4DA} Your Trading Journal')
      .setDescription('No trades logged yet. Click **\u{1F4DD} Log a Trade** to get started!')
      .setFooter({ text: 'Elevate \u{1FABD} \u2022 Only you can see this' });
    return { embeds: [empty], components: [], flags: MessageFlags.Ephemeral };
  }
  const trades = userData.trades;
  const totalPages = Math.max(1, Math.ceil(trades.length / TRADES_PER_PAGE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  return {
    embeds: [buildJournalPageEmbed(trades, safePage, interaction.user.username)],
    components: buildJournalComponents(trades, safePage, interaction.user.id),
    flags: MessageFlags.Ephemeral,
  };
}

// ââ Main interaction handler âââââââââââââââââââââââââââââââââââââââââââââââ
async function handleJournalInteraction(interaction, client) {
  const journalChannel = interaction.guild.channels.cache.get(process.env.JOURNAL_CHANNEL_ID);
  const { addXP } = require('./levels');

  // My Journal button
  if (interaction.isButton() && interaction.customId === 'journal_my_journal') {
    await interaction.deferReply({ ephemeral: true });
    try {
      await interaction.editReply(await handleMyJournal(interaction, 0));
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
      await interaction.editReply('\u274C Error loading journal.').catch(() => {});
    }
    return;
  }

  // Pagination
  if (interaction.isButton() && interaction.customId.startsWith('journal_page_')) {
    await interaction.deferUpdate();
    try {
      const parts = interaction.customId.split('_');
      await interaction.editReply(await handleMyJournal(interaction, parseInt(parts[2], 10)));
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
    }
    return;
  }

  // Close
  if (interaction.isButton() && interaction.customId === 'journal_close') {
    try { await interaction.update({ content: '\u2705 Closed.', embeds: [], components: [] }); } catch {}
    return;
  }

  // Trade detail select
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('journal_trade_select_')) {
    await interaction.deferUpdate();
    try {
      const tradeIdx = parseInt(interaction.values[0], 10);
      const db = loadDB();
      const trade = db[interaction.user.id]?.trades?.[tradeIdx];
      if (!trade) { await interaction.followUp({ content: '\u274C Trade not found.', ephemeral: true }); return; }
      await interaction.followUp({ embeds: [buildTradeDetailEmbed(trade, tradeIdx)], ephemeral: true });
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
    }
    return;
  }

  // ââ Log Trade step 1: show selection form ââââââââââââââââââââââââââââââ
  if (interaction.isButton() && interaction.customId === 'journal_log_trade') {
    try {
      tradeFormState.set(interaction.user.id, {});
      await interaction.reply(buildTradeFormMessage({}));
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
    }
    return;
  }

  // ââ Form select menus ââââââââââââââââââââââââââââââââââââââââââââââââââ
  if (interaction.isStringSelectMenu() && ['journal_form_outcome','journal_form_position','journal_form_session','journal_form_rr'].includes(interaction.customId)) {
    await interaction.deferUpdate();
    try {
      const state = tradeFormState.get(interaction.user.id) || {};
      const field = interaction.customId.replace('journal_form_', '');
      state[field] = interaction.values[0];
      tradeFormState.set(interaction.user.id, state);
      await interaction.editReply(buildTradeFormMessage(state));
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
    }
    return;
  }

  // ââ Continue button â show modal âââââââââââââââââââââââââââââââââââââââ
  if (interaction.isButton() && interaction.customId === 'journal_form_continue') {
    try {
      await interaction.showModal(buildTradeModal2());
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
    }
    return;
  }

  // ââ Modal submit ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  if (interaction.isModalSubmit() && interaction.customId === 'journal_modal_submit') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const pair = interaction.fields.getTextInputValue('pair_session').trim();
      const pnl = interaction.fields.getTextInputValue('pnl').trim();
      const confluences = interaction.fields.getTextInputValue('confluences');
      const notes = interaction.fields.getTextInputValue('notes');

      // Get the dropdown selections from state
      const state = tradeFormState.get(interaction.user.id) || {};
      const outcome = state.outcome || 'N/A';
      const position = state.position || 'N/A';
      const session = state.session || 'N/A';
      const rr = state.rr || 'N/A';
      tradeFormState.delete(interaction.user.id);

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

      if (!journalChannel) return interaction.editReply('\u26A0\uFE0F Journal channel not found.');
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const thread = await getOrCreateUserThread(member, journalChannel, db, userRecord);
      await thread.send({ embeds: [buildTradeEmbed(member, data, userRecord.trades.length)] });

      await addXP(interaction.user.id, interaction.user.username, 75, interaction.guild);
      const stats = computeStats(userRecord.trades, userRecord.verifiedWeeks || 0);
      await checkAchievements(interaction.user.id, interaction.user.username, stats, interaction.guild, addXP);
      await checkMilestoneRoles(member, userRecord.trades, thread).catch(err => console.error('Milestone roles error:', err));

      await interaction.editReply(`\u2705 Trade #${userRecord.trades.length} logged! +**75 XP** earned.\u{1F4CE} Attach chart screenshots in your thread.`);
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
      console.error('Journal modal error:', err);
      await interaction.editReply('\u274C Error logging trade. Please try again.').catch(() => {});
    }
    return;
  }

  // ââ Achievements ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  if (interaction.isButton() && interaction.customId === 'journal_check_achievements') {
    await interaction.deferReply({ ephemeral: true });
    try {
      await interaction.editReply({ embeds: [buildMyAchievements(interaction.user.id)] });
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
      await interaction.editReply('\u274C Error loading achievements.').catch(() => {});
    }
    return;
  }

  // ââ Submit weekly earnings âââââââââââââââââââââââââââââââââââââââââââââââ
  if (interaction.isButton() && interaction.customId === 'journal_submit_earnings') {
    try {
      await interaction.showModal(buildEarningsModal());
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'journal_earnings_modal') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const weeklyPnl = interaction.fields.getTextInputValue('weekly_pnl');
      const screenshotNote = interaction.fields.getTextInputValue('screenshot_note');
      const adminChannel = interaction.guild.channels.cache.get(process.env.ADMIN_CHANNEL_ID);
      if (adminChannel) {
        const embed = new EmbedBuilder()
          .setColor(0xF5F0E8)
          .setTitle('\u{1F4B0} Weekly Earnings Submission')
          .setDescription(`**${interaction.user.username}** submitted weekly earnings for verification.`)
          .addFields(
            { name: '\u{1F4B0} Reported PnL', value: weeklyPnl, inline: true },
            { name: '\u{1F464} User', value: `${interaction.user}`, inline: true },
            { name: '\u{1F4CE} Proof', value: screenshotNote, inline: false },
          )
          .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png' }))
          .setFooter({ text: 'Elevate \u{1FABD} \u2022 Approve or Deny' })
          .setTimestamp();
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`journal_earnings_approve_${interaction.user.id}`).setLabel('\u2705 Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`journal_earnings_deny_${interaction.user.id}`).setLabel('\u274C Deny').setStyle(ButtonStyle.Danger),
        );
        await adminChannel.send({ embeds: [embed], components: [row] });
      }
      await interaction.editReply('\u2705 Submitted for admin review!');
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
      await interaction.editReply('\u274C Error submitting.').catch(() => {});
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('journal_earnings_approve_')) {
    if (!interaction.member.permissions.has('Administrator')) { await interaction.reply({ content: '\u274C Admins only.', ephemeral: true }); return; }
    const targetId = interaction.customId.replace('journal_earnings_approve_', '');
    await interaction.deferUpdate();
    try {
      const db = loadDB();
      if (!db[targetId]) db[targetId] = { trades: [], verifiedWeeks: 0 };
      db[targetId].verifiedWeeks = (db[targetId].verifiedWeeks || 0) + 1;
      saveDB(db);
      const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
      await checkAchievements(targetId, targetMember?.user.username || 'User', computeStats(db[targetId].trades || [], db[targetId].verifiedWeeks), interaction.guild, addXP);
      await addXP(targetId, targetMember?.user.username || 'User', 200, interaction.guild);
      await interaction.editReply({ content: `\u2705 Approved! +200 XP to ${targetMember || targetId}.`, components: [] });
      try { await targetMember?.send('\u2705 Your weekly earnings were **approved**! +200 XP added. \u{1FABD}'); } catch {}
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
      await interaction.editReply({ content: '\u274C Error.', components: [] }).catch(() => {});
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('journal_earnings_deny_')) {
    if (!interaction.member.permissions.has('Administrator')) { await interaction.reply({ content: '\u274C Admins only.', ephemeral: true }); return; }
    const targetId = interaction.customId.replace('journal_earnings_deny_', '');
    await interaction.deferUpdate();
    try {
      const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
      await interaction.editReply({ content: `\u274C Denied ${targetMember || targetId}.`, components: [] });
      try { await targetMember?.send('\u274C Your weekly earnings submission was **denied**. Please include valid screenshot proof.'); } catch {}
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
    }
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'journal') {
    await interaction.deferReply({ ephemeral: true });
    try {
      await interaction.editReply(await handleMyJournal(interaction, 0));
    } catch (err) {
      if (err.code === 10062 || err.rawError?.message?.includes('already been acknowledged')) return;
      await interaction.editReply('\u274C Error loading journal.').catch(() => {});
    }
  }
}


// ── Milestone role assignment ─────────────────────────────────────────
async function checkMilestoneRoles(member, trades, thread) {
  const tradeMilestones = [
    { count: 1, roleName: "📝 First Trade" },
    { count: 10, roleName: "📊 10 Trades" },
    { count: 50, roleName: "📈 50 Trades" },
    { count: 100, roleName: "💎 100 Trades" },
  ];
  const streakMilestones = [
    { streak: 3, roleName: "🔥 3-Streak" },
    { streak: 5, roleName: "⚡ 5-Streak" },
    { streak: 10, roleName: "👑 10-Streak" },
  ];
  let currentStreak = 0;
  for (let i = trades.length - 1; i >= 0; i--) {
    if ((trades[i].outcome || "").toLowerCase().startsWith("w")) currentStreak++;
    else break;
  }
  const guild = member.guild;
  const msgs = [];
  for (const m of tradeMilestones) {
    if (trades.length === m.count) {
      const role = guild.roles.cache.find(r => r.name.toLowerCase() === m.roleName.toLowerCase());
      if (role && !member.roles.cache.has(role.id)) {
        await member.roles.add(role).catch(() => {});
        msgs.push("🎉 You've logged **" + m.count + "** trade" + (m.count > 1 ? "s" : "") + "! You earned the **" + m.roleName + "** role!");
      }
    }
  }
  for (const sm of streakMilestones) {
    if (currentStreak === sm.streak) {
      const role = guild.roles.cache.find(r => r.name.toLowerCase() === sm.roleName.toLowerCase());
      if (role && !member.roles.cache.has(role.id)) {
        await member.roles.add(role).catch(() => {});
        msgs.push("🔥 You're on a **" + sm.streak + "-win streak**! You earned the **" + sm.roleName + "** role!");
      }
    }
  }
  if (msgs.length > 0 && thread) {
    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle("🏆 Milestone Reached!")
      .setDescription(msgs.join("\n"))
      .setThumbnail(member.user.displayAvatarURL({ extension: "png" }))
      .setFooter({ text: "Elevate 🪽 • Trading Milestones" })
      .setTimestamp();
    await thread.send({ embeds: [embed] }).catch(() => {});
  }
}
module.exports = { handleJournalInteraction, sendJournalPanel, loadDB, checkMilestoneRoles };
