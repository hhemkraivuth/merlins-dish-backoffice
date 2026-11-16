// Counts how often each tracked link opened the order app, from the bot's "Menu Taps" tab (Date, Time, LINE User ID,
// Display Name, Trigger). An open is a row whose Trigger is "order app open" or "order app open (tag)". The bot already
// counts one open per person per 10 minutes, so these are opens, not unique people.
const LABELS = {
  ig: 'Instagram (bio, stories)',
  gnew: 'Grab card, new customers',
  gback: 'Grab card, returning customers',
  rich: 'LINE rich menu',
  web: 'Web, no tag',
  '': 'No tag',
};
const labelOf = (tag) => (LABELS[tag] !== undefined ? LABELS[tag] : /^ad\d*$/.test(tag) ? (tag === 'ad' ? 'Meta ads' : `Meta ads (${tag})`) : tag);

// "16/11/2026" to a day number in days since 1970 (calendar days, no timezone maths needed).
function dayNo(dmy) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dmy || '').trim());
  if (!m) return null;
  return Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000);
}
const todayNo = (now = new Date()) => Math.floor((now.getTime() + 7 * 3600e3) / 86400000);

function summarise(rows, now = new Date()) {
  const today = todayNo(now);
  const by = new Map();
  let first = null;
  for (const r of rows || []) {
    const m = /^order app open(?: \(([^)]*)\))?$/i.exec(String(r[4] || '').trim());
    if (!m) continue;
    const d = dayNo(r[0]);
    if (d === null) continue;
    const tag = (m[1] || '').toLowerCase();
    if (!by.has(tag)) by.set(tag, { tag, label: labelOf(tag), today: 0, d7: 0, d30: 0 });
    const s = by.get(tag);
    const age = today - d;
    if (age === 0) s.today += 1;
    if (age >= 0 && age < 7) s.d7 += 1;
    if (age >= 0 && age < 30) s.d30 += 1;
    if (first === null || d < first) first = d;
  }
  const sources = [...by.values()].filter((s) => s.d30 > 0 || s.d7 > 0).sort((a, b) => b.d7 - a.d7 || b.d30 - a.d30 || a.label.localeCompare(b.label));
  const sum = (k) => sources.reduce((t, s) => t + s[k], 0);
  return { sources, totals: { today: sum('today'), d7: sum('d7'), d30: sum('d30') }, firstDay: first === null ? null : new Date(first * 86400000).toISOString().slice(0, 10) };
}

module.exports = { summarise, labelOf };
