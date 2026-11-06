// Monthly shopping plan: what to buy, when, so there are fewer trips.
//
// 1. Demand. Portions sold per batch dish per month, from the Master Log (August), Sheet1 (September) and the Ledger (October on).
//    The plan uses the normal completed months (slow months such as October are left out), plus a small buffer.
// 2. Usage. Grams of each ingredient (and pieces of packaging) per portion, from the real batches in Cook Log + Cook Log Lines.
// 3. Need per ingredient per month = demand x usage per portion.
// 4. Stock now is estimated from the receipts (Price Log + Expense Log) minus the usual daily use.
// 5. Fresh items (onion, celery, carrot, mushroom, milk by default) are bought in short runs, every 10 days by default,
//    and never kept beyond 14 days. Everything else is bought in one bulk trip that covers the month.
//    A "Shelf Life" tab (Ingredient | Days) overrides this per ingredient.
//
// Pure functions only. The sheet reading lives in shoppingService.js.

const { parseDate, formatDMY, utc } = require('./dates');
const { normName, parsePurchaseUnit, toNumber, UNIT_FACTORS } = require('./priceBook');
const { batchDishOf, BATCH_DISHES } = require('./dishes');
const { cookItems, monthKey } = require('./logViews');

const FIRST_MONTH = '2026-08';        // the Master Log is trusted from here
const SLOW_MONTHS = ['2026-10'];      // bridge and public holidays: left out of the normal volume
const BUFFER = 0.10;                  // so a busy week does not force an extra trip
const FRESH_COVER = 10;               // days: 1.5 weeks
const FRESH_MAX = 14;                 // days: never keep fresh produce longer than 2 weeks
const BULK_COVER = 30;                // days a bulk trip should cover
const RUN_EARLY = 2;                  // buy this many days before the first item runs out
const HISTORY_DAYS = 60;              // how far back receipts count towards "what is in the fridge now"
const DAY = 86400000;

const FRESH_WORDS = ['onion', 'celery', 'carrot', 'mushroom', 'milk'];
const NOT_FRESH = /powder|cube|soup|dried|condensed|evaporated|stock|crispy|fried|pickled|canned|coconut|uht|cream|paste|sauce|flakes/i;

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / DAY);
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthName = (key) => `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`;
const dayText = (d) => `${WEEKDAY[d.getUTCDay()]} ${formatDMY(d).slice(0, 5)}`;
const titleCase = (s) => String(s || '').trim().replace(/^./, (c) => c.toUpperCase());
const numOf = (v) => { const n = toNumber(v); return n === null ? null : n; };

function toBase(qty, unit) {
  const f = UNIT_FACTORS[String(unit || '').trim().toLowerCase()];
  return f ? { qty: qty * f[1], unit: f[0] } : { qty, unit: String(unit || '').trim().toLowerCase() || 'piece' };
}
function fmtQty(qty, unit) {
  if (unit === 'g') return qty >= 1000 ? `${r1(qty / 1000)} kg` : `${Math.round(qty)} g`;
  if (unit === 'ml') return qty >= 1000 ? `${r1(qty / 1000)} l` : `${Math.round(qty)} ml`;
  return `${Math.round(qty * 10) / 10} ${unit === 'piece' ? 'pcs' : unit}`;
}

// ---- demand ------------------------------------------------------------------------------------------

// Master Log / Sheet1 / Ledger rows share the first columns: Date | Description | Branch or Channel | Order from | Type | QTY | Money In | Cost | Net | Customer | Order No
// carryDate: the Master Log merges the date across a day, so a blank date means "same day as above".
function salesFromRows(rows = [], { from, to, carryDate = false } = {}) {
  const out = [];
  let last = null;
  rows.forEach((r, i) => {
    if (!r || (i === 0 && /date/i.test(String(r[0] || '')))) return;
    let date = parseDate(r[0]);
    if (date) last = date; else if (carryDate && String(r[0] ?? '').trim() === '' && String(r[1] || '').trim()) date = last;
    if (!date || (from && date < from) || (to && date >= to)) return;
    if (String(r[4] || '').trim().toLowerCase() !== 'order') return;
    const dish = batchDishOf(r[1]);
    const qty = numOf(r[5]);
    if (!dish || !qty || qty <= 0) return;
    out.push({ date, dish, qty, key: `${formatDMY(date)}|${String(r[10] || '').trim()}|${normName(r[1])}|${qty}|${numOf(r[6]) ?? ''}` });
  });
  return out;
}

// One list of sales across the three places they live, never counting a row twice:
//   before 01/09/2026 the Master Log, September the Ledger and Sheet1 together, from 01/10/2026 the Ledger.
function combineSales({ master = [], sheet1 = [], ledger = [] }) {
  const sep = utc(2026, 9, 1); const oct = utc(2026, 10, 1);
  const out = [
    ...salesFromRows(master, { to: sep, carryDate: true }),
    ...salesFromRows(ledger, { from: sep }),
  ];
  const seen = new Set(out.filter((s) => s.date < oct).map((s) => s.key));
  for (const s of salesFromRows(sheet1, { from: sep, to: oct })) if (!seen.has(s.key)) { seen.add(s.key); out.push(s); }
  return out;
}

function monthsOf(today) {
  // completed months from FIRST_MONTH, e.g. on 06/11/2026: 2026-08, 2026-09, 2026-10
  const out = [];
  let y = Number(FIRST_MONTH.slice(0, 4)); let m = Number(FIRST_MONTH.slice(5));
  const cur = monthKey(today);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (k >= cur) break;
    out.push(k);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function demandOf(sales, today) {
  const completed = monthsOf(today);
  let normal = completed.filter((k) => !SLOW_MONTHS.includes(k));
  if (!normal.length) normal = completed;
  normal = normal.slice(-3);
  const by = new Map(); // dish -> month -> portions
  for (const s of sales) {
    const k = monthKey(s.date);
    if (!completed.includes(k)) continue;
    if (!by.has(s.dish)) by.set(s.dish, new Map());
    by.get(s.dish).set(k, (by.get(s.dish).get(k) || 0) + s.qty);
  }
  const dishes = BATCH_DISHES.map(([dish]) => {
    const months = by.get(dish) || new Map();
    const inBase = normal.filter((k) => (months.get(k) || 0) > 0);
    let perMonth = 0; let basis = 'none';
    if (inBase.length) { perMonth = inBase.reduce((s, k) => s + months.get(k), 0) / inBase.length; basis = `average of ${inBase.map(monthName).join(' and ')}`; }
    else {
      const any = completed.filter((k) => (months.get(k) || 0) > 0).slice(-1)[0];
      if (any) { perMonth = months.get(any); basis = `${monthName(any)} only`; }
    }
    return { dish, perMonth: Math.round(perMonth), basis, months: Object.fromEntries(completed.map((k) => [k, months.get(k) || 0])) };
  });
  return { dishes, completed, normal };
}

// ---- usage per portion -------------------------------------------------------------------------------

function usageOf(cookLogRows, sizeRows, lineRows) {
  const batches = new Map(cookItems(cookLogRows, sizeRows).map((b) => [b.key, b]));
  const perDish = new Map(); // dish -> { portions, lines: Map(groupKey -> { name, kind, unit, qty }) }
  const counted = new Set();
  let batchCount = 0; let firstDate = null;
  for (const r of (lineRows || []).slice(1)) {
    const b = batches.get(String(r[0]));
    if (!b || !(b.portions > 0)) continue;
    const kind = String(r[3] || '').trim();
    if (kind !== 'Ingredient' && kind !== 'Packaging') continue;
    const qty = numOf(r[5]);
    const name = String(r[4] || '').trim();
    if (!name || !qty || qty <= 0) continue;
    const dish = batchDishOf(b.dish) || b.dish;
    if (!perDish.has(dish)) perDish.set(dish, { portions: 0, lines: new Map() });
    const d = perDish.get(dish);
    if (!counted.has(b.key)) { counted.add(b.key); d.portions += b.portions; batchCount += 1; if (!firstDate || b.date < firstDate) firstDate = b.date; }
    const base = toBase(qty, r[6]);
    const gk = `${normName(name)}|${base.unit}`;
    const line = d.lines.get(gk) || { name, kind, unit: base.unit, qty: 0 };
    line.qty += base.qty; d.lines.set(gk, line);
  }
  return { perDish, batchCount, firstDate };
}

// ---- purchases ---------------------------------------------------------------------------------------

// Price Log and Expense Log rows: Date | Ingredient | Price | Purchase Unit | Cost per Recipe Unit | Shopped at | Remarks
function purchasesOf(priceLogRows = [], expenseRows = [], today) {
  const map = new Map();
  const tripDays = new Set(); // every distinct shopping date (ingredients only)
  const add = (rows, inherit) => {
    let last = null;
    rows.forEach((r, i) => {
      if (!r || (i === 0 && /date/i.test(String(r[0] || '')))) return;
      let date = parseDate(r[0], today);
      if (date) last = date; else if (inherit && String(r[0] ?? '').trim() === '') date = last;
      const key = normName(r[1]);
      if (!date || !key) return;
      tripDays.add(formatDMY(date));
      const price = numOf(r[2]);
      const pu = parsePurchaseUnit(r[3]);
      let cost = price !== null && pu && pu.qty > 0 ? price / pu.qty : numOf(r[4]);
      if (cost !== null && !(cost > 0)) cost = null;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ date, name: String(r[1]).trim(), qty: pu ? pu.qty : null, unit: pu ? pu.unit : null, price, cost, shop: String(r[5] || '').trim().toLowerCase() });
    });
  };
  add(priceLogRows, true);
  add(expenseRows, false);
  for (const l of map.values()) l.sort((a, b) => a.date - b.date);
  return { map, tripDays };
}

const modeOf = (xs) => {
  const c = new Map();
  for (const x of xs) c.set(x, (c.get(x) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
};

function infoFor(list, unit, today) {
  const same = (list || []).filter((e) => e.unit === unit && e.qty > 0);
  const recent = same.filter((e) => daysBetween(e.date, today) <= 120);
  const pool = recent.length ? recent : same;
  const pack = pool.length ? modeOf(pool.map((e) => Math.round(e.qty))) : null;
  const costed = (list || []).filter((e) => e.cost && (!e.unit || e.unit === unit));
  const latest = costed[costed.length - 1] || null;
  const recentCosted = costed.filter((e) => daysBetween(e.date, today) <= 120 && e.shop);
  const cheapest = recentCosted.length ? recentCosted.reduce((a, b) => (b.cost < a.cost ? b : a)) : null;
  const shopFreq = modeOf((list || []).filter((e) => e.shop).slice(-6).map((e) => e.shop));
  return { pack, latestCost: latest ? latest.cost : null, lastBought: same.length ? same[same.length - 1].date : (list && list.length ? list[list.length - 1].date : null), shop: cheapest ? cheapest.shop : (shopFreq || ''), cheapest, entries: same };
}

// What is in the fridge or cupboard now, from the receipts and the usual daily use. Never below zero.
function onHandNow(entries, perDay, today) {
  const start = addDays(today, -HISTORY_DAYS);
  const byDay = new Map();
  for (const e of entries) if (e.date >= start && e.date <= today) byDay.set(formatDMY(e.date), (byDay.get(formatDMY(e.date)) || 0) + e.qty);
  let bal = 0;
  for (let d = start; d <= today; d = addDays(d, 1)) {
    bal += byDay.get(formatDMY(d)) || 0;
    if (d < today) bal = Math.max(0, bal - perDay);
  }
  return bal;
}

// ---- shelf life --------------------------------------------------------------------------------------

function shelfOf(rows = []) {
  const map = new Map();
  rows.forEach((r, i) => {
    if (i === 0 && /ingredient/i.test(String(r[0] || ''))) return;
    const name = String(r[0] || '').trim(); const days = numOf(r[1]);
    if (name && days !== null && days > 0) map.set(normName(name), Math.round(days));
  });
  return map;
}
// -> number of days it keeps (fresh), or null when it can be bulk bought
function freshDays(name, shelf) {
  const k = normName(name);
  if (shelf.has(k)) return shelf.get(k) >= BULK_COVER ? null : Math.min(shelf.get(k), FRESH_MAX);
  const n = String(name).toLowerCase();
  if (FRESH_WORDS.some((w) => n.includes(w)) && !NOT_FRESH.test(n)) return FRESH_COVER;
  return null;
}

// ---- the plan ----------------------------------------------------------------------------------------

function roundToPack(need, pack, unit) {
  if (!(need > 0)) return { qty: 0, packs: 0 };
  if (pack > 0) { const packs = Math.max(1, Math.ceil(need / pack - 1e-9)); return { qty: packs * pack, packs }; }
  const step = unit === 'piece' ? 1 : 10;
  return { qty: Math.ceil(need / step) * step, packs: 0 };
}
const packText = (packs, pack, unit) => (packs > 0 ? `${packs} x ${fmtQty(pack, unit)}` : '');

function buildShoppingPlan({ today, sales = [], cookLogRows = [], sizeRows = [], lineRows = [], priceLogRows = [], expenseRows = [], shelfRows = [] }) {
  const warnings = [];
  const demand = demandOf(sales, today);
  const usage = usageOf(cookLogRows, sizeRows, lineRows);
  const { map: buys, tripDays } = purchasesOf(priceLogRows, expenseRows, today);
  const shelf = shelfOf(shelfRows);

  for (const k of demand.normal) {
    if (!demand.dishes.some((d) => d.months[k] > 0)) warnings.push(`No batch dish sales were found for ${monthName(k)}. Check the Master Log, Sheet1 and Ledger have that month.`);
  }
  if (!usage.batchCount) warnings.push('No batches with ingredient lines were found in the Cook Log yet, so amounts per portion are unknown.');

  // monthly need per ingredient or packaging line
  const need = new Map();
  for (const d of demand.dishes) {
    const u = usage.perDish.get(d.dish);
    if (!u || !d.perMonth) { if (d.perMonth && !u) warnings.push(`${d.dish} sells but has no batch with ingredient lines yet, so it is not in the plan.`); continue; }
    for (const [gk, l] of u.lines) {
      const perPortion = l.qty / u.portions;
      const n = need.get(gk) || { name: l.name, kind: l.kind, unit: l.unit, monthly: 0, dishes: new Set() };
      n.monthly += perPortion * d.perMonth * (1 + BUFFER); n.dishes.add(d.dish);
      need.set(gk, n);
    }
  }

  const lastMonth = monthsOf(addDays(utc(today.getUTCFullYear(), today.getUTCMonth() + 1, 1), 1)).slice(-1)[0] || '';
  const boughtIn = (key, mk) => new Set((buys.get(key) || []).filter((e) => monthKey(e.date) === mk).map((e) => formatDMY(e.date))).size;

  const fresh = []; const bulk = []; const noHistory = [];
  for (const [gk, n] of need) {
    const key = gk.split('|')[0];
    const perDay = n.monthly / 30;
    const info = infoFor(buys.get(key), n.unit, today);
    if (n.kind === 'Ingredient' && !buys.has(key)) noHistory.push(n.name);
    const hand = info.entries.length ? onHandNow(info.entries, perDay, today) : 0;
    const item = {
      name: titleCase(n.name), kind: n.kind, unit: n.unit, monthly: Math.round(n.monthly), monthlyText: fmtQty(n.monthly, n.unit),
      perDay, onHand: Math.round(hand), onHandText: info.entries.length ? fmtQty(hand, n.unit) : 'unknown',
      pack: info.pack, latestCost: info.latestCost, shop: titleCase(info.shop), lastBought: info.lastBought ? formatDMY(info.lastBought) : '',
      boughtLastMonth: boughtIn(key, lastMonth), dishes: [...n.dishes].sort(),
    };
    const days = n.kind === 'Ingredient' ? freshDays(n.name, shelf) : null;
    if (days !== null) { item.cover = days; item._info = info; fresh.push(item); } else { item._info = info; bulk.push(item); }
  }

  // ---- fresh runs
  const cycle = Math.max(3, fresh.length ? Math.min(FRESH_COVER, ...fresh.map((f) => f.cover)) : FRESH_COVER);
  for (const f of fresh) {
    const runOut = f.onHand > 0 && f.perDay > 0 ? addDays(today, Math.floor(f.onHand / f.perDay)) : today;
    const useBy = f._info.lastBought && f.onHand > 0 ? addDays(f._info.lastBought, f.cover) : today;
    f.dueDate = new Date(Math.max(today.getTime(), Math.min(runOut.getTime(), useBy.getTime())));
    const r = roundToPack(f.perDay * cycle, f.pack, f.unit);
    f.buyQty = r.qty; f.buyText = fmtQty(r.qty, f.unit); f.packText = packText(r.packs, f.pack, f.unit);
    f.estCost = f.latestCost ? Math.round(r.qty * f.latestCost) : null;
    f.due = dayText(f.dueDate); f.useBy = f._info.lastBought && f.onHand > 0 ? formatDMY(addDays(f._info.lastBought, f.cover)) : '';
  }
  const nextFresh = fresh.length ? new Date(Math.min(...fresh.map((f) => f.dueDate.getTime()))) : null;
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const freshRuns = [];
  if (nextFresh) for (let d = nextFresh; d <= monthEnd; d = addDays(d, cycle)) freshRuns.push(d);

  // ---- bulk trip
  const live = bulk.filter((b) => b.perDay > 0);
  for (const b of live) b.runOutDate = b.onHand > 0 ? addDays(today, Math.floor(b.onHand / b.perDay)) : today;
  const firstOut = live.length ? new Date(Math.min(...live.map((b) => b.runOutDate.getTime()))) : null;
  const tripDate = firstOut ? new Date(Math.max(today.getTime(), addDays(firstOut, -RUN_EARLY).getTime())) : null;
  const toBuy = []; const enough = [];
  for (const b of live) {
    if (daysBetween(tripDate, b.runOutDate) > BULK_COVER) { enough.push({ name: b.name, until: formatDMY(b.runOutDate) }); continue; }
    const handAtTrip = Math.max(0, b.onHand - b.perDay * daysBetween(today, tripDate));
    const r = roundToPack(Math.max(0, b.perDay * BULK_COVER - handAtTrip), b.pack, b.unit);
    b.buyQty = r.qty; b.buyText = fmtQty(r.qty, b.unit); b.packText = packText(r.packs, b.pack, b.unit);
    b.estCost = b.latestCost ? Math.round(r.qty * b.latestCost) : null;
    b.runOut = dayText(b.runOutDate);
    toBuy.push(b);
  }
  const groups = new Map();
  for (const b of toBuy) { const s = b.shop || 'Anywhere'; if (!groups.has(s)) groups.set(s, []); groups.get(s).push(b); }
  const strip = (x) => { const { _info, perDay, dueDate, runOutDate, ...rest } = x; return { ...rest, perDay: r2(perDay) }; };
  const sum = (xs) => xs.reduce((s, x) => s + (x.estCost || 0), 0);

  // ---- trips, this month against last month
  const monthStart = utc(today.getUTCFullYear(), today.getUTCMonth() + 1, 1);
  const tripsLast = [...tripDays].filter((d) => monthKey(parseDate(d, today)) === lastMonth).length;
  const tripsSoFar = [...tripDays].filter((d) => parseDate(d, today) >= monthStart).length;
  const bulkThisMonth = tripDate && tripDate <= monthEnd && toBuy.length ? 1 : 0;
  const planned = { bulk: bulkThisMonth, fresh: freshRuns.length, total: bulkThisMonth + freshRuns.length };

  const basis = demand.normal.map(monthName).join(' and ');
  const out = {
    today: formatDMY(today),
    monthLabel: monthName(monthKey(today)),
    assumptions: [
      `Dish volumes: average portions sold in ${basis || 'no completed month yet'}${SLOW_MONTHS.length ? ` (${SLOW_MONTHS.map(monthName).join(', ')} left out, a slow month)` : ''}, plus ${Math.round(BUFFER * 100)}% so a busy week does not force an extra trip.`,
      usage.batchCount ? `Amounts per portion come from ${usage.batchCount} real batches since ${formatDMY(usage.firstDate)}.` : 'Amounts per portion are not known yet.',
      `Fresh items are bought about every ${cycle} days and never kept past ${FRESH_MAX}. Everything else is one bulk trip that covers ${BULK_COVER} days. Add an ingredient and its days to the Shelf Life tab to change that.`,
      'Stock now is estimated from your receipts and the usual daily use, so keep logging receipts.',
    ],
    demand: demand.dishes.map((d) => ({ dish: d.dish, perMonth: d.perMonth, basis: d.basis, months: d.months })),
    months: demand.completed.map((k) => ({ key: k, label: monthName(k), slow: SLOW_MONTHS.includes(k), used: demand.normal.includes(k) })),
    trips: { lastMonthLabel: lastMonth ? monthName(lastMonth) : '', lastMonth: tripsLast, thisMonthSoFar: tripsSoFar, planned },
    fresh: {
      cycleDays: cycle,
      nextRun: nextFresh ? { date: formatDMY(nextFresh), day: dayText(nextFresh), inDays: Math.max(0, daysBetween(today, nextFresh)) } : null,
      runs: freshRuns.map(dayText),
      items: fresh.sort((a, b) => a.dueDate - b.dueDate || a.name.localeCompare(b.name)).map(strip),
      estCost: sum(fresh),
    },
    bulk: {
      tripDate: tripDate && toBuy.length ? { date: formatDMY(tripDate), day: dayText(tripDate), inDays: Math.max(0, daysBetween(today, tripDate)) } : null,
      coverDays: BULK_COVER,
      groups: [...groups].map(([shop, items]) => ({ shop, items: items.sort((a, b) => a.name.localeCompare(b.name)).map(strip), estCost: sum(items) })).sort((a, b) => b.estCost - a.estCost),
      estCost: sum(toBuy),
      enough,
    },
    warnings,
  };
  if (noHistory.length) out.warnings.push(`No receipt history for ${noHistory.slice(0, 8).join(', ')}${noHistory.length > 8 ? ` and ${noHistory.length - 8} more` : ''}, so no pack size or price is shown for them.`);
  return out;
}

module.exports = {
  buildShoppingPlan, combineSales, salesFromRows, demandOf, usageOf, purchasesOf, onHandNow, shelfOf, freshDays, roundToPack,
  FRESH_COVER, FRESH_MAX, BULK_COVER, BUFFER, SLOW_MONTHS, FIRST_MONTH,
};
