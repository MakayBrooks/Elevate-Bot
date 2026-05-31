const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { getStore, markDirty } = require('./db');

function loadTicketsDB() {
  const store = getStore();
  if (!store.tickets) store.tickets = {};
  return store.tickets;
}
function saveTicketsDB(data) {
  const store = getStore();
  store.tickets = data;
  markDirty();
}

// Post a summary card for a ticket channel in the admin TICKETS_CHANNEL_ID
async function postTicketCard(guild, ticketChannel, adminChannel, firstMessage) {
  const db = loadTicketsDB();
  if (db[ticketChannel.id] && db[ticketChannel.id].cardMessageId) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📬 ' + ticketChannel.name)
    .setDescription(firstMessage ? '> ' + firstMessage.content.slice(0, 1000) : '> *No message yet*')
    .addFields(
      { name: '👤 User', value: firstMessage ? '<@' + firstMessage.author.id + '>' : 'Unknown', inline: true },
      { name: '📅 Opened', value: '<t:' + Math.floor(ticketChannel.createdTimestamp / 1000) + ':R>', inline: true },
    )
    .setThumbnail(firstMessage && firstMessage.author ? firstMessage.author.displayAvatarURL({ extension: 'png' }) : null)
    .setFooter({ text: 'Elevate 🪽 • Ticket System' })
    .setTimestamp();

  const channelUrl = 'https://discord.com/channels/' + guild.id + '/' + ticketChannel.id;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('📂 Open Ticket').setStyle(ButtonStyle.Link).setURL(channelUrl)
  );

  try {
    const cardMsg = await adminChannel.send({ embeds: [embed], components: [row] });
    db[ticketChannel.id] = { cardMessageId: cardMsg.id };
    saveTicketsDB(db);
    return cardMsg;
  } catch (err) {
    console.error('❌ postTicketCard error:', err);
  }
}

// Mark a ticket card as updated (reply received)
async function markTicketUpdated(guild, ticketChannel, adminChannel) {
  const db = loadTicketsDB();
  const record = db[ticketChannel.id];
  if (!record || !record.cardMessageId) return;
  try {
    const msg = await adminChannel.messages.fetch(record.cardMessageId);
    if (!msg) return;
    const oldEmbed = msg.embeds[0];
    if (!oldEmbed) return;
    const updated = EmbedBuilder.from(oldEmbed)
      .setTitle('📬 ' + ticketChannel.name + '  *(updated)*')
      .setTimestamp();
    await msg.edit({ embeds: [updated], components: msg.components });
  } catch {}
}

// On bot startup: post catch-up cards for existing ticket channels without cards
async function runTicketCatchup(guild, ticketsChannel) {
  const categoryId = process.env.TICKETS_CATEGORY_ID;
  if (!categoryId) return;
  const db = loadTicketsDB();
  const ticketChannels = guild.channels.cache.filter(
    ch => ch.parentId === categoryId && ch.isTextBased && ch.isTextBased()
  );
  for (const [, ch] of ticketChannels) {
    if (db[ch.id] && db[ch.id].cardMessageId) continue;
    try {
      const messages = await ch.messages.fetch({ limit: 20 });
      const firstUserMsg = messages.filter(m => !m.author.bot).last();
      await postTicketCard(guild, ch, ticketsChannel, firstUserMsg || null);
    } catch (err) {
      console.error('❌ Ticket catchup error for ' + ch.name + ':', err.message);
    }
  }
  console.log('✅ Ticket catchup complete: ' + ticketChannels.size + ' channel(s) scanned');
}

module.exports = { postTicketCard, markTicketUpdated, runTicketCatchup };