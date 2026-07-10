const { EmbedBuilder } = require('discord.js');
const https = require('https');

// Impact levels to include — orange (medium) and red (high) folders
const INCLUDED_IMPACTS = ['Medium', 'High'];

// US bank holidays (month is 1-based)
const US_BANK_HOLIDAYS_2025 = [
  { month: 1,  day: 1,  name: "New Year's Day" },
  { month: 1,  day: 20, name: "MLK Day" },
  { month: 2,  day: 17, name: "Presidents' Day" },
  { month: 4,  day: 18, name: "Good Friday" },
  { month: 5,  day: 26, name: "Memorial Day" },
  { month: 6,  day: 19, name: "Juneteenth" },
  { month: 7,  day: 4,  name: "Independence Day" },
  { month: 9,  day: 1,  name: "Labor Day" },
  { month: 10, day: 13, name: "Columbus Day" },
  { month: 11, day: 11, name: "Veterans Day" },
  { month: 11, day: 27, name: "Thanksgiving" },
  { month: 12, day: 25, name: "Christmas Day" },
];
const US_BANK_HOLIDAYS_2026 = [
  { month: 1,  day: 1,  name: "New Year's Day" },
  { month: 1,  day: 19, name: "MLK Day" },
  { month: 2,  day: 16, name: "Presidents' Day" },
  { month: 4,  day: 3,  name: "Good Friday" },
  { month: 5,  day: 25, name: "Memorial Day" },
  { month: 6,  day: 19, name: "Juneteenth" },
  { month: 7,  day: 3,  name: "Independence Day (observed)" },
  { month: 9,  day: 7,  name: "Labor Day" },
  { month: 10, day: 12, name: "Columbus Day" },
  { month: 11, day: 11, name: "Veterans Day" },
  { month: 11, day: 26, name: "Thanksgiving" },
  { month: 12, day: 25, name: "Christmas Day" },
];

function getBankHoliday(date) {
  const year = date.getFullYear();
  const list = year === 2026 ? US_BANK_HOLIDAYS_2026 : US_BANK_HOLIDAYS_2025;
  return list.find(h => h.month === date.getMonth() + 1 && h.day === date.getDate()) || null;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

function getWeekDates() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days; // Mon–Fri
}

function isoDate(d) {
  return d.toISOString().split('T')[0];
}

// Format time string — the FF API returns e.g. "8:30am", normalise to "8:30 AM ET"
function fmtTime(raw) {
  if (!raw || raw === 'All Day' || raw === 'Tentative') return raw || 'TBD';
  // Already looks reasonable — just uppercase am/pm and add ET
  return raw.replace(/am$/i, ' AM').replace(/pm$/i, ' PM').replace(/\s+ET$/, '') + ' ET';
}

async function getWeeklyEconomicEvents() {
  try {
    // Primary feed — this-week + next-week to make sure we catch all days
    const [thisWeek, nextWeek] = await Promise.all([
      fetchJSON('https://nfs.faireconomy.media/ff_calendar_thisweek.json'),
      fetchJSON('https://nfs.faireconomy.media/ff_calendar_nextweek.json'),
    ]);
    const combined = [...(Array.isArray(thisWeek) ? thisWeek : []), ...(Array.isArray(nextWeek) ? nextWeek : [])];
    const weekDates = getWeekDates().map(isoDate);

    // Filter: USD + medium or high impact
    const events = combined.filter(e =>
      e.country === 'USD' &&
      INCLUDED_IMPACTS.includes(e.impact) &&
      weekDates.includes((e.date || '').split('T')[0])
    );

    if (events.length > 0) return events;
  } catch (err) {
    console.error('Calendar fetch error:', err);
  }
  return []; // return empty so the per-day loop still shows every day
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
// 📅 number emojis for each day
const DAY_EMOJIS = { Mon: '1️⃣', Tue: '2️⃣', Wed: '3️⃣', Thu: '4️⃣', Fri: '5️⃣' };
// Impact folder emojis (matching Forex Factory colours)
const IMPACT_EMOJI = { High: '🔴', Medium: '🟠' };

async function postWeeklyCalendar(guild, client) {
  try {
    const channel = guild.channels.cache.get(process.env.CALENDAR_CHANNEL_ID);
    if (!channel) return;

    const weekDates = getWeekDates(); // Mon–Fri Date objects
    const events = await getWeeklyEconomicEvents();

    // Group events by ISO date string
    const byDate = {};
    for (const e of events) {
      const key = (e.date || '').split('T')[0];
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(e);
    }
    // Sort events within each day by time (rough sort — AM < PM alphabetically works for hh:mm)
    for (const key of Object.keys(byDate)) {
      byDate[key].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }

    const monday = weekDates[0];
    const friday = weekDates[4];
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const embed = new EmbedBuilder()
      .setColor(0xFF6600)
      .setTitle(`📅 MARKET NEWS | ${fmt(monday)} – ${fmt(friday)}`)
      .setDescription(
        '> 🔴 **Red folder** = High Impact &nbsp;|&nbsp; 🟠 **Orange folder** = Medium Impact\n' +
        '> All times **Eastern (ET)**. Source: Forex Factory.\n\u200b'
      )
      .setFooter({ text: 'Elevate 🪽 • Economic Calendar • Auto-posted Sunday 7 PM ET' })
      .setTimestamp();

    for (let i = 0; i < 5; i++) {
      const date = weekDates[i];
      const label = DAY_LABELS[i];
      const dateKey = isoDate(date);
      const dayDisplay = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      const holiday = getBankHoliday(date);
      const dayEvents = byDate[dateKey] || [];

      let value;
      if (holiday) {
        value = `🏦 **US Bank Holiday — ${holiday.name}**\n*Markets closed*`;
      } else if (!dayEvents.length) {
        value = '*No medium/high-impact USD events*';
      } else {
        value = dayEvents.map(e => {
          const impact = IMPACT_EMOJI[e.impact] || '⚪';
          const time = fmtTime(e.time);
          const forecast = e.forecast && e.forecast !== '' ? ` | Fcst: \`${e.forecast}\`` : '';
          const prev = e.previous && e.previous !== '' ? ` | Prev: \`${e.previous}\`` : '';
          return `${impact} **${e.title}** — ${time}${forecast}${prev}`;
        }).join('\n');
      }

      embed.addFields({
        name: `${DAY_EMOJIS[label]} ${dayDisplay}`,
        value,
        inline: false,
      });
    }

    await channel.send({ content: '@everyone', embeds: [embed] });
    console.log('✅ Weekly calendar posted');
  } catch (err) {
    console.error('❌ Calendar error:', err);
  }
}

module.exports = { postWeeklyCalendar };
