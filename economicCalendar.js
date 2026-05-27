const { EmbedBuilder } = require('discord.js');
const https = require('https');

const HIGH_IMPACT_KEYWORDS = ['Non-Farm','NFP','CPI','PPI','FOMC','Fed','Interest Rate','GDP','Unemployment','Retail Sales','PCE','ISM','PMI','Durable Goods','Housing','Consumer Confidence','Jobless Claims','Trade Balance','Treasury','Inflation','ADP'];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  monday.setHours(0,0,0,0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { monday, friday };
}

function dayLabel(dateStr) {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return days[new Date(dateStr).getDay()];
}

async function getWeeklyEconomicEvents() {
  try {
    const data = await fetchJSON('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
    if (data && Array.isArray(data)) {
      const events = data.filter(e => e.country === 'USD' && e.impact === 'High' && HIGH_IMPACT_KEYWORDS.some(kw => e.title?.toLowerCase().includes(kw.toLowerCase())));
      if (events.length > 0) return events;
    }
  } catch {}

  const { monday } = getWeekRange();
  const fallback = [
    { day: 0, title: 'ISM Manufacturing PMI', time: '10:00am' },
    { day: 2, title: 'ADP Non-Farm Employment', time: '8:15am' },
    { day: 3, title: 'Initial Jobless Claims', time: '8:30am' },
    { day: 4, title: 'Non-Farm Payrolls (NFP)', time: '8:30am' },
  ];
  return fallback.map(e => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + e.day);
    return { title: e.title, date: date.toISOString().split('T')[0], time: e.time, country: 'USD', impact: 'High', forecast: 'TBD', previous: 'TBD' };
  });
}

const DAY_EMOJIS = { Mon: '1️⃣', Tue: '2️⃣', Wed: '3️⃣', Thu: '4️⃣', Fri: '5️⃣' };

async function postWeeklyCalendar(guild, client) {
  try {
    const channel = guild.channels.cache.get(process.env.CALENDAR_CHANNEL_ID);
    if (!channel) return;
    const events = await getWeeklyEconomicEvents();
    const { monday, friday } = getWeekRange();
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const byDay = {};
    for (const e of events) {
      const label = e.date ? dayLabel(e.date) : 'N/A';
      if (!byDay[label]) byDay[label] = [];
      byDay[label].push(e);
    }
    const embed = new EmbedBuilder()
      .setColor(0xF5F0E8)
      .setTitle(`🗓️ HIGH-IMPACT US EVENTS | ${fmt(monday)} – ${fmt(friday)}`)
      .setDescription('> All times **Eastern (ET)**. High-impact events only.\n\u200b')
      .setFooter({ text: 'Elevate 🪽 • Economic Calendar • Auto-posted Sunday 7PM ET' })
      .setTimestamp();
    for (const day of ['Mon','Tue','Wed','Thu','Fri']) {
      if (!byDay[day]) continue;
      const lines = byDay[day].map(e => {
        const time = e.time || 'TBD';
        const forecast = e.forecast && e.forecast !== 'TBD' ? ` | Forecast: \`${e.forecast}\`` : '';
        return `⚡ **${e.title}** — ${time} ET${forecast}`;
      }).join('\n');
      embed.addFields({ name: `${DAY_EMOJIS[day] || '📌'} ${day}`, value: lines, inline: false });
    }
    await channel.send({ embeds: [embed] });
  } catch (err) { console.error('❌ Calendar error:', err); }
}

module.exports = { postWeeklyCalendar };
