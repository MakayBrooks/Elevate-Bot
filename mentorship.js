'use strict';

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
} = require('discord.js');

const { getStore, markDirty } = require('./db');
const { registerTicket, getOrCreateTicketThread } = require('./ticketHub');

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

// In-memory state for the multi-select application form
const applicationState = new Map();

// Prevent duplicate channel creation if someone double-clicks
const processingApplications = new Set();

// -- Questions ------------------------------------

const QUESTIONS = [
    {
        key: 'experience',
        customId: 'mentorship_q_experience',
        label: 'How long have you been trading?',
        emoji: '\u{1F4C8}',
        options: [
            {
                label: 'Never traded before',
                value: 'never',
                emoji: '\u{1F331}',
            },
            {
                label: 'Less than 6 months',
                value: 'lt6mo',
                emoji: '\u{1F538}',
            },
            {
                label: `6 months ${EM} 1 year`,
                value: '6mo-1yr',
                emoji: '\u{1F539}',
            },
            {
                label: `1 ${EM} 3 years`,
                value: '1-3yr',
                emoji: '\u{1F537}',
            },
            {
                label: '3+ years',
                value: '3yr+',
                emoji: '\u{1F538}',
            },
        ],
    },

    {
        key: 'reason',
        customId: 'mentorship_q_reason',
        label: 'Why do you want to trade?',
        emoji: '\u{1F3AF}',
        options: [
            {
                label: 'Build financial freedom',
                value: 'freedom',
                emoji: '\u{1F4B0}',
            },
            {
                label: 'Extra / second income',
                value: 'income',
                emoji: '\u{1F4B5}',
            },
            {
                label: 'Passion for the markets',
                value: 'passion',
                emoji: '\u{1F525}',
            },
            {
                label: 'Looking for a career change',
                value: 'career',
                emoji: '\u{1F4BC}',
            },
            {
                label: 'Other',
                value: 'other',
                emoji: '✨',
            },
        ],
    },

    {
        key: 'hours',
        customId: 'mentorship_q_hours',
        label: 'How many hours a day can you commit?',
        emoji: '⏱️',
        options: [
            {
                label: 'Less than 1 hour',
                value: 'lt1',
                emoji: '\u{1F550}',
            },
            {
                label: `1 ${EM} 2 hours`,
                value: '1-2',
                emoji: '\u{1F551}',
            },
            {
                label: `2 ${EM} 4 hours`,
                value: '2-4',
                emoji: '\u{1F552}',
            },
            {
                label: '4+ hours',
                value: '4+',
                emoji: '\u{1F525}',
            },
        ],
    },

    {
        key: 'market',
        customId: 'mentorship_q_market',
        label: 'What market interests you most?',
        emoji: '\u{1F4B9}',
        options: [
            {
                label: 'Forex',
                value: 'forex',
                emoji: '\u{1F4B1}',
            },
            {
                label: 'Futures (NQ/ES)',
                value: 'futures',
                emoji: '\u{1F4C8}',
            },
            {
                label: 'Stocks',
                value: 'stocks',
                emoji: '\u{1F3E2}',
            },
            {
                label: 'Crypto',
                value: 'crypto',
                emoji: '\u{1FA99}',
            },
            {
                label: 'Not sure yet',
                value: 'unsure',
                emoji: '❓',
            },
        ],
    },
];

function labelFor(qKey, value) {
    const q = QUESTIONS.find(x => x.key === qKey);
    const opt = q?.options.find(o => o.value === value);

    return opt
        ? `${opt.emoji} ${opt.label}`
        : '*not selected*';
}

// -- Panel (posted in the mentorship channel) ------------

function buildPanelMessage() {
    const embed = new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setTitle('\u{1F393} Apply for 1-on-1 Mentorship')
        .setDescription(
            `> Want to learn how to trade the right way ${EM} with real structure, accountability, ` +
            'and a mentor who has actually done it?\n\n' +
            `> This short application helps Makay understand exactly where you${APOS}re at, so your ` +
            `mentorship fits **you** ${EM} not a generic template.\n​`
        )
        .addFields(
            {
                name: '\u{1F4DD} How it works',
                value: `Answer a few quick multiple-choice questions (under a minute) ${EM} confirm you${APOS}re ready ${EM} get matched into a private space with Makay.`,
                inline: false,
            },
            {
                name: '\u{1F512} Your privacy',
                value: 'Your answers are private and are only shared with your mentor/admin team.',
                inline: false,
            },
            {
                name: '\u{1F680} What you get',
                value: 'Direct 1-on-1 access, a private channel just for you and your mentor, and a starting point built around your experience level.',
                inline: false,
            }
        )
        .setFooter({
            text: 'Elevate \u{1FABD} • Mentorship Application',
        });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('mentorship_start_application')
            .setLabel('Start Application')
            .setEmoji('\u{1F4DD}')
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

// -- Step 1: question form message ------------------------

function buildFormMessage(state = {}) {
    const lines = QUESTIONS.map(q =>
        state[q.key]
            ? `✅ **${q.label}** ${EM} ${labelFor(q.key, state[q.key])}`
            : `⚪ **${q.label}** ${EM} *not selected*`
    );

    const embed = new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setTitle('\u{1F393} Mentorship Application')
        .setDescription(
            'Answer each question below, then click **Submit Application**.\n​'
        )
        .addFields({
            name: 'Your answers',
            value: lines.join('\n'),
            inline: false,
        })
        .setFooter({
            text: 'Elevate \u{1FABD} • Only you can see this',
        });

    const rows = QUESTIONS.map(q =>
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(q.customId)
                .setPlaceholder(
                    state[q.key]
                        ? `${q.emoji} ${labelFor(q.key, state[q.key])}`
                        : `${q.emoji} ${q.label}`
                )
                .addOptions(
                    q.options.map(o => ({
                        label: o.label,
                        value: o.value,
                        emoji: o.emoji,
                    }))
                )
        )
    );

    const allAnswered = QUESTIONS.every(
        q => state[q.key]
    );

    const submitRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('mentorship_form_submit')
            .setLabel('Submit Application')
            .setEmoji('✅')
            .setStyle(
                allAnswered
                    ? ButtonStyle.Primary
                    : ButtonStyle.Secondary
            )
            .setDisabled(!allAnswered)
    );

    return {
        embeds: [embed],
        components: [...rows, submitRow],
    };
}

// -- Step 2: confirmation message ------------------------

function buildConfirmMessage(state) {
    const lines = QUESTIONS.map(
        q =>
            `${q.emoji} **${q.label}** ${EM} ${labelFor(
                q.key,
                state[q.key]
            )}`
    );

    const embed = new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setTitle('\u{1F4CB} Review Your Application')
        .setDescription(
            lines.join('\n') +
            '\n\n**Are you ready to start learning?**\n​'
        )
        .setFooter({
            text: 'Elevate \u{1FABD} • Only you can see this',
        });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('mentorship_confirm_yes')
            .setLabel(`Yes, I${APOS}m Ready`)
            .setEmoji('\u{1F680}')
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId('mentorship_confirm_no')
            .setLabel('Not Right Now')
            .setEmoji('⌛')
            .setStyle(ButtonStyle.Secondary)
    );

    return {
        embeds: [embed],
        components: [row],
    };
}

function buildWelcomeEmbed(
    applicant,
    mentorUser
) {
    return new EmbedBuilder()
        .setColor(0xFFD700)
        .setAuthor({
            name: `${mentorUser.username} is your mentor`,
            iconURL: mentorUser.displayAvatarURL({
                extension: 'png',
            }),
        })
        .setThumbnail(
            mentorUser.displayAvatarURL({
                extension: 'png',
                size: 256,
            })
        )
        .setTitle(
            '\u{1F91D} Welcome to Your Mentorship!'
        )
        .setDescription(
            `Hey ${applicant}, welcome! \u{1F389}\n\n` +
            `This is your private space with **${mentorUser.username}**. Your application has been reviewed ${EM} ` +
            `now it${APOS}s time to actually get to work.\n\n` +
            `Introduce yourself whenever you${APOS}re ready, and we${APOS}ll take it from there. Glad to have you here.`
        )
        .setFooter({
            text: 'Elevate \u{1FABD} • Mentorship',
        })
        .setTimestamp();
}

function buildMentorNotifyEmbed(
    applicant,
    state,
    channel
) {
    const lines = QUESTIONS.map(q => ({
        name: `${q.emoji} ${q.label}`,
        value: labelFor(
            q.key,
            state[q.key]
        ),
        inline: true,
    }));

    return new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setAuthor({
            name: applicant.tag,
            iconURL: applicant.displayAvatarURL({
                extension: 'png',
            }),
        })
        .setTitle(
            '\u{1F4CB} New Mentorship Application'
        )
        .addFields(
            ...lines,
            {
                name: '\u{1F4AC} Their Channel',
                value: `<#${channel.id}>`,
                inline: false,
            }
        )
        .setFooter({
            text: 'Elevate \u{1FABD} • Visible only to you',
        })
        .setTimestamp();
}

// -- Interaction router ------------------------------------

async function handleMentorshipInteraction(
    interaction,
    client
) {
    const guild = interaction.guild;

    // Start Application
    if (
        interaction.isButton() &&
        interaction.customId ===
            'mentorship_start_application'
    ) {
        try {
            applicationState.set(
                interaction.user.id,
                {}
            );

            // Use ephemeral: true instead of MessageFlags.Ephemeral
            // for maximum compatibility with discord.js versions.
            await interaction.reply({
                ...buildFormMessage({}),
                ephemeral: true,
            });

            return true;
        } catch (err) {
            console.error(
                '[mentorship] START APPLICATION ERROR:',
                err
            );

            // If the interaction hasn't been acknowledged,
            // attempt to send the user an error.
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content:
                        '❌ Something went wrong opening the application. Please try again.',
                    ephemeral: true,
                }).catch(() => {});
            }

            return true;
        }
    }

    // Question selects
    const q = QUESTIONS.find(
        x => x.customId === interaction.customId
    );

    if (
        interaction.isStringSelectMenu() &&
        q
    ) {
        try {
            await interaction.deferUpdate();

            const state =
                applicationState.get(
                    interaction.user.id
                ) || {};

            state[q.key] =
                interaction.values[0];

            applicationState.set(
                interaction.user.id,
                state
            );

            await interaction.editReply(
                buildFormMessage(state)
            );

            return true;
        } catch (err) {
            console.error(
                '[mentorship] QUESTION ERROR:',
                err
            );

            return true;
        }
    }

    // Submit -> confirmation step
    if (
        interaction.isButton() &&
        interaction.customId ===
            'mentorship_form_submit'
    ) {
        try {
            await interaction.deferUpdate();

            const state =
                applicationState.get(
                    interaction.user.id
                ) || {};

            // Server-side validation
            const allAnswered =
                QUESTIONS.every(
                    q => state[q.key]
                );

            if (!allAnswered) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF5555)
                            .setDescription(
                                '❌ Please answer every question before submitting.'
                            ),
                    ],
                    components: [],
                });

                return true;
            }

            await interaction.editReply(
                buildConfirmMessage(state)
            );

            return true;
        } catch (err) {
            console.error(
                '[mentorship] SUBMIT ERROR:',
                err
            );

            return true;
        }
    }

    // Not ready
    if (
        interaction.isButton() &&
        interaction.customId ===
            'mentorship_confirm_no'
    ) {
        try {
            applicationState.delete(
                interaction.user.id
            );

            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor(THEME_COLOR)
                        .setDescription(
                            `No worries ${EM} come back and click **Start Application** whenever you${APOS}re ready. \u{1FABD}`
                        ),
                ],
                components: [],
            });

            return true;
        } catch (err) {
            console.error(
                '[mentorship] CONFIRM NO ERROR:',
                err
            );

            return true;
        }
    }

    // Ready -> create mentor channel + notify mentor
    if (
        interaction.isButton() &&
        interaction.customId ===
            'mentorship_confirm_yes'
    ) {
        if (
            processingApplications.has(
                interaction.user.id
            )
        ) {
            return true;
        }

        processingApplications.add(
            interaction.user.id
        );

        try {
            await interaction.deferUpdate();

            const state =
                applicationState.get(
                    interaction.user.id
                ) || {};

            // Server-side validation again
            const allAnswered =
                QUESTIONS.every(
                    q => state[q.key]
                );

            if (!allAnswered) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF5555)
                            .setDescription(
                                '❌ Your application is incomplete. Please start the application again.'
                            ),
                    ],
                    components: [],
                });

                applicationState.delete(
                    interaction.user.id
                );

                return true;
            }

            applicationState.delete(
                interaction.user.id
            );

            const mentorId =
                process.env.MENTOR_USER_ID ||
                guild.ownerId;

            const mentorMember =
                await guild.members
                    .fetch(mentorId)
                    .catch(() => null);

            const mentorUser =
                mentorMember
                    ? mentorMember.user
                    : await client.users
                          .fetch(mentorId)
                          .catch(() => null);

            if (!mentorUser) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF5555)
                            .setDescription(
                                `❌ Couldn${APOS}t find the mentor account. Please contact an admin ${EM} check the \`MENTOR_USER_ID\` setting.`
                            ),
                    ],
                    components: [],
                });

                return true;
            }

            const c = cfg();

            const {
                thread,
                reused,
            } =
                await getOrCreateTicketThread(
                    guild,
                    interaction.user,
                    mentorMember,
                    c.applications[interaction.user.id]?.threadId
                );

            c.applications[
                interaction.user.id
            ] = {
                answers: state,
                threadId: thread.id,
                completedAt: Date.now(),
            };

            save();

            if (!reused) {
                await thread.send({
                    embeds: [
                        buildWelcomeEmbed(
                            interaction.user,
                            mentorUser
                        ),
                    ],
                });
            }

            // Register with the admin ticket hub
            const answersText =
                QUESTIONS.map(
                    q =>
                        `**${q.label}** ${EM} ${labelFor(
                            q.key,
                            state[q.key]
                        )}`
                ).join('\n');

            if (!reused) {
                await registerTicket(
                    guild,
                    thread,
                    {
                        type: 'mentorship',
                        applicant:
                            interaction.user,
                        answersText,
                    }
                ).catch(err =>
                    console.error(
                        '[mentorship] registerTicket error:',
                        err
                    )
                );
            }

            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setDescription(
                            `\u{1F389} You${APOS}re in! Head to ${thread} to meet your mentor.`
                        ),
                ],
                components: [],
            });

            return true;
        } catch (err) {
            console.error(
                '[mentorship] CONFIRM YES ERROR:',
                err
            );

            await interaction
                .editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF5555)
                            .setDescription(
                                '❌ Something went wrong setting up your mentorship space. Please contact an admin.'
                            ),
                    ],
                    components: [],
                })
                .catch(() => {});

            return true;
        } finally {
            processingApplications.delete(
                interaction.user.id
            );
        }
    }

    return false;
}

module.exports = {
    postMentorshipPanel,
    clearChannelHistory,
    handleMentorshipInteraction,
};
