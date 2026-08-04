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

// Returns the Mon–Fri of the NEXT upcoming trading week relative to "now".
// If today is Monday, returns today's week; otherwise rolls forward to the next Monday.
// This is what makes a Sunday-night post show the week about to start, not the one that just ended
// (the old version walked backward to last week's Monday when run on a Sunday).
function getWeekDates() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun ... 6 = Sat
  const daysUntilMonday = (8 - day) % 7; // Mon->0, Tue->6, Wed->5, Thu->4, Fri->3, Sat->2, Sun->1
  const monday = new Date(now);
  monday.setDate(now.getDate() + daysUntilMonday);
  monday.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days; // Mon–Fri, always the upcoming/current week
}

function isoDate(d) {
  return d.toISOString().split('T')[0];
}

function fmtTime(raw) {
  if (!raw || raw === 'All Day' || raw === 'Tentative') return raw || 'TBD';
  return raw.replace(/am$/i, ' AM').replace(/pm$/i, ' PM').replace(/\s+ET$/, '') + ' ET';
}

// Proper chronological sort key — fixes string-sorting bug where "10:00am" sorted before "8:30am"
function timeToMinutes(raw) {
  if (!raw || raw === 'All Day') return -1;
  if (raw === 'Tentative') return 9998;
  const m = raw.match(/(\d{1,2}):(\d{2})(am|pm)/i);
  if (!m) return 9999;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3].toLowerCase();
  if (ampm === 'pm' && h !== 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

async function getWeeklyEconomicEvents() {
  try {
    const [thisWeek, nextWeek] = await Promise.all([
      fetchJSON('https://nfs.faireconomy.media/ff_calendar_thisweek.json'),
      fetchJSON('https://nfs.faireconomy.media/ff_calendar_nextweek.json'),
    ]);
    const combined = [...(Array.isArray(thisWeek) ? thisWeek : []), ...(Array.isArray(nextWeek) ? nextWeek : [])];
    const weekDates = getWeekDates().map(isoDate);

    const events = combined.filter(e =>
      e.country === 'USD' &&
      INCLUDED_IMPACTS.includes(e.impact) &&
      weekDates.includes((e.date || '').split('T')[0])
    );

    if (events.length > 0) return events;
  } catch (err) {
    console.error('Calendar fetch error:', err);
  }
  return [];
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const DAY_EMOJIS = { Mon: '1️⃣', Tue: '2️⃣', Wed: '3️⃣', Thu: '4️⃣', Fri: '5️⃣' };
const IMPACT_EMOJI = { High: '🔴', Medium: '🟠' };

async function postWeeklyCalendar(guild, client) {
  try {
    const channel = guild.channels.cache.get(process.env.CALENDAR_CHANNEL_ID);
    if (!channel) return;

    const weekDates = getWeekDates(); // Mon–Fri, upcoming week
    const events = await getWeeklyEconomicEvents();

    const byDate = {};
    for (const e of events) {
      const key = (e.date || '').split('T')[0];
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(e);
    }
    for (const key of Object.keys(byDate)) {
      byDate[key].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
    }

    const monday = weekDates[0];
    const friday = weekDates[4];
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const highCount = events.filter(e => e.impact === 'High').length;
    const medCount = events.filter(e => e.impact === 'Medium').length;
    const holidayCount = weekDates.filter(d => getBankHoliday(d)).length;

    const embed = new EmbedBuilder()
      .setColor(0xF5A623)
      .setAuthor({ name: 'Elevate 🪽 Economic Calendar', iconURL: guild.iconURL({ size: 128 }) || undefined })
      .setTitle(`📅 Week of ${fmt(monday)} – ${fmt(friday)}`)
      .setDescription(
        `> 🔴 **High Impact** • 🟠 **Medium Impact** — all times **ET**\n` +
        `> **${highCount}** high-impact · **${medCount}** medium-impact${holidayCount ? ` · **${holidayCount}** bank holiday${holidayCount > 1 ? 's' : ''}` : ''}\n` +
        `> Source: Forex Factory\n\u200b`
      )
      .setThumbnail(guild.iconURL({ size: 256 }) || null)
      .setFooter({ text: 'Elevate 🪽 • Economic Calendar • Auto-posted every Sunday 8 PM ET' })
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
        value = '*No medium/high-impact USD events scheduled*';
      } else {
        value = dayEvents.map(e => {
          const impact = IMPACT_EMOJI[e.impact] || '⚪';
          const time = fmtTime(e.time);
          const forecast = e.forecast && e.forecast !== '' ? ` \`Fcst: ${e.forecast}\`` : '';
          const prev = e.previous && e.previous !== '' ? ` \`Prev: ${e.previous}\`` : '';
          return `${impact} **${e.title}**\n> 🕐 ${time}${forecast}${prev}`;
        }).join('\n');
      }

      embed.addFields({ name: `${DAY_EMOJIS[label]} ${dayDisplay}`, value, inline: false });
      if (i < 4) embed.addFields({ name: '\u200b', value: '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬', inline: false });
    }

    await channel.send({ content: '@everyone', embeds: [embed] });
    console.log('✅ Weekly calendar posted (upcoming week)');
  } catch (err) {
    console.error('❌ Calendar error:', err);
  }
}

module.exports = { postWeeklyCalendar };
