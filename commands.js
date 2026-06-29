const { SlashCommandBuilder } = require('discord.js');

module.exports = [
  new SlashCommandBuilder()
    .setName('journal')
    .setDescription('Trading journal commands')
    .addSubcommand(sub => sub.setName('stats').setDescription('See your trading stats (private)')),

  new SlashCommandBuilder()
    .setName('addpoints')
    .setDescription('Add points to a user (admin only)')
    .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(opt => opt.setName('amount').setDescription('Points').setRequired(true)),

  new SlashCommandBuilder()
    .setName('calendar')
    .setDescription('Post this week\'s economic calendar (admin only)'),

  new SlashCommandBuilder()
    .setName('setup-leaderboard')
    .setDescription('Admin: reset leaderboard channel — deletes bot messages and reposts in correct order'),

  new SlashCommandBuilder()
    .setName('setup-start-here')
    .setDescription('Admin: post the server onboarding embeds in the current channel'),

  new SlashCommandBuilder()
    .setName('setup-rules')
    .setDescription('Admin: post the server rules embeds in the current channel'),

new SlashCommandBuilder()
  .setName('setup-shop')
  .setDescription('Admin: reset shop channel — deletes bot messages and reposts shop panel'),


  new SlashCommandBuilder()
    .setName('fixrole')
    .setDescription('[Admin] Manually assign the correct shop role to a user based on their inventory')
    .addUserOption(opt => opt.setName('user').setDescription('User to fix').setRequired(true)),


  new SlashCommandBuilder()
    .setName('fixrole')
    .setDescription('[Admin] Re-assign the correct shop role based on a user\'s inventory')
    .addUserOption(opt => opt.setName('user').setDescription('User to fix').setRequired(true)),

].map(cmd => cmd.toJSON());
