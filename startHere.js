const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function postStartHerePanel(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.permissions.has('Administrator'))
        return interaction.editReply('Admins only.');
          try {
              const ch = interaction.channel;

                  const welcomeEmbed = new EmbedBuilder().setColor(0xF5F0E8)
                        .setTitle('Welcome to Elevate')
                              .setDescription('> **Elevate is a trading & growth community built for people who take their development seriously.**\n​\nWe combine serious trading education with the things that make you a better trader — mindset, faith, discipline, and accountability.\n​\n**What you will find here:**\n**Trading** — trade recaps, market news, indicators, trading room, journal\n**Education** — resources, videos, networking, mentoring\n**Growth** — mindset, purpose, fitness, faith\n**Gamification** — XP, levels, shop, badges, leaderboard\n​')
                                    .setFooter({ text: 'Elevate — Read each section below' });

                                        const xpEmbed = new EmbedBuilder().setColor(0x5865F2)
                                              .setTitle('XP, Levels & Points')
                                                    .setDescription('> Every action earns **XP** and **points**. XP fills your level bar. Points are spent in the shop.\n​')
                                                          .addFields(
                                                                  { name: 'How to earn XP & points', value: 'Chat — +5 XP/msg (1 min cooldown)\nVoice — +10 XP/min in VC\nTrade Journal — +75 XP per trade\nAchievements — +100-200 XP each\nServer Boost — +500 pts instantly', inline: false },
                                                                          { name: 'Level milestones', value: 'Level 5 / 10 / 20 / 50 / 100 each unlock an exclusive earned badge.', inline: false },
                                                                                  { name: 'Check your rank', value: 'Head to <#' + process.env.LEADERBOARD_CHANNEL_ID + '> and click **Check My Rank**', inline: false }
                                                                                        ).setFooter({ text: 'Elevate — Levels' });

                                                                                            const journalEmbed = new EmbedBuilder().setColor(0x57F287)
                                                                                                  .setTitle('The Trading Journal')
                                                                                                        .setDescription('> **The journal is the core of Elevate trading.** Log trades, track stats, and improve.\n​')
                                                                                                              .addFields(
                                                                                                                      { name: 'What it tracks', value: 'Pair, direction, entry/exit, P&L, notes per trade\nWin rate, total trades, net P&L, average R:R\n+75 XP every time you submit a trade\nWeekly submissions feed the trading leaderboard', inline: false },
                                                                                                                              { name: 'How to use it', value: 'Go to <#' + process.env.JOURNAL_CHANNEL_ID + '> click **Log a Trade** fill in the modal. Use `/journal stats` to see your stats privately.', inline: false }
                                                                                                                                    ).setFooter({ text: 'Elevate — Journal' });
                                                                                                                                    
                                                                                                                                        const rolesEmbed = new EmbedBuilder().setColor(0xFFD700)
                                                                                                                                              .setTitle('Roles & Badges')
                                                                                                                                                    .setDescription('> Roles come from activity and points. Badges show off your progress.\n​')
                                                                                                                                                          .addFields(
                                                                                                                                                                  { name: 'Member Roles — buy in shop', value: 'Elevate Gold — 2,000 pts\nElevate Platinum — 5,000 pts\nElevate Elite — 10,000 pts\nOnly your highest tier shows.', inline: false },
                                                                                                                                                                          { name: 'XP Boost Badges — buy in shop (Slot 2)', value: 'Rising Star 1,000 pts +5% XP\nGrinder 5,000 pts +10% XP\nVeteran 10,000 pts +15% XP', inline: false },
                                                                                                                                                                                  { name: 'Earned Badges — cannot be bought (Slot 1)', value: 'Top 1 / 2 / 3 on leaderboard\nBoost the server\nReach Level 5 / 10 / 20 / 50 / 100', inline: false }
                                                                                                                                                                                        ).setFooter({ text: 'Elevate — Roles & Badges' });
                                                                                                                                                                                        
                                                                                                                                                                                            const row = new ActionRowBuilder().addComponents(
                                                                                                                                                                                                  new ButtonBuilder().setLabel('Check My Rank').setCustomId('levels_check_rank').setStyle(ButtonStyle.Secondary),
                                                                                                                                                                                                        new ButtonBuilder().setLabel('Visit Shop').setURL('https://discord.com/channels/' + guild.id + '/' + process.env.SHOP_CHANNEL_ID).setStyle(ButtonStyle.Link),
                                                                                                                                                                                                              new ButtonBuilder().setLabel('Open Journal').setURL('https://discord.com/channels/' + guild.id + '/' + process.env.JOURNAL_CHANNEL_ID).setStyle(ButtonStyle.Link),
                                                                                                                                                                                                                  );
                                                                                                                                                                                                                  
                                                                                                                                                                                                                      await ch.send({ embeds: [welcomeEmbed] });
                                                                                                                                                                                                                          await ch.send({ embeds: [xpEmbed] });
                                                                                                                                                                                                                              await ch.send({ embeds: [journalEmbed] });
                                                                                                                                                                                                                                  await ch.send({ embeds: [rolesEmbed], components: [row] });
                                                                                                                                                                                                                                      await interaction.editReply('Start here panel posted!');
                                                                                                                                                                                                                                        } catch (err) {
                                                                                                                                                                                                                                            console.error('setup-start-here error:', err);
                                                                                                                                                                                                                                                await interaction.editReply('Error: ' + err.message);
                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                  
                                                                                                                                                                                                                                                  module.exports = { postStartHerePanel };
                                                                                                                                                                                                                                                  
