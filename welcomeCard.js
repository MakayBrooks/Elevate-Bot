const { EmbedBuilder } = require('discord.js');

/**
 * Generates a styled welcome embed for Elevate.
 * No canvas/image required — uses Discord's native embed formatting.
 */
async function generateWelcomeCard(member) {
  const username = member.user.username;
  const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
  const memberCount = member.guild.memberCount;

  const embed = new EmbedBuilder()
    .setColor(0xF5F0E8)
    .setAuthor({
      name: 'ELEVATE 🪽',
      iconURL: member.guild.iconURL({ extension: 'png' }) || undefined,
    })
    .setTitle('WELCOME TO ELEVATE!')
    .setDescription(
      `> 🪽 **${member}** just joined the server.\n` +
      `> 👤 You are member **#${memberCount}**\n\n` +
      `Read the rules, set your roles, and let's get to work.`
    )
    .setThumbnail(avatarURL)
    .addFields(
      { name: '👤 Username', value: `\`${username}\``, inline: true },
      { name: '🔢 Member',   value: `\`#${memberCount}\``, inline: true },
      { name: '📅 Joined',   value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: 'ELEVATE COMMUNITY 🪽' })
    .setTimestamp();

  return embed;
}

module.exports = { generateWelcomeCard };
