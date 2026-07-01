'use strict';
const {
  ChannelType, PermissionFlagsBits,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { getStore, markDirty } = require('./db');

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Config helpers Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

function cfg() { return getStore()._ticketHub || (getStore()._ticketHub = {}); }
function save() { markDirty(); }

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Hub setup Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// Creates the 3 hub channels inside the existing admin category.
// Auto-detects the category by env var TICKETS_CHANNEL_ID or by name
// containing "ticket" (case-insensitive).

async function setupTicketHub(guild) {
  const c = cfg();

  // Find or resolve the hub category
  await guild.channels.fetch().catch(()=>{});
  let cat = null;
  if (process.env.TICKETS_CHANNEL_ID) {
    cat = guild.channels.cache.get(process.env.TICKETS_CHANNEL_ID);
  }
  if (!cat) {
    cat = guild.channels.cache.find(ch =>
      ch.type === ChannelType.GuildCategory &&
      ch.name.toLowerCase().includes('ticket')
    );
  }
  if (!cat) {
    console.error('[tickets] No ticket hub category found. Set TICKETS_CHANNEL_ID env var.');
    return null;
  }

  const perms = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.client.user.id,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
  ];
  const adminRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'admin' || r.permissions.has(PermissionFlagsBits.Administrator) && !r.managed);
  if (adminRole) perms.push({ id: adminRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });

  async function getOrCreate(idKey, name, topic) {
    let ch = c[idKey] ? guild.channels.cache.get(c[idKey]) : null;
    if (!ch) {
      ch = guild.channels.cache.find(x => x.parentId === cat.id && x.name === name);
    }
    if (!ch) {
      ch = await guild.channels.create({
        name, topic, type: ChannelType.GuildText, parent: cat.id,
        permissionOverwrites: perms,
      });
    }
    c[idKey] = ch.id;
    save();
    return ch;
  }

  await getOrCreate('newTicketsCh',    'new-tickets',    'Freshly opened tickets Ã¢ÂÂ greet and move to active');
  await getOrCreate('activeTicketsCh', 'active-tickets', 'All in-progress tickets');
  await getOrCreate('newMessagesCh',   'new-messages',   'Tickets with unread messages');

  console.log('[tickets] Hub ready:', JSON.stringify({ newTicketsCh: c.newTicketsCh, activeTicketsCh: c.activeTicketsCh, newMessagesCh: c.newMessagesCh }));
  return true;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Card builders Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

function buildCard(ticketCh, status, previewText, authorName, authorAvatar) {
  const colors = { new: 0xF5C518, active: 0x57F287, message: 0x5865F2 };
  const labels = { new: 'Ã°ÂÂÂ New Ticket', active: 'Ã¢ÂÂ Active', message: 'Ã°ÂÂÂ¬ New Message' };
  return new EmbedBuilder()
    .setColor(colors[status] || 0xAAAAAA)
    .setTitle(labels[status] + ' Ã¢ÂÂ #' + ticketCh.name)
    .setDescription(previewText ? '> ' + previewText.slice(0, 200) : '*No preview*')
    .addFields(
      { name: 'Channel', value: '<#' + ticketCh.id + '>', inline: true },
      { name: 'Opened', value: '<t:' + Math.floor(ticketCh.createdTimestamp / 1000) + ':R>', inline: true },
      ...(authorName ? [{ name: 'User', value: authorName, inline: true }] : []),
    )
    .setThumbnail(authorAvatar || null)
    .setFooter({ text: 'ticket:' + ticketCh.id })
    .setTimestamp();
}

function buildRow(status, ticketChId) {
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder().setLabel('Open Ticket').setStyle(ButtonStyle.Link)
      .setURL('https://discord.com/channels/' + (process.env.GUILD_ID || '') + '/' + ticketChId),
  );
  if (status === 'new') {
    row.addComponents(
      new ButtonBuilder().setCustomId('ticket_greet_' + ticketChId).setLabel('Ã¢ÂÂ Greet & Move to Active').setStyle(ButtonStyle.Success),
    );
  }
  if (status === 'message') {
    row.addComponents(
      new ButtonBuilder().setCustomId('ticket_read_' + ticketChId).setLabel('Ã¢ÂÂ Mark Read').setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Post / update card Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

async function postCard(guild, ticketCh, status, previewText, authorName, authorAvatar) {
  const c = cfg();
  const chId = status === 'new' ? c.newTicketsCh : status === 'active' ? c.activeTicketsCh : c.newMessagesCh;
  if (!chId) return;
  const panelCh = guild.channels.cache.get(chId);
  if (!panelCh) return;

  const embed = buildCard(ticketCh, status, previewText, authorName, authorAvatar);
  const row   = buildRow(status, ticketCh.id);
  const msg   = await panelCh.send({ embeds: [embed], components: [row] }).catch(e => { console.error('[tickets] postCard:', e.message); });

  // Track card locations
  if (!c.cards) c.cards = {};
  if (!c.cards[ticketCh.id]) c.cards[ticketCh.id] = {};
  if (status !== 'message') {
    c.cards[ticketCh.id].mainStatus  = status;
    c.cards[ticketCh.id].mainMsgId   = msg?.id;
    c.cards[ticketCh.id].mainChId    = chId;
  } else {
    c.cards[ticketCh.id].msgCardId   = msg?.id;
    c.cards[ticketCh.id].msgChId     = chId;
  }
  save();
  return msg;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Public API Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

// Called from channelCreate event when Ticketool makes a ticket channel
async function onTicketCreated(guild, ticketCh) {
  const c = cfg();

  // Move channel into the hub category if needed
  await guild.channels.fetch().catch(()=>{});
  const cat = process.env.TICKETS_CHANNEL_ID
    ? guild.channels.cache.get(process.env.TICKETS_CHANNEL_ID)
    : guild.channels.cache.find(ch => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase().includes('ticket'));
  if (cat && ticketCh.parentId !== cat.id) {
    await ticketCh.setParent(cat.id, { lockPermissions: false }).catch(() => {});
  }

  // Get first message for preview (wait a moment for Ticketool to post it)
  await new Promise(r => setTimeout(r, 1500));
  let preview = '', authorName = '', authorAvatar = '';
  try {
    const msgs = await ticketCh.messages.fetch({ limit: 5 });
    const first = msgs.last();
    if (first) {
      preview     = first.content || first.embeds[0]?.description || '';
      authorName  = first.author?.tag || '';
      authorAvatar= first.author?.displayAvatarURL({ extension: 'png' }) || '';
    }
  } catch {}

  await postCard(guild, ticketCh, 'new', preview, authorName, authorAvatar);
  console.log('[tickets] New ticket card posted for #' + ticketCh.name);
}

// Called when a message is sent in a ticket channel
async function onTicketMessage(guild, ticketCh, message) {
  // Ignore bot messages
  if (message.author.bot) return;
  const c = cfg();
  if (!c.cards) return;

  // Delete previous new-message card for this ticket if exists
  const card = c.cards[ticketCh.id];
  if (card?.msgCardId && card?.msgChId) {
    const prevCh = guild.channels.cache.get(card.msgChId);
    if (prevCh) await prevCh.messages.delete(card.msgCardId).catch(() => {});
  }

  const preview     = message.content || '[attachment/embed]';
  const authorName  = message.author.tag;
  const authorAvatar= message.author.displayAvatarURL({ extension: 'png' });
  await postCard(guild, ticketCh, 'message', preview, authorName, authorAvatar);
}

// Called when admin clicks "Greet & Move to Active"
async function onTicketGreeted(guild, ticketCh) {
  const c = cfg();
  const card = c.cards?.[ticketCh.id];

  // Delete the new-tickets card
  if (card?.mainMsgId && card?.mainChId) {
    const prevCh = guild.channels.cache.get(card.mainChId);
    if (prevCh) await prevCh.messages.delete(card.mainMsgId).catch(() => {});
  }

  // Get existing info
  const preview     = card?.lastPreview || '';
  const authorName  = card?.authorName  || '';
  const authorAvatar= card?.authorAvatar|| '';

  // Post in active-tickets
  await postCard(guild, ticketCh, 'active', preview, authorName, authorAvatar);
  console.log('[tickets] Moved ticket to active: #' + ticketCh.name);
}

// Called when admin clicks "Mark Read" (dismiss from new-messages)
async function onTicketRead(guild, ticketCh) {
  const c = cfg();
  const card = c.cards?.[ticketCh.id];
  if (card?.msgCardId && card?.msgChId) {
    const prevCh = guild.channels.cache.get(card.msgChId);
    if (prevCh) await prevCh.messages.delete(card.msgCardId).catch(() => {});
    delete c.cards[ticketCh.id].msgCardId;
    delete c.cards[ticketCh.id].msgChId;
    save();
  }
}

// Button router Ã¢ÂÂ call from interactionCreate handler
async function handleTicketButton(interaction, guild) {
  const id = interaction.customId;
  if (!id.startsWith('ticket_')) return false;

  await interaction.deferUpdate();

  if (id.startsWith('ticket_greet_')) {
    const chId = id.replace('ticket_greet_', '');
    const ticketCh = guild.channels.cache.get(chId);
    if (ticketCh) await onTicketGreeted(guild, ticketCh);
    await interaction.followUp({ content: 'Ã¢ÂÂ Moved to active tickets.', ephemeral: true }).catch(() => {});
  }

  if (id.startsWith('ticket_read_')) {
    const chId = id.replace('ticket_read_', '');
    const ticketCh = guild.channels.cache.get(chId);
    if (ticketCh) await onTicketRead(guild, ticketCh);
    await interaction.followUp({ content: 'Ã¢ÂÂ Marked as read.', ephemeral: true }).catch(() => {});
  }

  return true;
}


async function syncExistingTickets(guild) {
  const c = cfg();
  if (!c.activeTicketsCh) return; // hub not set up yet

  const ticketChannels = guild.channels.cache.filter(ch =>
    ch.name.startsWith('ticket-') && ch.type === ChannelType.GuildText
  );

  let synced = 0;
  for (const [, ticketCh] of ticketChannels) {
    if (c.cards && c.cards[ticketCh.id]) continue; // already tracked

    let previewText = '#' + ticketCh.name;
    let authorName = null;
    let authorAvatar = null;
    try {
      const msgs = await ticketCh.messages.fetch({ limit: 5 });
      const userMsg = msgs.find(m => !m.author.bot);
      if (userMsg) {
        previewText = userMsg.content.slice(0, 80) || previewText;
        authorName = userMsg.author.username;
        authorAvatar = userMsg.author.displayAvatarURL();
      }
    } catch {}

    await postCard(guild, ticketCh, 'active', previewText, authorName, authorAvatar)
      .catch(e => console.error('â syncExistingTickets postCard:', e));
    synced++;
  }
  console.log('â Synced ' + synced + ' existing ticket(s) to hub.');
}

module.exports = {
  syncExistingTickets,
  setupTicketHub,
  onTicketCreated,
  onTicketMessage,
  onTicketGreeted,
  onTicketRead,
  handleTicketButton,
};
