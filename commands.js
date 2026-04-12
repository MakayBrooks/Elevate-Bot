const { SlashCommandBuilder } = require('discord.js');

module.exports = [
  new SlashCommandBuilder()
    .setName('journal')
    .setDescription('Trading journal commands')
    .addSubcommand(sub =>
      sub.setName('stats')
        .setDescription('See your trading stats (private)')
    ),

  new SlashCommandBuilder()
    .setName('calendar')
    .setDescription('Post this week\'s economic calendar now (admin only)'),
].map(cmd => cmd.toJSON());
