const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { getStore, markDirty } = require('./db');

function getConfig() {
  const store = getStore();
  if (!store._config) store._config = {};
  return store._config;
}

async function getOrCreateTicketsHub(guild) {
  const config = getConfig();
  if (config.ticketsHubChannelId) {
    const stored = guild.channels.cache.get(config.ticketsHubChannelId);
    if (stored) return stored;
  }
  if (process.env.TICKETS_CHANNEL_ID) {
    const envCh = guild.channels.cache.get(process.env.TICKETS_CHANNEL_ID);
    if (envCh) { config.ticketsHubChannelId = envCh.id; markDirty(); return envCh; }
  }
  const byName = guild.channels.cache.find(ch => ch.name.includes('tickets-hub'));
  if (byName) { config.ticketsHubChannelId = byName.id; markDirty(); return byName; }
  try {
    const adminRole = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.Administrator) && !r.managed);
    const everyoneRole = guild.roles.everyone;
    const hubChannel = await guild.channels.create({
      name: '🎫│tickets-hub',
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
        ...(adminRole ? [{ id: adminRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
        { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
      ],
      reason: 'Ticket hub for admin overview',
    });
    console.log('🎫 Created tickets hub: ' + hubChannel.id);
    config.ticketsHubChannelId = hubChannel.id;
    markDirty();
    return hubChannel;
  } catch (e) { console.error('Failed to create tickets hub:', e.message); }
  return null;
}

function buildTicketCard(ticketChannel, member, firstMessage) {
  const preview = firstMessage?.content?.substring(0, 200) || '*(no message)*';
  return new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle(`🎫 ${ticketChannel.name}`)
    .setDescription(`**${member?.user?.username || 'Unknown'}** opened a ticket.\n\n> ${preview}`)
    .setThumbnail(member?.user?.displayAvatarURL({ extension: 'png' }) || null)
    .addFields(
      { name: '👤 User', value: `${member || 'Unknown'}`, inline: true },
      { name: '📅 Opened', value: `<t:${Math.floor(ticketChannel.createdTimestamp / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: 'Elevate 🪽 • Ticket Hub' })
    .setTimestamp();
}

function buildTicketRow(ticketChannel) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('📂 Open Ticket')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${ticketChannel.guild.id}/${ticketChannel.id}`),
  );
}

async function postTicketCard(guild, ticketChannel, adminCh, firstMsg) {
  const hub = adminCh || await getOrCreateTicketsHub(guild);
  if (!hub) return;
  let member = null;
  try {
    for (const [, ow] of ticketChannel.permissionOverwrites.cache) {
      if (ow.type === 1 && !member) { member = await guild.members.fetch(ow.id).catch(() => null); }
    }
  } catch {}
  let firstMessage = firstMsg || null;
  if (!firstMessage) {
    try {
      const msgs = await ticketChannel.messages.fetch({ limit: 5 });
      firstMessage = msgs.filter(m => !m.author.bot).last();
    } catch {}
  }
  const embed = buildTicketCard(ticketChannel, member, firstMessage);
  const row = buildTicketRow(ticketChannel);
  try { return await hub.send({ embeds: [embed], components: [row] }); }
  catch (e) { console.error('Failed to post ticket card:', e.message); }
}

// Stub — prevents TypeError when called from messageCreate handler
async function markTicketUpdated(guild, ticketChannel, adminCh) {}

async function runTicketCatchup(guild) {
  const hub = await getOrCreateTicketsHub(guild);
  if (!hub) { console.error('🎫 Could not get/create tickets hub'); return; }
  const ticketChannels = guild.channels.cache.filter(ch =>
    ch.type === ChannelType.GuildText && /^ticket-/i.test(ch.name)
  );
  if (ticketChannels.size === 0) { console.log('🎫 No existing tickets found.'); return; }
  const existingCards = new Set();
  try {
    const msgs = await hub.messages.fetch({ limit: 100 });
    msgs.forEach(m => {
      const match = m.components?.[0]?.components?.[0]?.url?.match(/\/channels\/\d+\/(\d+)/);
      if (match) existingCards.add(match[1]);
    });
  } catch {}
  let posted = 0;
  for (const [, ch] of ticketChannels) {
    if (existingCards.has(ch.id)) continue;
    await postTicketCard(guild, ch, hub, null);
    posted++;
    await new Promise(r => setTimeout(r, 300));
  }
  if (posted > 0) console.log(`🎫 Posted ${posted} ticket catchup cards`);
  else console.log('🎫 All ticket cards already posted.');
}

module.exports = { postTicketCard, markTicketUpdated, runTicketCatchup, getOrCreateTicketsHub };
