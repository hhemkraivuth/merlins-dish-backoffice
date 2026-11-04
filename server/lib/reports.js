// Weekly and monthly numbers, sell-through, and price moves. Pure functions over plain data.
//
// How cost is counted (it follows accounting-rules, so nothing is counted twice):
//   Batch dishes   cost lands on the COOK date, from the Cook Log. Orders never carry a cost for them.
//   Pasta, Bacon Steak, drinks   cost is the Recipe row on a Grab order. LINE orders have no Recipe rows,
//                  so their cost is ESTIMATED from the most recent Grab Recipe cost for the same item.
//   Ingredient purchases are shown as a memo line only. They are never added to cost (that would count food twice).
//   Advertising and fixed overheads are not in the system yet, so "margin" here is before ads and overheads.

const { formatDMY, daysBetween } = require('./dates');
const { normName, batchDishOf, pastaOf, NOT_A_PORTION, PASTAS } = require('./dishes');

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---- periods ------------------------------------------------------------------------------
// Dates are midnight UTC, so plain millisecond arithmetic is exact (and safe across month and year ends).
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
function weekStart(d) {
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(d, -dow);
}

function periodOf(date, type) {
  if (type === 'month') {
    const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    return { key: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}`, label: `${String(from.getUTCMonth() + 1).padStart(2, '0')}/${from.getUTCFullYear()}`, from, to };
  }
  const from = weekStart(date);
  const to = addDays(from, 6);
  return { key: from.toISOString().slice(0, 10), label: `${formatDMY(from)} to ${formatDMY(to)}`, from, to };
}

// ---- LINE cost estimate ---------------------------------------------------------------------
// Cost table: the Recipe rows already in the ledger (Grab), newest first per item.
function buildCostTable(ledger) {
  const table = new Map();
  for (const r of ledger) {
    if (r.type !== 'Recipe' || r.cost === null || r.cost <= 0) continue;
    const k = normName(r.desc);
    if (!table.has(k)) table.set(k, []);
    table.get(k).push({ t: r.date.getTime(), cost: r.cost });
  }
  for (const list of table.values()) list.sort((a, b) => a.t - b.t);
  return table;
}
function lookupCost(table, name, date) {
  const list = table.get(normName(name));
  if (!list || !list.length) return null;
  let best = null;
  for (const e of list) if (e.t <= date.getTime()) best = e;
  return (best || list[0]).cost;
}

// Cost of one LINE Order row, or { cost: 0 } when the item carries none, or { missing: true }.
function lineItemCost(row, table) {
  const qty = row.qty || 0;
  const dish = batchDishOf(row.desc);
  if (dish) {
    // The bot writes the pasta choice in brackets: "Noir Ragu + Pasta (Radiatori)" or "Red Wine Beef Stew (Tubetti)".
    const groups = [...row.desc.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
    const pasta = groups.find((g) => PASTAS.includes(g.toLowerCase()));
    if (!pasta) return { cost: 0 };
    const c = lookupCost(table, pasta, row.date);
    return c === null ? { cost: 0, missing: `${pasta} (pasta)` } : { cost: c * qty };
  }
  if (NOT_A_PORTION.test(row.desc)) return { cost: 0 };
  const pasta = pastaOf(row.desc);
  const c = lookupCost(table, pasta || row.desc, row.date);
  return c === null ? { cost: 0, missing: row.desc } : { cost: c * qty };
}

// ---- weekly / monthly ----------------------------------------------------------------------
// ledger: objects from ledgerObjects().  cookBatches: [{ key, date, dish, portions, cost }].  purchases: [{ date, amount }]
function summarise(ledger, cookBatches, purchases, type = 'week') {
  const table = buildCostTable(ledger);
  const periods = new Map();
  const get = (date) => {
    const p = periodOf(date, type);
    if (!periods.has(p.key)) {
      periods.set(p.key, {
        key: p.key, label: p.label, from: p.from, to: p.to,
        grab: { orders: new Set(), gross: 0, discount: 0, commission: 0, marketing: 0, otherFees: 0, recipeCost: 0 },
        line: { orders: new Set(), gross: 0, discount: 0, delivery: 0, rider: 0, estCost: 0, missing: new Map() },
        cook: { batches: 0, portions: 0, cost: 0 },
        purchases: 0, flags: new Set(),
      });
    }
    return periods.get(p.key);
  };

  for (const r of ledger) {
    const p = get(r.date);
    const net = r.net ?? 0;
    if (r.flags) p.flags.add(`${r.channel} ${r.dmy}: ${r.flags}`);
    if (r.channel === 'Grab') {
      if (r.type === 'Order') { p.grab.gross += net; if (r.orderNo) p.grab.orders.add(`${r.dmy}|${r.orderNo}`); }
      else if (r.type === 'Recipe') p.grab.recipeCost += Math.abs(net);
      else if (r.type === 'Grab') {
        const amt = Math.abs(net);
        if (/discount/i.test(r.desc)) p.grab.discount += amt;
        else if (/commission/i.test(r.desc)) p.grab.commission += amt;
        else if (/marketing/i.test(r.desc)) p.grab.marketing += amt;
        else p.grab.otherFees += amt;
      }
    } else if (r.channel === 'LINE') {
      if (r.type === 'Order') {
        p.line.gross += net;
        if (r.orderNo) p.line.orders.add(`${r.dmy}|${r.orderNo}`);
        const c = lineItemCost(r, table);
        p.line.estCost += c.cost;
        if (c.missing) p.line.missing.set(c.missing, (p.line.missing.get(c.missing) || 0) + (r.qty || 1));
      } else if (r.type === 'Discount') p.line.discount += Math.abs(net);
      else if (r.type === 'Delivery') p.line.delivery += net;
      else if (r.type === 'Rider') p.line.rider += Math.abs(net);
    }
  }
  for (const b of cookBatches) {
    const p = get(b.date);
    p.cook.batches += 1; p.cook.portions += b.portions || 0; p.cook.cost += b.cost || 0;
  }
  for (const x of purchases) get(x.date).purchases += x.amount || 0;

  return [...periods.values()].sort((a, b) => a.from - b.from).map((p) => {
    const grabNet = p.grab.gross - p.grab.discount - p.grab.commission - p.grab.marketing - p.grab.otherFees;
    const lineNet = p.line.gross - p.line.discount;
    const revenue = grabNet + lineNet + p.line.delivery;           // delivery the customer paid is income
    const recipe = p.grab.recipeCost + p.line.estCost;
    const foodCost = recipe + p.cook.cost;
    const margin = revenue - foodCost - p.line.rider;               // the rider fee you actually paid is a cost
    const gross = p.grab.gross + p.line.gross;
    return {
      key: p.key, label: p.label, from: p.from, to: p.to,
      grab: { orders: p.grab.orders.size, gross: r2(p.grab.gross), discount: r2(p.grab.discount), commission: r2(p.grab.commission), marketing: r2(p.grab.marketing), otherFees: r2(p.grab.otherFees), net: r2(grabNet) },
      line: { orders: p.line.orders.size, gross: r2(p.line.gross), discount: r2(p.line.discount), net: r2(lineNet), delivery: r2(p.line.delivery), rider: r2(p.line.rider) },
      revenue: r2(revenue),
      recipeCost: r2(p.grab.recipeCost), lineEstCost: r2(p.line.estCost), cookCost: r2(p.cook.cost), cookBatches: p.cook.batches, cookPortions: p.cook.portions,
      foodCost: r2(foodCost), margin: r2(margin), marginPct: gross > 0 ? r2((margin / gross) * 100) : null,
      purchases: r2(p.purchases),
      missingCosts: [...p.line.missing].map(([n, q]) => `${n} x${q}`),
      flags: [...p.flags],
    };
  });
}

const REPORT_HEADERS = [
  'Period', 'From', 'To', 'Grab orders', 'Grab gross', 'Grab discounts', 'Grab commission', 'Grab marketing fee', 'Grab net',
  'LINE orders', 'LINE gross', 'LINE discounts', 'LINE net', 'LINE delivery charged', 'Net income (all channels)',
  'Recipe costs (Grab)', 'Recipe costs (LINE, estimated)', 'Batch cook costs', 'Total food cost', 'Rider fees paid',
  'Margin before ads and overheads', 'Margin % of gross sales', 'Ingredient purchases (memo, not in cost)', 'Checks',
];
function reportRows(periods) {
  return periods.map((p) => [
    p.label, formatDMY(p.from), formatDMY(p.to), p.grab.orders, p.grab.gross, p.grab.discount, p.grab.commission, p.grab.marketing, p.grab.net,
    p.line.orders, p.line.gross, p.line.discount, p.line.net, p.line.delivery, p.revenue,
    p.recipeCost, p.lineEstCost, p.cookCost, p.foodCost, p.line.rider, p.margin, p.marginPct === null ? '' : p.marginPct, p.purchases,
    [p.missingCosts.length ? `No cost found for: ${p.missingCosts.slice(0, 5).join(', ')}` : '', p.flags.length ? `${p.flags.length} flagged rows` : ''].filter(Boolean).join(' | '),
  ]);
}

// ---- sell-through (first in, first out) ------------------------------------------------------
// Cooked portions per batch come off the Cook Log. Sold portions are Order rows for that dish on either channel.
// Sales before a dish's first logged batch are ignored (the cook notes only start on a date).
function sellThrough(ledger, cookBatches, today) {
  const dishes = new Map();
  const dish = (name) => {
    if (!dishes.has(name)) dishes.set(name, { dish: name, events: [], cooked: 0, sold: 0, oversold: 0, batches: [] });
    return dishes.get(name);
  };
  for (const b of cookBatches) {
    if (!b.portions) continue;
    const d = dish(b.dish);
    d.events.push({ t: b.date.getTime(), order: 0, batch: { key: b.key, date: b.date, portions: b.portions, remaining: b.portions } });
  }
  const soldByDay = new Map();
  for (const r of ledger) {
    if (r.type !== 'Order') continue;
    const name = batchDishOf(r.desc);
    if (!name || !r.qty) continue;
    const k = `${name}|${r.date.getTime()}`;
    soldByDay.set(k, (soldByDay.get(k) || 0) + r.qty);
  }
  for (const [k, qty] of soldByDay) {
    const [name, t] = [k.slice(0, k.lastIndexOf('|')), Number(k.slice(k.lastIndexOf('|') + 1))];
    if (dishes.has(name)) dishes.get(name).events.push({ t, order: 1, sold: qty });
  }

  const out = [];
  for (const d of dishes.values()) {
    const firstCook = Math.min(...d.events.filter((e) => e.batch).map((e) => e.t));
    d.events.sort((a, b) => a.t - b.t || a.order - b.order);
    for (const e of d.events) {
      if (e.batch) { d.batches.push(e.batch); d.cooked += e.batch.portions; continue; }
      if (e.t < firstCook) continue;
      let need = e.sold;
      d.sold += e.sold;
      for (const b of d.batches) {
        if (!need) break;
        const take = Math.min(b.remaining, need);
        b.remaining -= take; need -= take;
      }
      d.oversold += need;
    }
    const live = d.batches.filter((b) => b.remaining > 0).map((b) => ({ ...b, ageDays: today ? daysBetween(today, b.date) : 0 }));
    const latest = d.batches[d.batches.length - 1];
    out.push({
      dish: d.dish, cooked: d.cooked, sold: d.sold, oversold: d.oversold,
      remaining: live.reduce((s, b) => s + b.remaining, 0), live,
      latestBatch: latest ? { key: latest.key, date: latest.date } : null,
      oldestAgeDays: live.length ? Math.max(...live.map((b) => b.ageDays)) : 0,
    });
  }
  return out.sort((a, b) => a.dish.localeCompare(b.dish));
}

// ---- rider fees ------------------------------------------------------------------------------
// LINE orders from a finished day (within the last 14) that have no rider fee yet. Nothing is flagged until the first rider
// fee has been logged, and only orders from that first day onwards, so the old history does not flood the inbox.
function riderGaps(ledger, today) {
  const riders = ledger.filter((r) => r.channel === 'LINE' && r.type === 'Rider');
  if (!riders.length) return [];
  const start = Math.min(...riders.map((r) => r.date.getTime()));
  const have = new Set(riders.map((r) => `${r.dmy}|${r.orderNo}`));
  const gaps = new Map();
  for (const r of ledger) {
    if (r.channel !== 'LINE' || r.type !== 'Order' || !r.orderNo.startsWith('#')) continue;
    const t = r.date.getTime();
    if (t < start || t >= today.getTime() || daysBetween(today, r.date) > 14) continue;
    const k = `${r.dmy}|${r.orderNo}`;
    if (!have.has(k) && !gaps.has(k)) gaps.set(k, { dmy: r.dmy, orderNo: r.orderNo, customer: r.customer });
  }
  return [...gaps.values()];
}

// ---- purchasing: price moves -----------------------------------------------------------------
// expenseRows: [{ date, name, unitCost }]  (unitCost = cost per recipe unit). Compares the two newest purchases of each item.
function priceMoves(expenseRows, threshold = 0.1) {
  const by = new Map();
  for (const e of expenseRows) {
    if (!e.name || !(e.unitCost > 0)) continue;
    const k = normName(e.name);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(e);
  }
  const moves = [];
  for (const list of by.values()) {
    list.sort((a, b) => a.date - b.date);
    if (list.length < 2) continue;
    const prev = list[list.length - 2];
    const last = list[list.length - 1];
    const change = (last.unitCost - prev.unitCost) / prev.unitCost;
    if (Math.abs(change) >= threshold) moves.push({ name: last.name, date: last.date, change, from: prev.unitCost, to: last.unitCost });
  }
  return moves;
}

module.exports = { periodOf, weekStart, addDays, summarise, reportRows, REPORT_HEADERS, sellThrough, priceMoves, riderGaps, buildCostTable, lookupCost, lineItemCost, r2 };
