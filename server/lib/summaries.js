// The two summaries shown above the Weekly Receipts box and the Batch Cook box.
// Pure functions over the raw tab rows. Week runs Monday to Sunday (as on the Numbers page), month is the calendar month.
// Both periods show the whole week or month, so days that have not happened yet simply have nothing in them.

const { formatDMY, parseDate } = require('./dates');
const { periodOf } = require('./reports');
const { isAds } = require('./overheads');
const { num } = require('./ledger');

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const NO_SHOP = 'No shop named';

function periodsFor(today) {
  const wk = periodOf(today, 'week');
  const mo = periodOf(today, 'month');
  const mk = (label, p) => ({ label, from: p.from, to: p.to, range: `${formatDMY(p.from)} to ${formatDMY(p.to)}` });
  return [mk('This week', wk), mk('This month', mo)];
}
const within = (date, p) => date.getTime() >= p.from.getTime() && date.getTime() <= p.to.getTime();

// expenseRows: Expense Log (header first): Date | Ingredient | Purchase Price | Purchase Unit | Cost per Recipe Unit | Shopped at | Remarks
// overheadRows: Overheads tab (header first): Date | Item | Category | Price | Shopped at | Remarks
function buildSpend({ today, expenseRows = [], overheadRows = [] }) {
  const lines = [];
  expenseRows.forEach((r, i) => {
    if (i === 0 && /date/i.test(String(r[0] || ''))) return;
    const date = parseDate(r[0]); const amount = num(r[2]);
    if (!date || !Number.isFinite(amount)) return;
    lines.push({ date, kind: 'ingredients', amount, shop: String(r[5] || '').trim() || NO_SHOP });
  });
  overheadRows.forEach((r, i) => {
    if (i === 0 && /date/i.test(String(r[0] || ''))) return;
    const date = parseDate(r[0]); const amount = num(r[3]);
    if (!date || !Number.isFinite(amount)) return;
    lines.push(isAds(r[2]) ? { date, kind: 'ads', amount, shop: '' } : { date, kind: 'overheads', amount, shop: String(r[4] || '').trim() || NO_SHOP });
  });
  const periods = periodsFor(today).map((p) => {
    const mine = lines.filter((l) => within(l.date, p));
    const sum = (kind) => r2(mine.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0));
    const shops = new Map();
    for (const l of mine) if (l.kind !== 'ads') shops.set(l.shop, (shops.get(l.shop) || 0) + l.amount);
    const ingredients = sum('ingredients'); const overheads = sum('overheads'); const ads = sum('ads');
    return {
      label: p.label, range: p.range,
      total: r2(ingredients + overheads + ads), ingredients, overheads, ads,
      lines: mine.length,
      byShop: [...shops].map(([shop, amount]) => ({ shop, amount: r2(amount) })).sort((a, b) => b.amount - a.amount),
    };
  });
  return { today: formatDMY(today), periods };
}

// batches: [{ key, date, dish, portions, cost }] (see cookBatchesFrom in ledgerService)
function buildCooking({ today, batches = [] }) {
  const periods = periodsFor(today).map((p) => {
    const mine = batches.filter((b) => within(b.date, p));
    const dishes = new Map();
    for (const b of mine) {
      const d = dishes.get(b.dish) || { dish: b.dish, batches: 0, portions: 0, cost: 0 };
      d.batches += 1; d.portions += b.portions || 0; d.cost += b.cost || 0;
      dishes.set(b.dish, d);
    }
    const portions = mine.reduce((s, b) => s + (b.portions || 0), 0);
    const cost = mine.reduce((s, b) => s + (b.cost || 0), 0);
    return {
      label: p.label, range: p.range,
      batches: mine.length, portions, cost: r2(cost), perPortion: portions ? r2(cost / portions) : null,
      byDish: [...dishes.values()].map((d) => ({ ...d, cost: r2(d.cost), perPortion: d.portions ? r2(d.cost / d.portions) : null })).sort((a, b) => b.portions - a.portions),
      lowYield: mine.filter((b) => b.portions > 0 && b.portions <= 3).map((b) => ({ dish: b.dish, date: formatDMY(b.date), portions: b.portions })),
    };
  });
  return { today: formatDMY(today), periods };
}

module.exports = { buildSpend, buildCooking, NO_SHOP };
