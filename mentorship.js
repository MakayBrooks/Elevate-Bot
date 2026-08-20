'use strict';

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');

const { getStore, markDirty } = require('./db');
const { registerTicket, getOrCreateTicketThread } = require('./ticketHub');
const { signHubUrl } = require('./hubAuth');

const THEME_COLOR = 0xF5F0E8;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const EM = '—';
const APOS = '’';

function cfg() {
    const s = getStore();

    if (!s._mentorship) {
        s._mentorship = { applications: {} };
    }

    if (!s._mentorship.applications) {
        s._mentorship.applications = {};
    }

    return s._mentorship;
}

function save() {
    markDirty();
}

// Prevent duplicate channel creation if someone double-clicks
const processingApplications = new Set();

// -- Panel (posted in the mentorship channel) ------------

function buildPanelMessage() {
    const embed = new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setTitle('\u{1F393} Start Your Free Mentorship')
        .setDescription(
            `> Want to learn how to trade the right way ${EM} with real structure, accountability, ` +
            'and a mentor who has actually done it?\n\n' +
            `> Click below to get your own private space with Makay. No forms, no waiting ${EM} you${APOS}re in immediately.\n​`
        )
        .addFields(
            {
                name: '\u{1F680} What you get',
                value: 'A private channel just for you and your mentor, plus access to the Mentorship Hub ' +
                    `(notes, video tracker, and modules that unlock as you tell us more about you) ${EM} no email signup required.`,
                inline: false,
            },
            {
                name: '\u{1F512} Your privacy',
                value: 'Your channel is only visible to you, your mentor, and staff.',
                inline: false,
            }
        )
        .setFooter({
            text: 'Elevate \u{1FABD} • Mentorship',
        });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('mentorship_start_free')
            .setLabel('Start Free Mentorship')
            .setEmoji('\u{1F680}')
            .setStyle(ButtonStyle.Primary)
    );

    return {
        embeds: [embed],
        components: [row],
    };
}

async function postMentorshipPanel(channel) {
    const c = cfg();

    if (c.panelMessageId) {
        try {
            const existing = await channel.messages.fetch(c.panelMessageId);

            if (existing) {
                return existing;
            }
        } catch {
            // Message gone, fall through to fresh post
        }
    }

    const msg = await channel.send(buildPanelMessage());

    await msg.pin().catch(() => {});

    c.panelMessageId = msg.id;
    save();

    return msg;
}

// -- Channel history clear (respects Discord's 14-day bulk-delete limit) ----------

async function clearChannelHistory(channel) {
    let recentDeleted = 0;
    let oldDeleted = 0;
    let failed = 0;

    const cutoff = Date.now() - FOURTEEN_DAYS_MS;

    let keepGoing = true;

    while (keepGoing) {
        const batch = await channel.messages
            .fetch({ limit: 100 })
            .catch(() => null);

        if (!batch || batch.size === 0) {
            keepGoing = false;
            break;
        }

        const recent = batch.filter(
            m => m.createdTimestamp > cutoff
        );

        const old = batch.filter(
            m => m.createdTimestamp <= cutoff
        );

        if (recent.size === 1) {
            try {
                await recent.first().delete();
                recentDeleted++;
            } catch {
                failed++;
            }
        } else if (recent.size > 1) {
            const res = await channel
                .bulkDelete(recent, true)
                .catch(() => null);

            if (res) {
                recentDeleted += res.size;
            } else {
                failed += recent.size;
            }
        }

        for (const [, msg] of old) {
            try {
                await msg.delete();
                oldDeleted++;
            } catch {
                failed++;
            }

            await new Promise(resolve => setTimeout(resolve, 250));
        }

        if (batch.size < 100) {
            keepGoing = false;
        }
    }

    return {
        recentDeleted,
        oldDeleted,
        failed,
    };
}

// -- Welcome message posted into a mentee's private thread ------------

function buildWelcomeEmbed(applicant, mentorUser) {
    return new EmbedBuilder()
        .setColor(0xFFD700)
        .setAuthor({
            name: `${mentorUser.username} is your mentor`,
            iconURL: mentorUser.displayAvatarURL({ extension: 'png' }),
        })
        .setThumbnail(mentorUser.displayAvatarURL({ extension: 'png', size: 256 }))
        .setTitle('\u{1F91D} Welcome to Your Mentorship!')
        .setDescription(
            `Hey ${applicant}, welcome! \u{1F389}\n\n` +
            `This is your private space with **${mentorUser.username}**. Introduce yourself whenever ` +
            `you${APOS}re ready, and we${APOS}ll take it from there.\n\n` +
            `Below is your link to the **Mentorship Hub** ${EM} a short questionnaire unlocks the modules ` +
            'built for where you’re at, plus a place for notes and videos as you learn.'
        )
        .setFooter({ text: 'Elevate \u{1FABD} • Mentorship' })
        .setTimestamp();
}

function buildWelcomeComponents(hubUrl) {
    if (!hubUrl) return [];

    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Open Mentorship Hub')
                .setEmoji('\u{1F393}')
                .setStyle(ButtonStyle.Link)
                .setURL(hubUrl)
        ),
    ];
}

// -- Interaction router ------------------------------------

async function handleMentorshipInteraction(interaction, client) {
    const guild = interaction.guild;

    if (
        interaction.isButton() &&
        interaction.customId === 'mentorship_start_free'
    ) {
        if (processingApplications.has(interaction.user.id)) {
            return true;
        }

        processingApplications.add(interaction.user.id);

        try {
            await interaction.deferReply({ ephemeral: true });

            const mentorId = process.env.MENTOR_USER_ID || guild.ownerId;

            const mentorMember = await guild.members.fetch(mentorId).catch(() => null);

            const mentorUser = mentorMember
                ? mentorMember.user
                : await client.users.fetch(mentorId).catch(() => null);

            if (!mentorUser) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF5555)
                            .setDescription(
                                `❌ Couldn${APOS}t find the mentor account. Please contact an admin ${EM} check the \`MENTOR_USER_ID\` setting.`
                            ),
                    ],
                });

                return true;
            }

            const c = cfg();

            const { thread, reused } = await getOrCreateTicketThread(
                guild,
                interaction.user,
                mentorMember,
                c.applications[interaction.user.id]?.threadId,
                interaction.channel
            );

            c.applications[interaction.user.id] = {
                threadId: thread.id,
                startedAt: c.applications[interaction.user.id]?.startedAt || Date.now(),
            };

            save();

            if (!reused) {
                const hubUrl = signHubUrl(interaction.user.id, interaction.user.username);

                await thread.send({
                    embeds: [buildWelcomeEmbed(interaction.user, mentorUser)],
                    components: buildWelcomeComponents(hubUrl),
                });

                await registerTicket(guild, thread, {
                    type: 'mentorship',
                    applicant: interaction.user,
                }).catch(err =>
                    console.error('[mentorship] registerTicket error:', err)
                );

                // Archive right away so it drops out of the channel's active-threads
                // list for anyone with Manage Threads (i.e. staff) — the mentee can
                // still open it any time via the link above, and posting in it
                // auto-unarchives it. All real ticket tracking (new/unread/idle)
                // happens through the staff hub cards, not this list.
                await thread.setArchived(true).catch(() => {});
            }

            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setDescription(`\u{1F389} You${APOS}re in! Head to ${thread} to meet your mentor.`),
                ],
            });

            return true;
        } catch (err) {
            console.error('[mentorship] START FREE ERROR:', err);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Something went wrong setting up your mentorship space. Please contact an admin.',
                    ephemeral: true,
                }).catch(() => {});
            } else {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF5555)
                            .setDescription('❌ Something went wrong setting up your mentorship space. Please contact an admin.'),
                    ],
                }).catch(() => {});
            }

            return true;
        } finally {
            processingApplications.delete(interaction.user.id);
        }
    }

    return false;
}

module.exports = {
    postMentorshipPanel,
    clearChannelHistory,
    handleMentorshipInteraction,
};
