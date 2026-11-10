// Four owner views for the Analysis page, all worked out from numbers BOH already holds:
//   delivery scorecard      what each channel really leaves you per order
//   weekly break-even       sales needed in a week to cover overheads and ads
//   cash tied up            ingredient stock plus cooked portions sitting unsold, at cost
//   Monday one page         last finished week against the one before, in a few lines

const GRAB_CUT = 0.32;   // same estimate the break-even card uses
const r0 = (n) => Math.round(n);
const money = (n) => `฿${r0(n).toLocaleString('en-AU')}`;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

// ledger rows: { type, channel, orderFrom, orderNo, net, qty, date }. Net is the price after discounts, before Grab's cut.
function deliveryScorecard(ledger) {
  const ch = { grab: { name: 'Grab', orders: new Set(), sales: 0, rider: 0 }, line: { name: 'LINE', orders: new Set(), sales: 0, rider: 0 }, ig: { name: 'Instagram', orders: new Set(), sales: 0, rider: 0 } };
  const of = (r) => (r.channel === 'Grab' ? 'grab' : /^(ig|instagram)$/i.test(r.orderFrom) ? 'ig' : 'line');
  for (const r of ledger) {
    const c = ch[of(r)];
    if (r.type === 'Order') { c.sales += r.net || 0; c.orders.add(`${r.dmy}|${r.orderNo}`); }
    else if (r.type === 'Rider') c.rider += Math.abs(r.net || 0);
  }
  return Object.values(ch).filter((c) => c.orders.size).map((c, i) => {
    const grab = c.name === 'Grab';
    const keep = grab ? c.sales * (1 - GRAB_CUT) : c.sales - c.rider;
    const n = c.orders.size;
    return { channel: c.name, orders: n, sales: r0(c.sales), avgOrder: r0(c.sales / n), costs: r0(grab ? c.sales * GRAB_CUT : c.rider), keep: r0(keep), keepPct: pct(keep, c.sales), keepPerOrder: r0(keep / n), basis: grab ? `Grab cut estimated at ${Math.round(GRAB_CUT * 100)}%` : 'rider fees logged' };
  });
}

// weeks: shaped weeks from buildAnalysis (revenue, foodCost, margin, ads, overheads, orders, gross, inProgress, fromMaster)
function weeklyBreakEven(weeks) {
  const done = weeks.filter((w) => !w.inProgress && !w.fromMaster && !w.startsBeforeOct && w.revenue > 0).slice(-4);
  if (!done.length) return null;
  const sum = (k) => done.reduce((a, w) => a + w[k], 0);
  const revenue = sum('revenue');
  const contribution = revenue - sum('foodCost');
  const fixed = (sum('ads') + sum('overheads')) / done.length;
  const cmPct = contribution / revenue;
  if (!(cmPct > 0)) return { weeksUsed: done.length, fixed: r0(fixed), cmPct: Math.round(cmPct * 1000) / 10, breakEvenRevenue: null, breakEvenOrders: null, avgRevenue: r0(revenue / done.length) };
  const beRevenue = fixed / cmPct;
  const revPerOrder = revenue / sum('orders');
  const now = weeks.filter((w) => w.inProgress && !w.fromMaster).slice(-1)[0] || null;
  return { weeksUsed: done.length, fixed: r0(fixed), cmPct: Math.round(cmPct * 1000) / 10, breakEvenRevenue: r0(beRevenue), breakEvenOrders: Math.ceil(beRevenue / revPerOrder), avgRevenue: r0(revenue / done.length), avgOrders: r0(sum('orders') / done.length), thisWeek: now ? { label: now.label, revenue: now.revenue, pct: Math.round((now.revenue / beRevenue) * 100) } : null };
}

// lotBook: { names(), lotsFor(name) } ; sitting: dishes.sitting ; costOf: Map dish -> latest cost per portion
function cashTiedUp(lotBook, sitting = [], creep = []) {
  const items = [];
  if (lotBook) {
    for (const n of lotBook.names()) {
      const v = lotBook.lotsFor(n).reduce((a, l) => a + (l.remaining > 1e-6 ? l.remaining * l.unitCost : 0), 0);
      if (v > 0.5) items.push({ name: n, value: r0(v) });
    }
  }
  items.sort((a, b) => b.value - a.value);
  const ingredients = items.reduce((a, i) => a + i.value, 0);
  const cost = new Map(creep.map((c) => [c.dish, c.latest]));
  const cooked = sitting.filter((s) => s.remaining > 0 && cost.get(s.dish)).map((s) => ({ dish: s.dish, portions: s.remaining, value: r0(s.remaining * cost.get(s.dish)), old: s.old }));
  const cookedValue = cooked.reduce((a, c) => a + c.value, 0);
  return { ingredients, cookedValue, total: ingredients + cookedValue, top: items.slice(0, 6), cooked };
}

// Plain lines for the Monday page. Everything comes from the other three views and the weekly numbers.
function mondayPage({ weeks, delivery, breakEven, cash, dishes }) {
  const done = weeks.filter((w) => !w.inProgress && !w.fromMaster && !w.startsBeforeOct);
  const last = done[done.length - 1]; const prev = done[done.length - 2];
  if (!last) return null;
  const chg = (a, b) => (b > 0 ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : 'n/a');
  const lines = [];
  lines.push(`Week ${last.label}: gross ${money(last.gross)}${prev ? ` (${chg(last.gross, prev.gross)} on the week before)` : ''}, margin ${money(last.margin)}${prev ? ` (${chg(last.margin, prev.margin)})` : ''}, ${last.orders} orders.`);
  if (prev && last.grabOrders === 0 && prev.grabOrders > 0) lines.unshift('Check first: no Grab orders are loaded for this week, so the comparison below is not real. Import the latest Grab CSV.');
  const direct = last.lineOnlyOrders + last.igOrders;
  lines.push(`Direct orders ${direct} of ${last.orders} (${pct(direct, last.orders) ?? 0}%)${last.repeatPct !== null ? `, repeat customers ${last.repeatPct}%` : ''}.`);
  if (breakEven && breakEven.breakEvenRevenue) lines.push(`Break-even is about ${money(breakEven.breakEvenRevenue)} of sales a week (${breakEven.breakEvenOrders} orders). Last week sold ${money(last.revenue)}, ${last.revenue >= breakEven.breakEvenRevenue ? 'above' : 'below'} it.`);
  const keepBest = delivery.length ? delivery.reduce((a, b) => (b.keepPerOrder > a.keepPerOrder ? b : a)) : null;
  if (keepBest) lines.push(`Best take-home per order: ${keepBest.channel} at ${money(keepBest.keepPerOrder)}.`);
  const eng = (dishes && dishes.engineering) || [];
  if (eng.length) lines.push(`Top earner: ${eng[0].dish} (${money(eng[0].totalProfit)} profit).${eng.filter((e) => e.box === 'Dog').length ? ` Dogs to review: ${eng.filter((e) => e.box === 'Dog').map((e) => e.dish).join(', ')}.` : ''}`);
  const old = (dishes && dishes.sitting || []).filter((s) => s.old);
  if (old.length) lines.push(`Flash sale: ${old.map((s) => `${s.dish} (${s.remaining} left, ${s.oldestAgeDays} days)`).join(', ')}.`);
  const waste = ((dishes && dishes.sitting) || []).reduce((a, s) => a + (s.wasteCost || 0), 0);
  if (waste > 0) lines.push(`Waste logged: ${money(waste)}.`);
  if (cash && cash.total > 0) lines.push(`Cash tied up in stock: ${money(cash.total)} (${money(cash.ingredients)} ingredients, ${money(cash.cookedValue)} cooked and unsold).`);
  return lines;
}

module.exports = { deliveryScorecard, weeklyBreakEven, cashTiedUp, mondayPage };
