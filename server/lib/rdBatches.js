// R&D batches: test cooks for new recipes or tweaks. Logged with an rd word before the dish (see noteParser).
// They live in their own "R&D Log" tab, so the Cook Log, sellable stock, sell-through and food cost never see them.
// The cost shows on its own R&D line in the reports and comes off the margin after overheads and ads.

const { parseDate } = require('./dates');

const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };

// Rows from the R&D Log (header first) to [{ key, date, dish, portions, cost }].
function rdFrom(rows) {
  const out = [];
  for (const r of (rows || []).slice(1)) {
    const date = parseDate(r[1]);
    if (!date || !r[0]) continue;
    out.push({ key: String(r[0]), date, dish: String(r[2] || '').trim(), portions: num(r[3]), cost: num(r[7]) });
  }
  return out;
}

// The same rows as report items, so the weekly and monthly numbers can total them (kind 'rd'; portions ride along).
function rdPurchases(rows) {
  return rdFrom(rows).map((b) => ({ date: b.date, name: `R&D ${b.dish}`, amount: b.cost, kind: 'rd', portions: b.portions }));
}

module.exports = { rdFrom, rdPurchases };
