const { EmbedBuilder } = require('discord.js');

async function postRulesPanel(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.member.permissions.has('Administrator'))
    return interaction.editReply('Admins only.');
  try {
    const ch = interaction.channel;

    const rulesEmbed = new EmbedBuilder().setColor(0x2B2D31)
      .setTitle('READ AND RESPECT THESE RULES:')
      .setDescription(
        '➡️ **1. Be Kind and Respectful**\n' +
        'Treat everyone with kindness. Harassment, bullying, or toxic behavior will not be tolerated.\n\n' +
        '➡️ **2. Be Supportive**\n' +
        'Encourage others. Celebrate progress and results. Be part of a welcoming space.\n\n' +
        '➡️ **3. Use Constructive Criticism**\n' +
        'Offer feedback with the goal to help. Be honest, but never disrespectful.\n\n' +
        '➡️ **4. Help When You Can**\n' +
        'Share knowledge. Your experience could really help someone else.\n\n' +
        '➡️ **5. Keep It Safe and Inclusive**\n' +
        'No hate speech, slurs, discrimination, or NSFW content.\n' +
        'Violations will lead to warnings, mutes, or bans.'
      );

    const descEmbed = new EmbedBuilder().setColor(0x2B2D31)
      .setTitle('SERVER DESCRIPTION:')
      .setDescription(
        'This server is a place to connect with like-minded individuals who want to grow together — whether in trading, mindset, or life in general.\n\n' +
        'Here, you can:\n' +
        '• Share ideas and experiences\n' +
        '• Ask questions and get guidance\n' +
        '• Celebrate wins and progress\n' +
        '• Build meaningful connections\n\n' +
        "Our goal is to create a community that supports personal and professional growth, empowering each other along the journey. Let's learn, grow, an create. Together, we Elevate! 🪽"
      )
      .setFooter({ text: 'Elevate 🪽' });

    await ch.send({ embeds: [rulesEmbed] });
    await ch.send({ embeds: [descEmbed] });
    await interaction.editReply('Rules panel posted!');
  } catch (err) {
    console.error('setup-rules error:', err);
    await interaction.editReply('Error: ' + err.message);
  }
}

module.exports = { postRulesPanel };
