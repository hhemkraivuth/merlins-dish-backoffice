// "Needs attention" on Home. Reads the recent Expense Log (every typed receipt and receipt photo lands there) and lists what
// the web does not have yet: an item that is not in the Price Tracker (so no cost), or not on the Stock page (so no count).
// Lily can add it to the Stock page right there, or ignore it for good (fresh food, things she does not count).
const { parseDate, bangkokToday, daysBetween, formatDMY } = require('./dates');
const { matchStock } = require('./overheads');

// Order screenshots (Grab) and LINE orders end up in the Ledger. Anything sold in the last 30 days that has no cost on record
// (a pasta not in the Menu Summary, a new drink) makes profit look better than it is, so it is listed too.
// ledger: ledgerObjects(). Returns the same shape as attentionItems, with kind 'sold'.
function soldWithoutCost({ ledger = [], today = bangkokToday(), days = 30, ignored = [] } = {}) {
  const { buildCostTable, lineItemCost } = require('./reports');
  const skip = new Set(ignored);
  const table = buildCostTable(ledger);
  const found = new Map();
  const note = (name, date, channel, qty) => {
    const k = `sold:${looseKey(name)}`; if (skip.has(k) || skip.has(looseKey(name))) return;
    const f = found.get(k) || { key: k, name, qty: 0, date, channels: new Set() };
    f.qty += qty || 1; f.channels.add(channel); if (date > f.date) f.date = date;
    found.set(k, f);
  };
  for (const r of ledger) {
    if (daysBetween(today, r.date) > days) continue;
    if (r.type === 'Recipe' && (r.cost === null || r.cost <= 0)) { note(r.desc, r.date, r.channel, r.qty); continue; }
    if (r.type === 'Order') { const c = lineItemCost(r, table); if (c.missing) note(c.missing, r.date, r.channel, r.qty); }
  }
  return [...found.values()].map((f) => ({
    key: f.key, kind: 'sold', name: f.name, bought: formatDMY(f.date), shop: [...f.channels].join(' and '),
    reasons: [`Sold ${f.qty} time${f.qty === 1 ? '' : 's'} in recent orders with no cost on record, so profit looks higher than it is. Add its cost to the Price Tracker or Menu Summary tab.`],
  }));
}

const IGNORE_KEY = 'attention_ignored';
const looseKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9฀-๿]+/g, '');

// expenseRows: Date | Ingredient | Price | Unit | Cost/unit | Shop | Remarks (header first or not). stock: Stock page items.
// ignored: array of looseKeys. untracked: condiment names counted as packs elsewhere.
function attentionItems({ expenseRows = [], stock = [], ignored = [], untracked = [], today = bangkokToday(), days = 30 } = {}) {
  const skip = new Set([...ignored, ...untracked.map(looseKey)]);
  const seen = new Map();
  expenseRows.forEach((r, i) => {
    const date = parseDate(r[0], today);
    const name = String(r[1] || '').trim();
    if (!date || !name || (i === 0 && /^date$/i.test(String(r[0] || '').trim()))) return;
    if (daysBetween(today, date) > days) return;
    const k = looseKey(name); if (!k || skip.has(k)) return;
    const unmatched = /not matched to a known ingredient/i.test(String(r[6] || ''));
    const prev = seen.get(k);
    if (!prev || date > prev.date) seen.set(k, { name, date, shop: String(r[5] || '').trim(), unmatched: unmatched || (prev && prev.unmatched) });
    else if (unmatched) prev.unmatched = true;
  });
  const out = [];
  for (const [k, v] of seen) {
    const reasons = [];
    if (v.unmatched) reasons.push('Not in the Price Tracker, so its cost is not counted');
    const m = matchStock(v.name, stock);
    if (m.hit) { /* on the Stock page */ }
    else if (m.ambiguous.length) reasons.push(`Could be ${m.ambiguous.slice(0, 3).map((x) => x.itemName).join(' or ')} on the Stock page`);
    else reasons.push('Not on the Stock page');
    if (reasons.length) out.push({ key: k, name: v.name, bought: formatDMY(v.date), shop: v.shop, reasons });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const parseList = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };

async function loadAttention() {
  const { readTab } = require('./sheets');
  const { getAllStock } = require('./stockCounts');
  const st = require('./appState');
  const { loadUntracked } = require('./ingredientLots');
  const [expenseRows, stock, ignored, untracked] = await Promise.all([
    readTab('Expense Log'), getAllStock(), st.getState(IGNORE_KEY).then(parseList).catch(() => []), loadUntracked().catch(() => []),
  ]);
  const items = attentionItems({ expenseRows, stock, ignored, untracked });
  try {
    const svc = require('./ledgerService'); const { LEDGER_TAB, ledgerObjects } = require('./ledger');
    items.unshift(...soldWithoutCost({ ledger: ledgerObjects(await svc.readOrEmpty(LEDGER_TAB)), ignored }));
  } catch (err) { console.error('Order cost check failed:', err.message); }
  return items;
}

async function ignoreItem(name) {
  const st = require('./appState');
  const k = String(name).startsWith('sold:') ? String(name) : looseKey(name); if (!k || k === 'sold:') throw new Error('Which item?');
  const list = parseList(await st.getState(IGNORE_KEY));
  if (!list.includes(k)) list.push(k);
  await st.setState(IGNORE_KEY, JSON.stringify(list));
}

async function addToStock({ name, count, unit, category }) {
  const { setStockCount, CATEGORIES, guessCategory } = require('./stockCounts');
  const n = Number(count);
  if (!String(name || '').trim() || !Number.isFinite(n) || n < 0) throw new Error('Needs the item and how many you have.');
  const cat = CATEGORIES.includes(category) ? category : guessCategory(name);
  await setStockCount(String(name).trim(), n, String(unit || 'pack').trim() || 'pack', 'Needs attention', cat);
}

module.exports = { soldWithoutCost, attentionItems, loadAttention, ignoreItem, addToStock, IGNORE_KEY, looseKey };
