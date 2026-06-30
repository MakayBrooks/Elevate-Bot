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
    .setDescription("Post this week's economic calendar (admin only)"),

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
    .setName('setup-trading-lb')
    .setDescription('Admin: reset and repost the trading leaderboard'),

  new SlashCommandBuilder()
    .setName('fixrole')
    .setDescription('[Admin] Manually assign the correct shop role to a user based on their inventory')
    .addUserOption(opt => opt.setName('user').setDescription('User to fix').setRequired(true)),

  new SlashCommandBuilder()
    .setName('fixroles-all')
    .setDescription('[Admin] Assign correct shop roles to ALL users who bought one in the shop'),


  new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('[Admin] View a user\'s inventory and purchase history')
    .addUserOption(opt => opt.setName('user').setDescription('User to check').setRequired(true)),

  new SlashCommandBuilder()
    .setName('giveitem')
    .setDescription('[Admin] Manually add a shop item to a user\'s inventory and assign role')
    .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
    .addStringOption(opt => opt
      .setName('item')
      .setDescription('Item to give')
      .setRequired(true)
      .addChoices(
        { name: '\u{1F31F} Elevate Gold (role)', value: 'role_gold' },
        { name: '\u{1F4A0} Elevate Platinum (role)', value: 'role_platinum' },
        { name: '\u{1F451} Elevate Elite (role)', value: 'role_elite' },
        { name: '\u{1F331} Rising Star badge', value: 'badge_rising' },
        { name: '\u26A1 Grinder badge', value: 'badge_grinder' },
        { name: '\u{1F31F} Veteran badge', value: 'badge_veteran' },
      )),

].map(cmd => cmd.toJSON());
