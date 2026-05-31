const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

// Get or create the admin tickets hub channel
async function getOrCreateTicketsHub(guild) {
  // Check env var first
  let hubChannel = guild.channels.cache.get(process.env.TICKETS_CHANNEL_ID);
  if (hubChannel) return hubChannel;

  // Create it — admin-only text channel
  try {
    const adminRole = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.Administrator) && !r.managed);
    const everyoneRole = guild.roles.everyone;
    hubChannel = await guild.channels.create({
      name: '\u{1F3AB}\u2502tickets-hub',
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
        ...(adminRole ? [{ id: adminRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
        { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
      ],
      reason: 'Ticket hub for admin overview',
    });
    console.log('\u{1F3AB} Created tickets hub: ' + hubChannel.id);
    // Store the ID so bot can find it next restart
    process.env.TICKETS_CHANNEL_ID = hubChannel.id;
  } catch (e) {
    console.error('Failed to create tickets hub:', e.message);
  }
  return hubChannel;
}

// Build a ticket summary card
function buildTicketCard(ticketChannel, member, firstMessage) {
  const preview = firstMessage?.content?.substring(0, 200) || '*(no message)*';
  return new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle(`\u{1F3AB} ${ticketChannel.name}`)
    .setDescription(`**${member?.user?.username || 'Unknown'}** opened a ticket.

> ${preview}`)
    .setThumbnail(member?.user?.displayAvatarURL({ extension: 'png' }) || null)
    .addFields(
      { name: '\u{1F464} User', value: `${member || 'Unknown'}`, inline: true },
      { name: '\u{1F4C5} Opened', value: `<t:${Math.floor(ticketChannel.createdTimestamp / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: 'Elevate \u{1FAB5} \u2022 Ticket Hub' })
    .setTimestamp();
}

function buildTicketRow(ticketChannel) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('\u{1F4C2} Open Ticket')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${ticketChannel.guild.id}/${ticketChannel.id}`),
  );
}

// Post a card for a new ticket
async function postTicketCard(guild, ticketChannel) {
  const hub = await getOrCreateTicketsHub(guild);
  if (!hub) return;
  // Get the opener (first non-bot member who can see the channel)
  let member = null;
  try {
    await ticketChannel.permissionOverwrites.cache.forEach(async (ow) => {
      if (ow.type === 1 && !member) { // type 1 = member
        member = await guild.members.fetch(ow.id).catch(() => null);
      }
    });
  } catch {}
  // Get first message in ticket
  let firstMessage = null;
  try {
    const msgs = await ticketChannel.messages.fetch({ limit: 5 });
    firstMessage = msgs.filter(m => !m.author.bot).last();
  } catch {}

  const embed = buildTicketCard(ticketChannel, member, firstMessage);
  const row = buildTicketRow(ticketChannel);
  try {
    const msg = await hub.send({ embeds: [embed], components: [row] });
    // Store card message ID on channel topic so we can update it
    return msg;
  } catch (e) {
    console.error('Failed to post ticket card:', e.message);
  }
}

// Post cards for all existing tickets on startup
async function runTicketCatchup(guild) {
  const hub = await getOrCreateTicketsHub(guild);
  if (!hub) return;
  // Find all ticket channels (named ticket-XXXX)
  const ticketChannels = guild.channels.cache.filter(ch =>
    ch.type === ChannelType.GuildText && /^ticket-\d+/.test(ch.name)
  );
  if (ticketChannels.size === 0) return;
  // Check which ones already have a card
  const existingCards = new Set();
  try {
    const msgs = await hub.messages.fetch({ limit: 100 });
    msgs.forEach(m => {
      m.components?.[0]?.components?.[0]?.url?.match(/\/channels\/\d+\/(\d+)/)?.[1]
        && existingCards.add(m.components[0].components[0].url.match(/\/channels\/\d+\/(\d+)/)[1]);
    });
  } catch {}

  let posted = 0;
  for (const [, ch] of ticketChannels) {
    if (existingCards.has(ch.id)) continue;
    await postTicketCard(guild, ch);
    posted++;
    await new Promise(r => setTimeout(r, 300)); // rate limit
  }
  if (posted > 0) console.log(`\u{1F3AB} Posted ${posted} ticket catchup cards`);
}

module.exports = { postTicketCard, runTicketCatchup, getOrCreateTicketsHub };
