const { SlashCommandBuilder } = require('discord.js');

module.exports = [
  new SlashCommandBuilder()
    .setName('journal')
    .setDescription('Trading journal commands')
    .addSubcommand(sub =>
      sub.setName('stats').setDescription('See your trading stats (private)')
    ),

  new SlashCommandBuilder()
    .setName('addpoints')
    .setDescription('Add points to a user (admin only)')
    .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(opt => opt.setName('amount').setDescription('Points').setRequired(true)),

  new SlashCommandBuilder()
    .setName('calendar')
    .setDescription('Post this week\'s economic calendar (admin only)'),

].map(cmd => cmd.toJSON());
