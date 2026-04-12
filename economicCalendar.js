const { EmbedBuilder } = require('discord.js');
const https = require('https');

/**
 * High-impact US economic events lookup by week.
 * Uses Forex Factory's JSON calendar API to pull the current week's events.
 * Falls back to a curated list of recurring events if fetch fails.
 */

const HIGH_IMPACT_KEYWORDS = [
  'Non-Farm', 'NFP', 'CPI', 'PPI', 'FOMC', 'Fed', 'Interest Rate',
  'GDP', 'Unemployment', 'Retail Sales', 'PCE', 'ISM', 'PMI',
  'Durable Goods', 'Housing', 'Consumer Confidence', 'Jobless Claims',
  'Trade Balance', 'Treasury', 'Inflation', 'ADP'
];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 0);
  return { monday, friday };
}

function dayLabel(dateStr) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = new Date(dateStr);
  return days[d.getDay()];
}

async function getWeeklyEconomicEvents() {
  try {
    // Forex Factory calendar API
    const url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
    const data = await fetchJSON(url);

    if (data && Array.isArray(data)) {
      const events = data.filter(e =>
        e.country === 'USD' &&
        e.impact === 'High' &&
        HIGH_IMPACT_KEYWORDS.some(kw =>
          e.title?.toLowerCase().includes(kw.toLowerCase())
        )
      );

      if (events.length > 0) return events;
    }
  } catch (err) {
    console.warn('⚠️  Could not fetch live calendar, using fallback.', err.message);
  }

  // ── Fallback: generic recurring US high-impact events ──────────────────────
  const { monday } = getWeekRange();
  const fallback = [
    { day: 0, title: 'ISM Manufacturing PMI', time: '10:00am' },
    { day: 1, title: 'JOLTS Job Openings', time: '10:00am' },
    { day: 2, title: 'ADP Non-Farm Employment', time: '8:15am' },
    { day: 2, title: 'FOMC Meeting Minutes', time: '2:00pm' },
    { day: 3, title: 'Initial Jobless Claims', time: '8:30am' },
    { day: 3, title: 'CPI (Consumer Price Index)', time: '8:30am' },
    { day: 4, title: 'Non-Farm Payrolls (NFP)', time: '8:30am' },
    { day: 4, title: 'Unemployment Rate', time: '8:30am' },
  ];

  return fallback.map(e => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + e.day);
    return {
      title: e.title,
      date: date.toISOString().split('T')[0],
      time: e.time,
      country: 'USD',
      impact: 'High',
      forecast: 'TBD',
      previous: 'TBD',
    };
  });
}

const DAY_EMOJIS = { Mon: '1️⃣', Tue: '2️⃣', Wed: '3️⃣', Thu: '4️⃣', Fri: '5️⃣' };

async function postWeeklyCalendar(guild, client) {
  try {
    const channel = guild.channels.cache.get(process.env.CALENDAR_CHANNEL_ID);
    if (!channel) return console.warn('⚠️  CALENDAR_CHANNEL_ID not set in .env');

    const events = await getWeeklyEconomicEvents();
    const { monday, friday } = getWeekRange();

    const formatDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const weekLabel = `${formatDate(monday)} – ${formatDate(friday)}`;

    // Group events by day
    const byDay = {};
    for (const e of events) {
      const label = e.date ? dayLabel(e.date) : 'N/A';
      if (!byDay[label]) byDay[label] = [];
      byDay[label].push(e);
    }

    const embed = new EmbedBuilder()
      .setColor(0xF5F0E8)
      .setTitle(`🗓️  HIGH-IMPACT US EVENTS  |  ${weekLabel}`)
      .setDescription(
        '> All times **Eastern (ET)**. High-impact events only. Trade with caution around these windows.\n\u200b'
      )
      .setFooter({ text: 'Elevate 🪽 • Economic Calendar • Auto-posted Sunday 7PM ET' })
      .setTimestamp();

    const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    for (const day of dayOrder) {
      if (!byDay[day]) continue;
      const lines = byDay[day].map(e => {
        const time = e.time || e.date?.split('T')[1]?.slice(0, 5) || 'TBD';
        const forecast = e.forecast && e.forecast !== 'TBD' ? ` | Forecast: \`${e.forecast}\`` : '';
        const prev = e.previous && e.previous !== 'TBD' ? ` | Prev: \`${e.previous}\`` : '';
        return `⚡ **${e.title}** — ${time} ET${forecast}${prev}`;
      }).join('\n');

      embed.addFields({
        name: `${DAY_EMOJIS[day] || '📌'} ${day}`,
        value: lines || 'No high-impact events',
        inline: false,
      });
    }

    if (events.length === 0) {
      embed.addFields({ name: '✅ Clear Week', value: 'No major US economic events this week.', inline: false });
    }

    await channel.send({ embeds: [embed] });
    console.log(`✅ Weekly calendar posted to #${channel.name}`);
  } catch (err) {
    console.error('❌ Calendar post error:', err);
  }
}

module.exports = { getWeeklyEconomicEvents, postWeeklyCalendar };
