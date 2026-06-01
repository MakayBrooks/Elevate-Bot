const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { getStore, markDirty } = require('./db');

const ROLE_CONFIGS = [
  { id: 'role_trade_alerts',   label: '🔔 Trade Alerts',     desc: 'Get pinged for live trade setups and alerts',  name: 'Trade Alerts 🔔',    color: 0x57F287 },
  { id: 'role_announcements',  label: '📢 Announcements',    desc: 'Get pinged for server announcements',          name: 'Announcements 📢',   color: 0xFEE75C },
  { id: 'role_education',      label: '📚 Education Drops',  desc: 'Get pinged when new educational content drops', name: 'Education Drops 📚', color: 0x5865F2 },
];

function getConfig() {
  const store = getStore();
  if (!store._config) store._config = {};
  return store._config;
}

async function getOrCreateRole(guild, rc) {
  let role = guild.roles.cache.find(r => r.name === rc.name);
  if (!role) {
    role = await guild.roles.create({ name: rc.name, color: rc.color, mentionable: true, reason: 'Elevate self-assign role' });
    console.log('Created role: ' + rc.name);
  }
  return role;
}

async function postRolesPanel(guild) {
  const config = getConfig();

  // Find or create #roles channel
  let ch = config.rolesChannelId ? guild.channels.cache.get(config.rolesChannelId) : null;
  if (!ch) ch = guild.channels.cache.find(c => /^roles/i.test(c.name.replace(/[^\w]/g, '')) && c.type === ChannelType.GuildText);
  if (!ch) {
    const catId = process.env.MEMBER_COUNT_CATEGORY_ID || '1510789973656211566';
    const cat = guild.channels.cache.get(catId);
    ch = await guild.channels.create({
      name: 'roles',
      type: ChannelType.GuildText,
      parent: cat || null,
      topic: 'Pick your notification roles here.',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
        { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
      ],
    });
    console.log('Created #roles channel: ' + ch.id);
  }
  config.rolesChannelId = ch.id;
  markDirty();

  // Check if panel already exists
  try {
    const pinned = await ch.messages.fetchPinned();
    if (pinned.some(m => m.author.id === guild.client.user.id && m.embeds?.[0]?.title?.includes('Roles'))) {
      console.log('Roles panel already posted.');
      return;
    }
  } catch {}

  // Ensure all roles exist
  await Promise.all(ROLE_CONFIGS.map(rc => getOrCreateRole(guild, rc)));

  const embed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setTitle('Pick Your Roles')
    .setDescription('Click a button below to add or remove a notification role.\nClick again to toggle it off.')
    .addFields(ROLE_CONFIGS.map(rc => ({ name: rc.label, value: rc.desc, inline: false })))
    .setFooter({ text: 'Elevate - Self-Assign Roles' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    ROLE_CONFIGS.map(rc =>
      new ButtonBuilder().setCustomId(rc.id).setLabel(rc.label).setStyle(ButtonStyle.Secondary)
    )
  );

  const msg = await ch.send({ embeds: [embed], components: [row] });
  await msg.pin().catch(() => {});
  console.log('Roles panel posted in #' + ch.name);
}

async function handleRoleButton(interaction) {
  const rc = ROLE_CONFIGS.find(r => r.id === interaction.customId);
  if (!rc) return false;

  await interaction.deferReply({ ephemeral: true });
  const role = await getOrCreateRole(interaction.guild, rc);

  if (interaction.member.roles.cache.has(role.id)) {
    await interaction.member.roles.remove(role);
    await interaction.editReply({ content: 'Removed **' + rc.label + '** from your roles.' });
  } else {
    await interaction.member.roles.add(role);
    await interaction.editReply({ content: 'Added **' + rc.label + '** to your roles!' });
  }
  return true;
}

module.exports = { postRolesPanel, handleRoleButton, ROLE_CONFIGS };
