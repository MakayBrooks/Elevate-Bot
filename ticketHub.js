'use strict';
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ChannelType, PermissionFlagsBits,
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

// parentChannel must be a channel the applicant can actually see (e.g. the
// public mentorship channel the panel button lives in) — NOT the STAFF ONLY
// hub channel. Private-thread membership only grants access to that one
// thread; it doesn't grant access to a parent channel the applicant has no
// view permission on, which is what made every mentee's ticket unreachable.
// Being a thread member only grants visibility, not the ability to post.
// Posting in a thread requires Send Messages in Threads on the PARENT
// channel, and if that channel's own role permissions don't grant it to
// regular members (common on a channel meant to just host a panel), the
// mentee ends up able to open their ticket but never type in it. A
// member-specific overwrite guarantees send access regardless of the
// channel's general policy, without changing anything for anyone else.
// Re-applied on every click (not just thread creation) so it also repairs
// already-existing tickets that were created before this fix.
async function grantApplicantThreadAccess(parentChannel, thread, applicant, mentorMember) {
    await thread.members.add(applicant.id).catch(() => {});
    if (mentorMember) await thread.members.add(mentorMember.id).catch(() => {});

    await parentChannel.permissionOverwrites.edit(applicant.id, {
          ViewChannel: true,
          SendMessages: true,
          SendMessagesInThreads: true,
          ReadMessageHistory: true,
    }).catch(err => {
          console.error(`[ticketHub] Could not grant ${applicant.tag} send access on #${parentChannel.name}: ${err.message}`);
    });
}

async function getOrCreateTicketThread(guild, applicant, mentorMember, existingThreadId, parentChannel) {
    if (!parentChannel) throw new Error('getOrCreateTicketThread requires a member-visible parent channel');

  if (existingThreadId) {
        const existing = await fetchThread(guild, existingThreadId);
        if (existing) {
              if (existing.parentId === parentChannel.id) {
                    await grantApplicantThreadAccess(parentChannel, existing, applicant, mentorMember);
                    return { thread: existing, reused: true };
              }
              // Stale thread from before tickets were parented to a visible channel — replace it.
              await existing.delete().catch(() => {});
        }
  }

  const thread = await parentChannel.threads.create({
        name: sanitizeThreadName(applicant.username),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: THREAD_AUTO_ARCHIVE,
        reason: `Private mentorship space for ${applicant.tag}`,
  });

  await grantApplicantThreadAccess(parentChannel, thread, applicant, mentorMember);

  return { thread, reused: false };
}

// -- Dashboard (single pinned, continuously-updated message) --------------
//
// Individual per-ticket cards used to get deleted the moment you acted on
// them (Acknowledge / Mark Read / Close), so there was no way back to a
// ticket once you'd touched it. Instead there's now one pinned message,
// re-rendered in place on every relevant event, sorted into three buckets:
// unread, active, and idle. Every ticket stays a clickable thread mention
// for as long as it exists — nothing about it ever gets deleted.

const SECTION_LIMIT = 15;

function relativeTime(ts) {
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function ticketLine(threadId, t) {
    return `<#${threadId}> — **${t.applicantTag}** — ${relativeTime(t.lastActivityAt)}`;
}

function renderSection(list, emptyText) {
    if (list.length === 0) return emptyText;
    const lines = list.slice(0, SECTION_LIMIT).map(([id, t]) => ticketLine(id, t));
    if (list.length > SECTION_LIMIT) lines.push(`*...and ${list.length - SECTION_LIMIT} more*`);
    return lines.join('\n');
}

function buildDashboardEmbed(c) {
    const now = Date.now();
    const entries = Object.entries(c.tickets);

    const idle = [];
    const unread = [];
    const active = [];

    for (const entry of entries) {
          const [, t] = entry;
          if (now - t.lastActivityAt >= IDLE_MS) idle.push(entry);
          else if (t.unread) unread.push(entry);
          else active.push(entry);
    }

    idle.sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt);
    unread.sort((a, b) => b[1].lastActivityAt - a[1].lastActivityAt);
    active.sort((a, b) => b[1].lastActivityAt - a[1].lastActivityAt);

    return new EmbedBuilder()
      .setColor(0xF5F0E8)
      .setTitle('\u{1F39F}️ Mentorship Tickets')
      .setDescription(
            `**${entries.length}** total · ${active.length} active · ${unread.length} unread · ${idle.length} idle (14d+)`
          )
      .addFields(
            { name: `\u{1F4AC} New Messages (${unread.length})`, value: renderSection(unread, '*No unread messages.*'), inline: false },
            { name: `✅ Active (${active.length})`, value: renderSection(active, '*No active tickets.*'), inline: false },
            { name: `\u{1F634} Idle 14d+ (${idle.length})`, value: renderSection(idle, '*No idle tickets.*'), inline: false },
          )
      .setFooter({ text: 'Auto-updates on new tickets, messages, and idle sweeps · Refresh to force a redraw' })
      .setTimestamp();
}

function ticketOptionLabel(t) {
    const label = t.applicantTag && t.applicantTag.length <= 100 ? t.applicantTag : 'Unknown user';
    return { label, description: `${relativeTime(t.lastActivityAt)}` };
}

function buildDashboardComponents(c) {
    const rows = [];
    const entries = Object.entries(c.tickets);

    const unread = entries.filter(([, t]) => t.unread);
    if (unread.length > 0) {
          const sorted = unread.sort((a, b) => b[1].lastActivityAt - a[1].lastActivityAt).slice(0, 25);
          rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('hub_markread_select')
                  .setPlaceholder('✅ Mark a ticket active (read)...')
                  .addOptions(sorted.map(([id, t]) => ({ value: id, ...ticketOptionLabel(t) })))
              ));
    }

    if (entries.length > 0) {
          // Oldest activity first — idle/abandoned tickets are the ones most
          // likely to actually get deleted, so put them within easy reach.
          const sorted = [...entries].sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt).slice(0, 25);
          rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('hub_delete_select')
                  .setPlaceholder('\u{1F5D1}️ Delete a ticket...')
                  .addOptions(sorted.map(([id, t]) => ({ value: id, ...ticketOptionLabel(t) })))
              ));
    }

    rows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('hub_refresh').setLabel('Refresh').setEmoji('\u{1F504}').setStyle(ButtonStyle.Secondary)
        ));

    return rows;
}

async function renderDashboard(guild) {
    const c = cfg();
    const hubCh = guild.channels.cache.get(c.hubChId);
    if (!hubCh) return;

    const embed = buildDashboardEmbed(c);
    const components = buildDashboardComponents(c);

    if (c.dashboardMsgId) {
          const existing = await hubCh.messages.fetch(c.dashboardMsgId).catch(() => null);
          if (existing) {
                await existing.edit({ embeds: [embed], components }).catch(() => {});
                return;
          }
    }

    const msg = await hubCh.send({ embeds: [embed], components }).catch(() => null);
    if (msg) {
          c.dashboardMsgId = msg.id;
          save();
          await msg.pin().catch(() => {});
    }
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
          unread: false,
    };
    save();
    await renderDashboard(guild);
}

// Read state is fully automatic now: the applicant messaging marks a
// ticket unread, and the mentor/staff replying in the thread marks it
// read again — no separate "Acknowledge"/"Mark Read" click needed.
async function onTicketActivity(guild, channel, message) {
    const c = cfg();
    const t = c.tickets[channel.id];
    if (!t) return;

    t.lastActivityAt = Date.now();
    t.unread = message.author.id === t.applicantId;
    save();

    await renderDashboard(guild);
}

async function sweepIdle(guild) {
    // Idle status is computed live from lastActivityAt at render time, so a
    // sweep is just a periodic redraw to catch tickets that crossed the 14
    // day mark without any new activity to trigger a render on their own.
    await renderDashboard(guild);
}

// -- Dashboard interaction router (buttons + select menus) ----------------

async function handleTicketHubButton(interaction, guild) {
    const id = interaction.customId;
    if (!id.startsWith('hub_')) return false;
    const c = cfg();

    if (id === 'hub_refresh') {
          await interaction.deferUpdate().catch(() => {});
          await renderDashboard(guild);
          return true;
    }

    if (interaction.isStringSelectMenu() && id === 'hub_markread_select') {
          const threadId = interaction.values[0];
          const t = c.tickets[threadId];
          if (t) { t.unread = false; save(); }
          await interaction.deferUpdate().catch(() => {});
          await renderDashboard(guild);
          return true;
    }

    if (interaction.isStringSelectMenu() && id === 'hub_delete_select') {
          const threadId = interaction.values[0];
          const t = c.tickets[threadId];
          const label = t ? t.applicantTag : 'this ticket';
          await interaction.reply({
                content: `Delete the ticket for **${label}**? This permanently deletes the thread and its message history.`,
                components: [
                      new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`hub_delete_confirm_${threadId}`).setLabel('Delete').setEmoji('\u{1F5D1}️').setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId('hub_delete_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
                          ),
                    ],
                ephemeral: true,
          });
          return true;
    }

    if (id.startsWith('hub_delete_confirm_')) {
          const threadId = id.replace('hub_delete_confirm_', '');
          await interaction.deferUpdate().catch(() => {});
          const thread = await fetchThread(guild, threadId);
          if (thread) await thread.delete().catch(() => {});
          delete c.tickets[threadId];
          save();
          await renderDashboard(guild);
          await interaction.editReply({ content: '\u{1F5D1}️ Ticket deleted.', components: [] }).catch(() => {});
          return true;
    }

    if (id === 'hub_delete_cancel') {
          await interaction.update({ content: 'Cancelled — nothing was deleted.', components: [] }).catch(() => {});
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
