// Monthly logs for the BOH pages, all pure functions over the raw tab rows.
//
//   buildReceiptLog   what was bought, when, where, how many and how much (Expense Log + Overheads), by month
//   buildCookLog      what was cooked, when, how many portions and what it cost (Cook Log + Cook Log Sizes), by month
//   buildReadyStock   ready to eat portions per dish: cooked minus sold, or the last count Lily typed
//   toCsv             CSV text with a BOM so Excel reads Thai text correctly

const { parseDate, formatDMY, daysBetween } = require('./dates');
const { num } = require('./ledger');
const { isAds } = require('./overheads');
const { BATCH_DISHES, batchDishOf } = require('./dishes');
const { sellThrough } = require('./reports');

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthLabel = (key) => {
  const [y, m] = key.split('-');
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m) - 1]} ${y}`;
};
const isHeader = (r, i) => i === 0 && /date/i.test(String(r[0] || ''));

// "11/2026", "2026-11" or "all" -> "2026-11" | "all" | null (null means: not understood)
function parseMonth(v, today) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return today ? monthKey(today) : 'all';
  if (s === 'all') return 'all';
  let m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${String(m[1]).padStart(2, '0')}`;
  return null;
}

function monthsOf(items, today) {
  const set = new Set(items.map((x) => monthKey(x.date)));
  if (today) set.add(monthKey(today));
  return [...set].sort().reverse().map((key) => ({ key, label: monthLabel(key) }));
}

// ---- receipts -------------------------------------------------------------------------------------
// expenseRows: Date | Ingredient | Purchase Price | Purchase Unit | Cost per Recipe Unit | Shopped at | Remarks
// overheadRows: Date | Item | Category | Price | Shopped at | Remarks
function receiptItems(expenseRows = [], overheadRows = []) {
  const out = [];
  expenseRows.forEach((r, i) => {
    if (isHeader(r, i)) return;
    const date = parseDate(r[0]); const price = num(r[2]);
    if (!date || price === null) return;
    out.push({ date, type: 'Ingredient', item: String(r[1] || '').trim(), qty: String(r[3] || '').trim(), price, perUnit: num(r[4]), shop: String(r[5] || '').trim(), remarks: String(r[6] || '').trim(), category: '' });
  });
  overheadRows.forEach((r, i) => {
    if (isHeader(r, i)) return;
    const date = parseDate(r[0]); const price = num(r[3]);
    if (!date || price === null) return;
    out.push({ date, type: isAds(r[2]) ? 'Ads' : 'Overhead', item: String(r[1] || '').trim(), qty: '', price, perUnit: null, shop: String(r[4] || '').trim(), remarks: String(r[5] || '').trim(), category: String(r[2] || '').trim() });
  });
  // Date, then the order they were logged in
  return out.map((x, n) => ({ ...x, n })).sort((a, b) => a.date - b.date || a.n - b.n);
}

function buildReceiptLog({ expenseRows, overheadRows, month, today }) {
  const all = receiptItems(expenseRows, overheadRows);
  const key = parseMonth(month, today);
  if (key === null) throw Object.assign(new Error('Month must look like 11/2026 or "all".'), { status: 400 });
  const mine = key === 'all' ? all : all.filter((x) => monthKey(x.date) === key);
  const sum = (type) => r2(mine.filter((x) => x.type === type).reduce((s, x) => s + x.price, 0));
  const shops = new Map();
  for (const x of mine) if (x.type !== 'Ads') { const k = x.shop || 'No shop named'; shops.set(k, (shops.get(k) || 0) + x.price); }
  return {
    month: key, label: key === 'all' ? 'All months' : monthLabel(key),
    months: monthsOf(all, today),
    totals: { ingredients: sum('Ingredient'), overheads: sum('Overhead'), ads: sum('Ads'), all: r2(mine.reduce((s, x) => s + x.price, 0)), lines: mine.length },
    byShop: [...shops].map(([shop, amount]) => ({ shop, amount: r2(amount) })).sort((a, b) => b.amount - a.amount),
    rows: mine.map((x) => ({ date: formatDMY(x.date), type: x.type, item: x.item, qty: x.qty, price: x.price, perUnit: x.perUnit, shop: x.shop, remarks: x.remarks, category: x.category })),
  };
}

const RECEIPT_CSV_HEADERS = ['Date', 'Type', 'Item', 'How many (purchase unit)', 'Price paid', 'Cost per g / ml / piece', 'Shopped at', 'Category', 'Remarks'];
const receiptCsvRows = (log) => log.rows.map((r) => [r.date, r.type, r.item, r.qty, r.price, r.perUnit === null ? '' : r.perUnit, r.shop, r.category, r.remarks]);
// Same columns as the Price Log tab in Merlin's numbers, ingredients only, so it can be pasted straight in.
const PRICE_LOG_HEADERS = ['Shopping Date', 'Ingredient', 'Purchase Price', 'Purchase Unit', 'Cost per Recipe Unit', 'Shopped at', 'Remarks'];
const priceLogCsvRows = (log) => log.rows.filter((r) => r.type === 'Ingredient').map((r) => [r.date, r.item, r.price, r.qty, r.perUnit === null ? '' : r.perUnit, r.shop, r.remarks]);

// ---- cooking --------------------------------------------------------------------------------------
// logRows: Batch Key | Date Cooked | Dish | Yield | Ingredient Cost | Packaging Cost | Utility Cost | Total Batch Cost | Cost per Portion | Flags | Logged At | Source
// sizeRows: Batch Key | Date Cooked | Dish | Size | Portion Weight (g) | Count Packed | Cost per Portion | Total Cooked Weight (g) | Cost per Gram
// lineRows: Batch Key | Date Cooked | Dish | Type | Line | Qty | Unit | Unit Cost | Price Date | Price Source | Line Cost | Qty From
function cookItems(logRows = [], sizeRows = []) {
  const sizes = new Map();
  for (const r of sizeRows.slice(1)) {
    if (!sizes.has(r[0])) sizes.set(r[0], []);
    sizes.get(r[0]).push({ name: String(r[3] || '').trim(), weight: num(r[4]), count: num(r[5]) || 0 });
  }
  const out = [];
  logRows.slice(1).forEach((r, n) => {
    const date = parseDate(r[1]);
    if (!date || !r[0]) return;
    const sz = sizes.get(r[0]) || [];
    const packed = sz.reduce((s, z) => s + z.count, 0);
    out.push({
      n, key: String(r[0]), date, dish: String(r[2] || '').trim(),
      portions: packed || num(r[3]) || 0,
      sizes: sz.map((z) => `${z.name} x${z.count}`).join(', '),
      ingredients: num(r[4]) || 0, packaging: num(r[5]) || 0, utility: num(r[6]) || 0, total: num(r[7]) || 0, perPortion: num(r[8]),
      flags: String(r[9] || '').trim(), source: String(r[11] || '').trim(),
    });
  });
  return out.sort((a, b) => a.date - b.date || a.n - b.n);
}

function buildCookLog({ logRows, sizeRows, month, today }) {
  const all = cookItems(logRows, sizeRows);
  const key = parseMonth(month, today);
  if (key === null) throw Object.assign(new Error('Month must look like 11/2026 or "all".'), { status: 400 });
  const mine = key === 'all' ? all : all.filter((x) => monthKey(x.date) === key);
  const portions = mine.reduce((s, x) => s + x.portions, 0);
  const cost = mine.reduce((s, x) => s + x.total, 0);
  const dishes = new Map();
  for (const b of mine) {
    const d = dishes.get(b.dish) || { dish: b.dish, batches: 0, portions: 0, cost: 0 };
    d.batches += 1; d.portions += b.portions; d.cost += b.total; dishes.set(b.dish, d);
  }
  return {
    month: key, label: key === 'all' ? 'All months' : monthLabel(key),
    months: monthsOf(all, today),
    totals: { batches: mine.length, portions, cost: r2(cost), perPortion: portions ? r2(cost / portions) : null },
    byDish: [...dishes.values()].map((d) => ({ ...d, cost: r2(d.cost), perPortion: d.portions ? r2(d.cost / d.portions) : null })).sort((a, b) => b.portions - a.portions),
    rows: mine.map((x) => ({ key: x.key, date: formatDMY(x.date), dish: x.dish, portions: x.portions, sizes: x.sizes, ingredients: r2(x.ingredients), packaging: r2(x.packaging), utility: r2(x.utility), total: r2(x.total), perPortion: x.perPortion, lowYield: x.portions > 0 && x.portions <= 3, flags: x.flags })),
  };
}

const COOK_CSV_HEADERS = ['Date cooked', 'Dish', 'Portions made', 'Sizes packed', 'Ingredient cost', 'Packaging cost', 'Utility cost', 'Total batch cost', 'Cost per portion', 'Flags', 'Batch key'];
const cookCsvRows = (log) => log.rows.map((r) => [r.date, r.dish, r.portions, r.sizes, r.ingredients, r.packaging, r.utility, r.total, r.perPortion === null ? '' : r.perPortion, r.flags, r.key]);

// Every ingredient line of the batches in the month (the audit trail), for the detailed download.
const COOK_LINES_CSV_HEADERS = ['Date cooked', 'Dish', 'Type', 'Line', 'Qty', 'Unit', 'Unit cost', 'Price date', 'Line cost', 'Batch key'];
function cookLinesCsvRows({ lineRows = [], month, today }) {
  const key = parseMonth(month, today);
  const rows = [];
  lineRows.slice(1).forEach((r, n) => {
    const date = parseDate(r[1]);
    if (!date || (key !== 'all' && monthKey(date) !== key)) return;
    rows.push({ n, date, row: [formatDMY(date), r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[10], r[0]] });
  });
  return rows.sort((a, b) => a.date - b.date || a.n - b.n).map((x) => x.row);
}

// ---- ready to eat stock ---------------------------------------------------------------------------
// Ready to eat means cooked and portioned, waiting to be sold.
// Without a count: portions cooked minus portions sold (oldest batch used first), the same sums as the Home page.
// With a count (Ready Counts tab: Dish | Count | Counted on | Logged at): the count, plus portions cooked after that date,
// minus portions sold after that date. Anything dated on the count day is taken to be inside the count already.
const READY_HEADERS = ['Dish', 'Count', 'Counted on', 'Logged at', 'As typed'];
const STALE_DAYS = 5;

function latestCounts(countRows = []) {
  const map = new Map();
  countRows.forEach((r, i) => {
    if (i === 0 && /^dish$/i.test(String(r[0] || '').trim())) return;
    const date = parseDate(r[2]); const count = num(r[1]);
    if (!r[0] || !date || count === null) return;
    const name = String(r[0]).trim();
    const prev = map.get(name);
    if (!prev || date.getTime() >= prev.date.getTime()) map.set(name, { date, count });
  });
  return map;
}

function buildReadyStock({ today, ledger = [], cookBatches = [], countRows = [] }) {
  // Dish names are matched without regard to capital letters ("Dark Beer Stew" in the Cook Log, "Dark beer Stew" in the count).
  const lc = (n) => String(n || '').toLowerCase();
  const st = new Map(sellThrough(ledger, cookBatches, today).map((d) => [lc(d.dish), d]));
  const counts = new Map([...latestCounts(countRows)].map(([n, c]) => [lc(n), c]));
  const shown = new Map();
  [...BATCH_DISHES.map(([n]) => n), ...[...st.values()].map((d) => d.dish), ...latestCounts(countRows).keys()].forEach((n) => { if (!shown.has(lc(n))) shown.set(lc(n), n); });
  const items = [...shown.values()].map((dish) => {
    const s = st.get(lc(dish));
    const batches = cookBatches.filter((b) => lc(b.dish) === lc(dish) && b.portions);
    const lastCooked = batches.length ? new Date(Math.max(...batches.map((b) => b.date.getTime()))) : null;
    const c = counts.get(lc(dish));
    let left; let basis; let ageDays;
    if (c) {
      const cookedAfter = batches.filter((b) => b.date.getTime() > c.date.getTime()).reduce((x, b) => x + b.portions, 0);
      const soldAfter = ledger.filter((r) => r.type === 'Order' && r.qty && r.date.getTime() > c.date.getTime() && lc(batchDishOf(r.desc)) === lc(dish)).reduce((x, r) => x + r.qty, 0);
      left = c.count + cookedAfter - soldAfter;
      basis = 'counted';
      ageDays = lastCooked ? daysBetween(today, lastCooked) : null;
    } else {
      left = s ? s.remaining : 0;
      basis = s ? 'estimated' : 'none';
      ageDays = s && s.live.length ? s.oldestAgeDays : null;
    }
    const negative = left < 0;
    const short = negative ? -left : 0;
    if (negative) left = 0;
    return {
      dish, left, basis, negative, short,
      countedOn: c ? formatDMY(c.date) : '',
      lastCooked: lastCooked ? formatDMY(lastCooked) : '',
      ageDays, stale: left > 0 && ageDays !== null && ageDays > STALE_DAYS,
    };
  });
  return { today: formatDMY(today), staleDays: STALE_DAYS, items: items.sort((a, b) => b.left - a.left || a.dish.localeCompare(b.dish)) };
}

// Stock for the to do list and the daily huddle: sellThrough() results, with a counted dish taken from its count instead.
// The counted portions are given to the newest batches first (the oldest are sold first), so a batch that is 14 days old
// still flags for a flash sale only while some of it is really left. A count settles old "sold beyond the cook notes" gaps.
function applyCounts(stock, { today, ledger = [], cookBatches = [], countRows = [] }) {
  const ready = new Map(buildReadyStock({ today, ledger, cookBatches, countRows }).items.filter((i) => i.basis === 'counted').map((i) => [String(i.dish).toLowerCase(), i]));
  return stock.map((s) => {
    const c = ready.get(String(s.dish).toLowerCase());
    if (!c) return s;
    let left = c.left;
    const live = [];
    for (const b of cookBatches.filter((x) => String(x.dish).toLowerCase() === String(s.dish).toLowerCase() && x.portions).sort((a, z) => z.date - a.date)) {
      if (left <= 0) break;
      const take = Math.min(left, b.portions);
      live.push({ key: b.key, date: b.date, portions: b.portions, remaining: take, ageDays: daysBetween(today, b.date) });
      left -= take;
    }
    live.reverse();
    return { ...s, remaining: c.left, oversold: c.short, live, oldestAgeDays: live.length ? Math.max(...live.map((b) => b.ageDays)) : 0 };
  });
}

// ---- csv ------------------------------------------------------------------------------------------
const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function toCsv(headers, rows) {
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

module.exports = {
  receiptItems, cookItems, parseMonth, monthKey, buildReceiptLog, receiptCsvRows, priceLogCsvRows, RECEIPT_CSV_HEADERS, PRICE_LOG_HEADERS,
  buildCookLog, cookCsvRows, COOK_CSV_HEADERS, cookLinesCsvRows, COOK_LINES_CSV_HEADERS,
  buildReadyStock, applyCounts, latestCounts, READY_HEADERS, STALE_DAYS, toCsv,
};
