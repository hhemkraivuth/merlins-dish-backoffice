// Counts how often each tracked link opened the order app, from the bot's "Menu Taps" tab (Date, Time, LINE User ID,
// Display Name, Trigger). An open is a row whose Trigger is "order app open" or "order app open (tag)". The bot already
// counts one open per person per 10 minutes, so these are opens, not unique people.
const LABELS = {
  ig: 'Instagram',
  gnew: 'Grab card, new',
  gback: 'Grab card, returning',
  rich: 'LINE rich menu',
  web: 'Web, no tag',
  '': 'No tag',
};
// The new and returning customer cards are one family, so they always sit next to each other (new first).
const groupOf = (tag) => (tag === 'gnew' || tag === 'gback' ? 'grab' : tag);
const labelOf = (tag) => (LABELS[tag] !== undefined ? LABELS[tag] : /^ad\d*$/.test(tag) ? (tag === 'ad' ? 'Meta ads' : `Meta ads (${tag})`) : tag);

// "16/11/2026" to a day number in days since 1970 (calendar days, no timezone maths needed).
function dayNo(dmy) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dmy || '').trim());
  if (!m) return null;
  return Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000);
}
const todayNo = (now = new Date()) => Math.floor((now.getTime() + 7 * 3600e3) / 86400000);

// Orders come from the Orders tab: Type is column E, the link tag is column N (written by the order app from 16/11/2026).
// Only days from the first tagged order onwards count, so older untracked orders do not show up as "No tag".
function summarise(rows, now = new Date(), orderRows = []) {
  const today = todayNo(now);
  const by = new Map();
  const get = (tag) => {
    if (!by.has(tag)) by.set(tag, { tag, label: labelOf(tag), today: 0, d7: 0, d30: 0, o7: 0, o30: 0 });
    return by.get(tag);
  };
  let first = null;
  for (const r of rows || []) {
    const m = /^order app open(?: \(([^)]*)\))?$/i.exec(String(r[4] || '').trim());
    if (!m) continue;
    const d = dayNo(r[0]);
    if (d === null) continue;
    const s = get((m[1] || '').toLowerCase());
    const age = today - d;
    if (age === 0) s.today += 1;
    if (age >= 0 && age < 7) s.d7 += 1;
    if (age >= 0 && age < 30) s.d30 += 1;
    if (first === null || d < first) first = d;
  }
  const orders = (orderRows || []).filter((r) => String(r[4] || '').trim().toLowerCase() === 'order');
  const tracked = orders.map((r) => dayNo(r[0])).filter((d, i) => d !== null && String(orders[i][13] || '').trim());
  const trackedFrom = tracked.length ? Math.min(...tracked) : null;
  let orderTotals = { o7: 0, o30: 0 };
  for (const r of orders) {
    const d = dayNo(r[0]);
    if (d === null || trackedFrom === null || d < trackedFrom) continue;
    const s = get(String(r[13] || '').trim().toLowerCase());
    const age = today - d;
    if (age >= 0 && age < 7) s.o7 += 1;
    if (age >= 0 && age < 30) s.o30 += 1;
  }
  const kept = [...by.values()].filter((s) => s.d30 > 0 || s.d7 > 0 || s.o30 > 0);
  const fam = new Map();
  kept.forEach((s) => { const g = fam.get(groupOf(s.tag)) || { d7: 0, d30: 0 }; g.d7 += s.d7; g.d30 += s.d30; fam.set(groupOf(s.tag), g); });
  const sources = kept.sort((a, b) => {
    const ga = fam.get(groupOf(a.tag)); const gb = fam.get(groupOf(b.tag));
    return gb.d7 - ga.d7 || gb.d30 - ga.d30 || groupOf(a.tag).localeCompare(groupOf(b.tag)) || (a.tag === 'gnew' ? -1 : b.tag === 'gnew' ? 1 : 0) || a.label.localeCompare(b.label);
  });
  sources.forEach((s) => { s.rate30 = s.d30 > 0 ? Math.round((s.o30 / s.d30) * 100) : null; });
  const sum = (k) => sources.reduce((t, s) => t + s[k], 0);
  orderTotals = { o7: sum('o7'), o30: sum('o30') };
  return {
    sources,
    totals: { today: sum('today'), d7: sum('d7'), d30: sum('d30'), ...orderTotals, rate30: sum('d30') > 0 ? Math.round((orderTotals.o30 / sum('d30')) * 100) : null },
    ordersTrackedFrom: trackedFrom === null ? null : new Date(trackedFrom * 86400000).toISOString().slice(0, 10),
    firstDay: first === null ? null : new Date(first * 86400000).toISOString().slice(0, 10),
  };
}

module.exports = { summarise, labelOf };
