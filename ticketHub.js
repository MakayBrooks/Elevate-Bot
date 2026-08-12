'use strict';
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, PermissionFlagsBits,
} = require('discord.js');
const { getStore, markDirty } = require('./db');

const IDLE_MS = 14 * 24 * 60 * 60 * 1000;

function cfg() {
    const s = getStore();
    if (!s._ticketHub) s._ticketHub = { tickets: {} };
    if (!s._ticketHub.tickets) s._ticketHub.tickets = {};
    return s._ticketHub;
}
function save() { markDirty(); }

async function setupTicketHub(guild) {
    const c = cfg();
    await guild.channels.fetch().catch(() => {});

  let cat = c.categoryId ? guild.channels.cache.get(c.categoryId) : null;
    if (!cat) {
          cat = guild.channels.cache.find(ch => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase().includes('staff'))
            || guild.channels.cache.find(ch => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase().includes('ticket'));
    }
    if (!cat) {
          const perms = [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
                ];
          const adminRole = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.Administrator) && !r.managed);
          if (adminRole) perms.push({ id: adminRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
          cat = await guild.channels.create({ name: 'STAFF ONLY', type: ChannelType.GuildCategory, permissionOverwrites: perms });
    }
    c.categoryId = cat.id;

  async function getOrCreate(idKey, name) {
        let ch = c[idKey] ? guild.channels.cache.get(c[idKey]) : null;
        if (!ch) ch = guild.channels.cache.find(x => x.parentId === cat.id && x.name === name);
        if (!ch) ch = await guild.channels.create({ name, type: ChannelType.GuildText, parent: cat.id });
        c[idKey] = ch.id;
        return ch;
  }

  await getOrCreate('newChId', 'new-tickets');
    await getOrCreate('messagesChId', 'new-messages');
    await getOrCreate('idleChId', 'idle-tickets');
    save();
    return c;

  // -- Card builders ------------------------------------

  function linkRow(channelId, extraButton) {
      const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Open Channel').setStyle(ButtonStyle.Link)
              .setURL(`https://discord.com/channels/${process.env.GUILD_ID}/${channelId}`)
          );
      if (extraButton) row.addComponents(extraButton);
      return row;
  }

  function buildNewEmbed(ticket, channelId) {
      const e = new EmbedBuilder()
        .setColor(0xF5C518)
        .setAuthor({ name: ticket.applicantTag, iconURL: ticket.applicantAvatar })
        .setTitle('\u{1F195} New ' + (ticket.type === 'mentorship' ? 'Mentorship Application' : 'Ticket'))
        .addFields(
          { name: 'Channel', value: `<#${channelId}>`, inline: true },
          { name: 'Opened', value: `<t:${Math.floor(ticket.openedAt / 1000)}:R>`, inline: true }
              )
        .setTimestamp();
      if (ticket.answersText) e.addFields({ name: '\u{1F4CB} Survey Answers', value: ticket.answersText, inline: false });
      return e;
  }

  async function postNewCard(guild, channelId) {
      const c = cfg();
      const t = c.tickets[channelId];
      if (!t) return;
      const hubCh = guild.channels.cache.get(c.newChId);
      if (!hubCh) return;
      const btn = new ButtonBuilder().setCustomId('hub_ack_' + channelId).setLabel('Acknowledge').setEmoji('✅').setStyle(ButtonStyle.Success);
      const msg = await hubCh.send({ embeds: [buildNewEmbed(t, channelId)], components: [linkRow(channelId, btn)] }).catch(() => null);
      if (msg) { t.newCardMsgId = msg.id; save(); }
  }

  async function registerTicket(guild, channel, { type, applicant, answersText }) {
      const c = cfg();
      c.tickets[channel.id] = {
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
      await postNewCard(guild, channel.id);
  }

  function buildMsgEmbed(ticket, channelId, preview) {
      return new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: ticket.applicantTag, iconURL: ticket.applicantAvatar })
        .setTitle('\u{1F4AC} New Message')
        .setDescription(preview ? preview.slice(0, 200) : '*attachment/embed*')
        .addFields({ name: 'Channel', value: `<#${channelId}>`, inline: true })
        .setTimestamp();
  }

  async function onTicketActivity(guild, channel, message) {
      const c = cfg();
      const t = c.tickets[channel.id];
      if (!t) return;
      t.lastActivityAt = Date.now();

      if (t.idleCardMsgId) {
            const idleCh = guild.channels.cache.get(c.idleChId);
            if (idleCh) await idleCh.messages.delete(t.idleCardMsgId).catch(() => {});
            delete t.idleCardMsgId;
      }

      if (message.author.id !== t.applicantId) { save(); return; }

      if (!t.unread) {
            t.unread = true;
            save();
            const msgCh = guild.channels.cache.get(c.messagesChId);
            if (msgCh) {
                    const btn = new ButtonBuilder().setCustomId('hub_read_' + channel.id).setLabel('Mark Read').setEmoji('\u{1F4EC}').setStyle(ButtonStyle.Secondary);
                    const msg = await msgCh.send({ embeds: [buildMsgEmbed(t, channel.id, message.content)], components: [linkRow(channel.id, btn)] }).catch(() => null);
                    if (msg) { t.msgCardMsgId = msg.id; save(); }
            }
      } else {
            save();
      }
  }

  function buildIdleEmbed(ticket, channelId) {
      const days = Math.floor((Date.now() - ticket.lastActivityAt) / (24 * 60 * 60 * 1000));
      return new EmbedBuilder()
        .setColor(0xAAAAAA)
        .setAuthor({ name: ticket.applicantTag, iconURL: ticket.applicantAvatar })
        .setTitle('⏰ Idle Ticket')
        .setDescription(`No activity for **${days} days**.`)
        .addFields({ name: 'Channel', value: `<#${channelId}>`, inline: true })
        .setTimestamp();
  }

  async function sweepIdle(guild) {
      const c = cfg();
      const idleCh = guild.channels.cache.get(c.idleChId);
      if (!idleCh) return;
      const now = Date.now();
      for (const [channelId, t] of Object.entries(c.tickets)) {
            if (t.idleCardMsgId) continue;
            if (now - t.lastActivityAt < IDLE_MS) continue;
            const channel = guild.channels.cache.get(channelId);
            if (!channel) { delete c.tickets[channelId]; continue; }
            const btn = new ButtonBuilder().setCustomId('hub_close_' + channelId).setLabel('Close Ticket').setEmoji('\u{1F5D1}️').setStyle(ButtonStyle.Danger);
            const msg = await idleCh.send({ embeds: [buildIdleEmbed(t, channelId)], components: [linkRow(channelId, btn)] }).catch(() => null);
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
            const chId = id.replace('hub_ack_', '');
            const t = c.tickets[chId];
            if (t) { t.acknowledged = true; delete t.newCardMsgId; save(); }
            await interaction.message.delete().catch(() => {});
            return true;
      }

      if (id.startsWith('hub_read_')) {
            const chId = id.replace('hub_read_', '');
            const t = c.tickets[chId];
            if (t) { t.unread = false; delete t.msgCardMsgId; save(); }
            await interaction.message.delete().catch(() => {});
            return true;
      }

      if (id.startsWith('hub_close_')) {
            const chId = id.replace('hub_close_', '');
            await interaction.deferUpdate().catch(() => {});
            const channel = guild.channels.cache.get(chId);
            if (channel) await channel.delete().catch(() => {});
            delete c.tickets[chId];
            save();
            await interaction.message.delete().catch(() => {});
            return true;
      }

      return false;
  }

module.exports = {
      setupTicketHub,
      registerTicket,
      onTicketActivity,
      sweepIdle,
      handleTicketHubButton,
  };
}
