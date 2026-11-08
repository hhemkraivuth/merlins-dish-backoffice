// Monthly overheads: things that cost the same every month (Railway 5 USD, a freezer instalment). Each one is kept as
// typed, in dollars or in baht, and is logged to the Overheads tab on the 1st of every month. Dollars stay dollars: the baht
// for each month is that day's conversion, written in the Remarks next to the dollar amount.
// The list lives in App State (key recurring_overheads). Each item remembers the last month it was logged, so a restart or a
// missed day never double logs, and a missed 1st is caught up on the next run.
const { parseDate, formatDMY, utc } = require('./dates');
const { toBaht } = require('./usdRate');

const KEY = 'recurring_overheads';
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

const parse = (text) => { try { const v = JSON.parse(text || '[]'); return Array.isArray(v) ? v : []; } catch (err) { return []; } };

// item: { name, category, shop, usd | thb }, from: the date it was first logged (that month is already done).
function addItem(list, item, from) {
  const usd = Number(item.usd) > 0 ? round2(item.usd) : null;
  const thb = usd ? null : Number(item.thb) > 0 ? round2(item.thb) : null;
  if (!norm(item.name) || (!usd && !thb)) return { list, error: 'An item needs a name and an amount.' };
  const rest = list.filter((x) => norm(x.name) !== norm(item.name));
  const id = `m${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const entry = { id, name: String(item.name).trim(), category: String(item.category || '').trim(), shop: String(item.shop || '').trim(), usd, thb, last: monthKey(from) };
  return { list: [...rest, entry], entry };
}
const stopItem = (list, id) => list.filter((x) => x.id !== id);

// The 1st of the month of `today`.
const firstOf = (today) => utc(today.getUTCFullYear(), today.getUTCMonth() + 1, 1);
const dueItems = (list, today) => list.filter((x) => String(x.last || '') < monthKey(today));

// Logs every due item once. deps: { appendOverheads(rows), getRate(), save(list) }. Returns { logged, skipped }.
async function runDue(list, today, deps) {
  const due = dueItems(list, today);
  const logged = []; let skipped = [];
  if (!due.length) return { list, logged, skipped };
  let rateInfo = null;
  if (due.some((x) => x.usd)) {
    rateInfo = await deps.getRate();
    if (!rateInfo) { skipped = due.filter((x) => x.usd).map((x) => x.name); }
  }
  let current = list;
  for (const it of due) {
    let price = it.thb; let remark = 'Monthly repeat';
    if (it.usd) {
      if (!rateInfo) continue;
      price = toBaht(it.usd, rateInfo.rate);
      remark = `Monthly repeat; USD ${Number(it.usd).toFixed(2)} at ${rateInfo.rate}`;
    }
    await deps.appendOverheads([[formatDMY(firstOf(today)), it.name, it.category, price, it.shop, remark]]);
    current = current.map((x) => (x.id === it.id ? { ...x, last: monthKey(today) } : x));
    await deps.save(current); // saved after each row, so a crash never logs the same item twice
    logged.push({ name: it.name, price, usd: it.usd || null });
  }
  return { list: current, logged, skipped };
}

const describe = (x) => (x.usd ? `USD ${x.usd.toFixed(2)}` : `${x.thb} thb`);

module.exports = { KEY, parse, addItem, stopItem, dueItems, runDue, monthKey, describe, firstOf };
