const { SlashCommandBuilder } = require('discord.js');

module.exports = [
  // Journal command with subcommands
  new SlashCommandBuilder()
    .setName('journal')
    .setDescription('Your personal trading journal')
    .addSubcommand(sub =>
      sub.setName('log')
        .setDescription('Log a new trade')
        .addStringOption(opt =>
          opt.setName('pair').setDescription('Asset or pair (e.g. EUR/USD, AAPL)').setRequired(true))
        .addStringOption(opt =>
          opt.setName('direction').setDescription('Long or Short').setRequired(true)
            .addChoices({ name: '📈 Long', value: 'Long' }, { name: '📉 Short', value: 'Short' }))
        .addStringOption(opt =>
          opt.setName('result').setDescription('Win, Loss, or Breakeven').setRequired(true)
            .addChoices(
              { name: '✅ Win', value: 'Win' },
              { name: '❌ Loss', value: 'Loss' },
              { name: '➖ Breakeven', value: 'Breakeven' }
            ))
        .addNumberOption(opt =>
          opt.setName('pnl').setDescription('P&L in $ or pips (e.g. 250 or -80)').setRequired(true))
        .addStringOption(opt =>
          opt.setName('notes').setDescription('Anything to note about this trade').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View your trade history (private)')
    )
    .addSubcommand(sub =>
      sub.setName('stats')
        .setDescription('See your trading stats summary (private)')
    ),

  // Manual calendar trigger (admin use)
  new SlashCommandBuilder()
    .setName('calendar')
    .setDescription('Post this week\'s economic calendar now (admin only)'),
].map(cmd => cmd.toJSON());
