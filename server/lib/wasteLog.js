// Waste log: portions thrown away, burnt, dropped or given away. Typed in the LINE group or the Batch Cook page:
//
//   waste bolo 2 burnt              (date defaults to today)
//   waste 8/11 ragu 1 dropped
//
// Each row is costed at the cost per portion of the latest batch of that dish cooked on or before the date, written to the
// "Waste Log" tab, and taken off the dish's remaining stock (first in first out) on the Analysis page.

const { parseDate, formatDMY, bangkokNow } = require('./dates');
const { BATCH_DISHES } = require('./dishes');

const TAB = 'Waste Log';
const HEADERS = ['Date', 'Dish', 'Portions', 'Reason', 'Cost per Portion', 'Cost', 'Logged At'];
const DATE_ONLY = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/;
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const baht = (n) => `฿${Math.round(n).toLocaleString('en-AU')}`;

// Rows from the sheet (header first) to [{ date, dish, portions, reason, cost }].
function wasteFrom(rows) {
  return (rows || []).slice(1).map((r) => ({ date: parseDate(r[0]), dish: String(r[1] || '').trim(), portions: num(r[2]), reason: String(r[3] || '').trim(), cost: num(r[5]) }))
    .filter((w) => w.date && w.dish && w.portions > 0);
}

function costPerPortion(batches, dish, date) {
  const list = batches.filter((b) => b.dish === dish && b.portions > 0 && b.cost > 0 && b.date.getTime() <= date.getTime()).sort((a, b) => a.date - b.date);
  const b = list[list.length - 1];
  return b ? b.cost / b.portions : null;
}

// deps: { loadShorthand(), loadCookBatches(), ensureTab(name, headers), appendRows(tab, rows) }. Returns replies, or null if not a waste command.
async function processWaste(text, today, deps) {
  const raw = String(text || '').trim();
  if (!/^waste\b/i.test(raw)) return null;
  const usage = 'To log waste, send for example:\nwaste bolo 2 burnt\nwaste 8/11 ragu 1 dropped';
  const words = raw.replace(/^waste\b[\s:]*/i, '').split(/\s+/).filter(Boolean);
  let date = today;
  if (words.length && DATE_ONLY.test(words[0])) {
    date = parseDate(words.shift(), today);
    if (!date) return ['That date does not look valid. Nothing was logged.'];
  }
  const qi = words.findIndex((w, i) => i > 0 && /^\d+(?:\.\d+)?$/.test(w));
  if (qi < 1) return [usage];
  const key = words.slice(0, qi).join('').toLowerCase();
  const portions = Number(words[qi]);
  const reason = words.slice(qi + 1).join(' ') || 'wasted';
  if (!(portions > 0)) return [usage];

  const sh = await deps.loadShorthand();
  let dish = sh.dishes.get(key);
  if (!dish) { const hit = BATCH_DISHES.find(([n]) => n.toLowerCase().replace(/\s+/g, '') === key); dish = hit && hit[0]; }
  if (!dish) return [`I don't know the dish "${words.slice(0, qi).join(' ')}". Use a shorthand like bolo, ragu, tuscan, rws, dbs, chix or brocs. Nothing was logged.`];

  const batches = await deps.loadCookBatches();
  const per = costPerPortion(batches, dish, date);
  const cost = per === null ? 0 : per * portions;
  await deps.ensureTab(TAB, HEADERS);
  await deps.appendRows(TAB, [[formatDMY(date), dish, portions, reason, per === null ? '' : Math.round(per * 100) / 100, Math.round(cost * 100) / 100, bangkokNow()]]);
  return [per === null
    ? `Logged ${portions} ${dish} (${reason}) on ${formatDMY(date)}. No batch cost found on or before that date, so it is recorded at ฿0.`
    : `Logged ${portions} ${dish} (${reason}) on ${formatDMY(date)}, cost ${baht(cost)} at ${baht(per)} a portion. Taken off remaining stock.`];
}

module.exports = { processWaste, wasteFrom, TAB, HEADERS };
