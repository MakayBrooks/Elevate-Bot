'use strict';

const crypto = require('crypto');

const HUB_BASE_URL = process.env.HUB_BASE_URL || 'https://mentorship-hub-production.up.railway.app';
const LINK_TTL_SECONDS = 60 * 60; // 1 hour — plenty to click a link in your own ticket

// Builds a one-time, HMAC-signed link into the Mentorship Hub for a given
// Discord user. HUB_AUTH_SECRET must match the same var on the website —
// this is what lets the site trust "this really is this Discord user"
// without any email/password step.
function signHubUrl(discordId, username) {
    const secret = process.env.HUB_AUTH_SECRET;
    if (!secret) return null;

    const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
    const sig = crypto.createHmac('sha256', secret).update(`${discordId}.${exp}`).digest('hex');

    const params = new URLSearchParams({
        uid: discordId,
        username: username || 'there',
        exp: String(exp),
        sig,
    });

    return `${HUB_BASE_URL}/api/auth/discord?${params.toString()}`;
}

module.exports = { signHubUrl };
