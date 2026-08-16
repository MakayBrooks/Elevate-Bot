'use strict';
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, PermissionFlagsBits,
} = require('discord.js');
const { getStore, markDirty } = require('./db');

const IDLE_MS = 14 * 24 * 60 * 60 * 1000;
const HUB_CHANNEL_NAME = 'mentorship';
// Longest auto-archive window available without extra server boosts —
// keeps threads from going stale/archived too early, though the bot can
// still read/close them even if Discord archives one anyway.
const THREAD_AUTO_ARCHIVE = 10080;

function cfg() {
    const s = getStore();
    if (!s._ticketHub) s._ticketHub = { tickets: {} };
    if (!s._ticketHub.tickets) s._ticketHub.tickets = {};
    return s._ticketHub;
}
function save() { markDirty(); }

// The mentor is the only person allowed to see the hub channel — survey
// answers in it are private by design, so access is locked to one specific
// user rather than any role (an admin/mod role would see them too otherwise).
function mentorId(guild) {
    return process.env.MENTOR_USER_ID || guild.ownerId;
}

async function findOrCreateStaffCategory(guild) {
    const existing = guild.channels.cache.find(ch => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase().includes('staff'))
      || guild.channels.cache.find(ch => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase().includes('ticket'));
    if (existing) return existing;

    const perms = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    ];
    const adminRole = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.Administrator) && !r.managed);
    if (adminRole) perms.push({ id: adminRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    return guild.channels.create({ name: 'STAFF ONLY', type: ChannelType.GuildCategory, permissionOverwrites: perms }).catch(() => null);
}

async function setupTicketHub(guild) {
    const c = cfg();
    await guild.channels.fetch().catch(() => {});

  const cat = await findOrCreateStaffCategory(guild);
    if (!cat) return c;
    c.categoryId = cat.id;

  // Lock the hub channel to the mentor + bot only, regardless of who the
  // category itself is open to. Explicitly deny every role/member the
  // category currently grants view access to, so nothing is inherited —
  // then explicitly allow only the mentor and the bot.
  const mentor = mentorId(guild);
    const overwrites = [];
    for (const [id] of cat.permissionOverwrites.cache) {
          overwrites.push({ id, deny: [PermissionFlagsBits.ViewChannel] });
    }
    overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
    overwrites.push({
          id: guild.client.user.id,
          allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.CreatePrivateThreads,
                PermissionFlagsBits.SendMessagesInThreads,
                PermissionFlagsBits.ManageThreads,
          ],
    });
    overwrites.push({
          id: mentor,
          allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.SendMessagesInThreads,
          ],
    });

  let hubCh = c.hubChId ? guild.channels.cache.get(c.hubChId) : null;
    if (!hubCh) hubCh = guild.channels.cache.find(x => x.parentId === cat.id && x.name === HUB_CHANNEL_NAME);
    if (!hubCh) {
          hubCh = await guild.channels.create({ name: HUB_CHANNEL_NAME, type: ChannelType.GuildText, parent: cat.id, permissionOverwrites: overwrites });
    } else {
          await hubCh.permissionOverwrites.set(overwrites).catch(() => {});
    }
    c.hubChId = hubCh.id;

  save();
    return c;
}

async function fetchThread(guild, threadId) {
    return guild.channels.cache.get(threadId)
      || await guild.channels.fetch(threadId).catch(() => null);
}

// -- Per-applicant private thread ------------------------------------

function sanitizeThreadName(username) {
    const clean = username
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `mentee-${clean || 'user'}`;
}

async function getOrCreateTicketThread(guild, applicant, mentorMember, existingThreadId) {
    const c = cfg();
    const hubCh = guild.channels.cache.get(c.hubChId);
    if (!hubCh) throw new Error('Ticket hub channel is not set up yet');

  if (existingThreadId) {
        const existing = await fetchThread(guild, existingThreadId);
        if (existing) return { thread: existing, reused: true };
  }

  const thread = await hubCh.threads.create({
        name: sanitizeThreadName(applicant.username),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: THREAD_AUTO_ARCHIVE,
        reason: `Private mentorship space for ${applicant.tag}`,
  });

  await thread.members.add(applicant.id).catch(() => {});
    if (mentorMember) await thread.members.add(mentorMember.id).catch(() => {});

  return { thread, reused: false };
}

// -- Card builders ------------------------------------

function linkRow(threadId, extraButton) {
    const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Open Thread').setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${process.env.GUILD_ID}/${threadId}`)
        );
    if (extraButton) row.addComponents(extraButton);
    return row;
}

function buildNewEmbed(ticket, threadId) {
    const e = new EmbedBuilder()
      .setColor(0xF5C518)
      .setAuthor({ name: ticket.applicantTag, iconURL: ticket.applicantAvatar })
      .setTitle('\u{1F195} New ' + (ticket.type === 'mentorship' ? 'Mentorship Application' : 'Ticket'))
      .addFields(
        { name: 'Thread', value: `<#${threadId}>`, inline: true },
        { name: 'Opened', value: `<t:${Math.floor(ticket.openedAt / 1000)}:R>`, inline: true }
            )
      .setTimestamp();
    if (ticket.answersText) e.addFields({ name: '\u{1F4CB} Survey Answers', value: ticket.answersText, inline: false });
    return e;
}

async function postNewCard(guild, threadId) {
    const c = cfg();
    const t = c.tickets[threadId];
    if (!t) return;
    const hubCh = guild.channels.cache.get(c.hubChId);
    if (!hubCh) return;
    const btn = new ButtonBuilder().setCustomId('hub_ack_' + threadId).setLabel('Acknowledge').setEmoji('✅').setStyle(ButtonStyle.Success);
    const msg = await hubCh.send({ embeds: [buildNewEmbed(t, threadId)], components: [linkRow(threadId, btn)] }).catch(() => null);
    if (msg) { t.newCardMsgId = msg.id; save(); }
}

async function registerTicket(guild, thread, { type, applicant, answersText }) {
    const c = cfg();
    c.tickets[thread.id] = {
          type,
          applicantId: applicant.id,
          applicantTag: applicant.tag,
          applicantAvatar: applicant.displayAvatarURL({ extension: 'png' }),
          answersText: answersText || null,
          openedAt: Date.now(),
          lastActivityAt: Date.now(),
          acknowledged: false,
          unread: false,
    };
    save();
    await postNewCard(guild, thread.id);
}

function buildMsgEmbed(ticket, threadId, preview) {
    return new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({ name: ticket.applicantTag, iconURL: ticket.applicantAvatar })
      .setTitle('\u{1F4AC} New Message')
      .setDescription(preview ? preview.slice(0, 200) : '*attachment/embed*')
      .addFields({ name: 'Thread', value: `<#${threadId}>`, inline: true })
      .setTimestamp();
}

async function onTicketActivity(guild, channel, message) {
    const c = cfg();
    const t = c.tickets[channel.id];
    if (!t) return;
    t.lastActivityAt = Date.now();

    const hubCh = guild.channels.cache.get(c.hubChId);

  if (t.idleCardMsgId) {
          if (hubCh) await hubCh.messages.delete(t.idleCardMsgId).catch(() => {});
          delete t.idleCardMsgId;
    }

    if (message.author.id !== t.applicantId) { save(); return; }

    if (!t.unread) {
          t.unread = true;
          save();
          if (hubCh) {
                  const btn = new ButtonBuilder().setCustomId('hub_read_' + channel.id).setLabel('Mark Read').setEmoji('\u{1F4EC}').setStyle(ButtonStyle.Secondary);
                  const msg = await hubCh.send({ embeds: [buildMsgEmbed(t, channel.id, message.content)], components: [linkRow(channel.id, btn)] }).catch(() => null);
                  if (msg) { t.msgCardMsgId = msg.id; save(); }
          }
    } else {
          save();
    }
}

function buildIdleEmbed(ticket, threadId) {
    const days = Math.floor((Date.now() - ticket.lastActivityAt) / (24 * 60 * 60 * 1000));
    return new EmbedBuilder()
      .setColor(0xAAAAAA)
      .setAuthor({ name: ticket.applicantTag, iconURL: ticket.applicantAvatar })
      .setTitle('⏰ Idle Ticket')
      .setDescription(`No activity for **${days} days**.`)
      .addFields({ name: 'Thread', value: `<#${threadId}>`, inline: true })
      .setTimestamp();
}

async function sweepIdle(guild) {
    const c = cfg();
    const hubCh = guild.channels.cache.get(c.hubChId);
    if (!hubCh) return;
    const now = Date.now();
    for (const [threadId, t] of Object.entries(c.tickets)) {
          if (t.idleCardMsgId) continue;
          if (now - t.lastActivityAt < IDLE_MS) continue;
          const thread = await fetchThread(guild, threadId);
          if (!thread) { delete c.tickets[threadId]; continue; }
          const btn = new ButtonBuilder().setCustomId('hub_close_' + threadId).setLabel('Close Ticket').setEmoji('\u{1F5D1}️').setStyle(ButtonStyle.Danger);
          const msg = await hubCh.send({ embeds: [buildIdleEmbed(t, threadId)], components: [linkRow(threadId, btn)] }).catch(() => null);
          if (msg) t.idleCardMsgId = msg.id;
    }
    save();
}

// -- Button router ------------------------------------

async function handleTicketHubButton(interaction, guild) {
    const id = interaction.customId;
    if (!id.startsWith('hub_')) return false;
    const c = cfg();

    if (id.startsWith('hub_ack_')) {
          const threadId = id.replace('hub_ack_', '');
          const t = c.tickets[threadId];
          if (t) { t.acknowledged = true; delete t.newCardMsgId; save(); }
          await interaction.message.delete().catch(() => {});
          return true;
    }

    if (id.startsWith('hub_read_')) {
          const threadId = id.replace('hub_read_', '');
          const t = c.tickets[threadId];
          if (t) { t.unread = false; delete t.msgCardMsgId; save(); }
          await interaction.message.delete().catch(() => {});
          return true;
    }

    if (id.startsWith('hub_close_')) {
          const threadId = id.replace('hub_close_', '');
          await interaction.deferUpdate().catch(() => {});
          const thread = await fetchThread(guild, threadId);
          if (thread) await thread.delete().catch(() => {});
          delete c.tickets[threadId];
          save();
          await interaction.message.delete().catch(() => {});
          return true;
    }

    return false;
}

module.exports = {
      setupTicketHub,
      getOrCreateTicketThread,
      registerTicket,
      onTicketActivity,
      sweepIdle,
      handleTicketHubButton,
};
