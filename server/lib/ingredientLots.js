// Ingredient stock lots, used first in, first out.
//
// Every purchase of a stock tracked ingredient (a typed receipt line or an opening stock line)
// becomes a lot: date, quantity, price. A cooked batch takes its grams from the OLDEST lot first
// (only lots bought on or before the cook date). A batch that spans two lots is costed as the
// blend of the two prices. When the old lot is used up the next lot takes over.
//
// Condiments (black pepper, salt, flour) are listed in the "Untracked Ingredients" tab. They never
// get lots and keep using the latest price, as before.
//
// Tabs (Claude Log only, never the live Merlin's numbers sheet):
//   Ingredient Lots      one row per lot, "Remaining" goes down as batches use it
//   Lot Usage            audit trail, one row per batch line per lot it took from
//   Untracked Ingredients  names to leave out of lot tracking (Lily can edit)

const { normName, toNumber, parsePurchaseUnit, unitKind } = require('./priceBook');
const { parseDate, formatDMY, bangkokNow } = require('./dates');

const LOTS_TAB = 'Ingredient Lots';
const USAGE_TAB = 'Lot Usage';
const UNTRACKED_TAB = 'Untracked Ingredients';

const LOT_HEADERS = ['Lot ID', 'Ingredient', 'Purchase Date', 'Source', 'Qty Purchased', 'Unit', 'Remaining', 'Total Price', 'Cost per Unit', 'Status', 'Last Updated', 'Note'];
const USAGE_HEADERS = ['Batch Key', 'Date Cooked', 'Ingredient', 'Lot ID', 'Lot Date', 'Qty Used', 'Unit Cost', 'Cost', 'Logged At'];
const DEFAULT_UNTRACKED = ['Black pepper', 'Salt', 'All purpose flour'];

const EPS = 1e-6;
const round = (n, dp) => Number(n.toFixed(dp));

// Recipe units and purchase units both come in as "g", "gm", "pcs" and so on.
function baseUnit(u) {
  return unitKind(u);
}

let lotSeq = 0;
function newLotId(date, now = Date.now()) {
  lotSeq = (lotSeq + 1) % 1000;
  return `L${formatDMY(date).split('/').reverse().join('')}-${(now % 1e8).toString(36)}${lotSeq}`;
}

// The in memory book for one costing run. Nothing here touches Google.
class LotBook {
  // rows: the Ingredient Lots tab as read (header first). untracked: array of names.
  constructor(rows = [], untracked = [], today) {
    this.untracked = new Set(untracked.map(normName).filter(Boolean));
    this.lots = new Map(); // normalised name -> [lot], oldest first
    this.byId = new Map();
    this.consumed = new Map(); // lot id -> qty taken during this run
    this.added = []; // lots created during this run (count adjustments)
    let seq = 0;
    rows.forEach((r, i) => {
      if (i === 0 && /lot/i.test(String(r[0] || ''))) return;
      const id = String(r[0] || '').trim();
      const name = String(r[1] || '').trim();
      const date = parseDate(r[2], today);
      const qty = toNumber(r[4]);
      const remaining = toNumber(r[6]);
      const total = toNumber(r[7]);
      if (!id || !name || !date || qty === null || qty <= 0 || remaining === null || total === null) return;
      const lot = { id, rowIndex: i + 1, name, date, source: String(r[3] || ''), qty, unit: baseUnit(r[5]), remaining, total, unitCost: total / qty, seq: seq++ };
      const key = normName(name);
      if (!this.lots.has(key)) this.lots.set(key, []);
      this.lots.get(key).push(lot);
      this.byId.set(id, lot);
    });
    for (const list of this.lots.values()) list.sort((a, b) => a.date - b.date || a.seq - b.seq);
  }

  isUntracked(name) { return this.untracked.has(normName(name)); }
  hasLots(name) { return this.lots.has(normName(name)); }
  names() { return [...this.lots.values()].map((l) => l[0].name); }
  lotsFor(name) { return this.lots.get(normName(name)) || []; }
  totalRemaining(name) { return this.lotsFor(name).reduce((s, l) => s + Math.max(l.remaining, 0), 0); }

  // Takes qty from the oldest eligible lots. Returns { parts: [{ lot, qty, unitCost }], short }.
  allocate(name, qty, unit, onDate) {
    const u = baseUnit(unit);
    const parts = [];
    let need = qty;
    for (const lot of this.lotsFor(name)) {
      if (need <= EPS) break;
      if (lot.unit !== u || lot.date > onDate || lot.remaining <= EPS) continue;
      const take = Math.min(lot.remaining, need);
      lot.remaining -= take;
      this.consumed.set(lot.id, (this.consumed.get(lot.id) || 0) + take);
      parts.push({ lot, qty: take, unitCost: lot.unitCost });
      need -= take;
    }
    return { parts, short: need > EPS ? need : 0 };
  }

  // Sets the real quantity on the shelf. Less than the book says: oldest lots are reduced. More: an adjustment lot is added at the newest cost.
  countTo(name, target, date) {
    const lots = this.lotsFor(name);
    if (!lots.length) return null;
    const before = this.totalRemaining(name);
    if (target < before - EPS) {
      let cut = before - target;
      for (const lot of lots) {
        if (cut <= EPS) break;
        const take = Math.min(Math.max(lot.remaining, 0), cut);
        if (take <= 0) continue;
        lot.remaining -= take;
        this.consumed.set(lot.id, (this.consumed.get(lot.id) || 0) + take);
        cut -= take;
      }
    } else if (target > before + EPS) {
      const last = lots[lots.length - 1];
      const extra = target - before;
      const lot = { id: newLotId(date), rowIndex: null, name: last.name, date, source: 'Count adjust', qty: extra, unit: last.unit, remaining: extra, total: extra * last.unitCost, unitCost: last.unitCost, seq: 1e9 };
      this.added.push(lot);
    }
    return { before, after: target, unit: lots[0].unit, name: lots[0].name };
  }
}

// ---- Google Sheets side -------------------------------------------------------------------

function lotRow(l, status) {
  return [l.id, l.name, formatDMY(l.date), l.source, round(l.qty, 3), l.unit, round(Math.max(l.remaining, 0), 3), round(l.total, 2), round(l.unitCost, 5), status || (l.remaining > EPS ? 'Active' : 'Used up'), bangkokNow(), l.note || ''];
}

async function loadLotBook(today) {
  const cookLog = require('./cookLog');
  const { readTab } = require('./sheets');
  await cookLog.ensureTab(LOTS_TAB, LOT_HEADERS);
  await cookLog.ensureTab(UNTRACKED_TAB, ['Ingredient'], DEFAULT_UNTRACKED.map((n) => [n]));
  const [rows, un] = await Promise.all([readTab(LOTS_TAB), readTab(UNTRACKED_TAB)]);
  const untracked = un.slice(1).map((r) => String(r[0] || '').trim()).filter(Boolean);
  return new LotBook(rows, untracked, today);
}

async function loadUntracked() {
  const cookLog = require('./cookLog');
  const { readTab } = require('./sheets');
  await cookLog.ensureTab(UNTRACKED_TAB, ['Ingredient'], DEFAULT_UNTRACKED.map((n) => [n]));
  return (await readTab(UNTRACKED_TAB)).slice(1).map((r) => String(r[0] || '').trim()).filter(Boolean);
}

// Writes the changes a LotBook run made: remaining quantities, new adjustment lots and the usage trail.
async function saveLotBook(book, usage = []) {
  const cookLog = require('./cookLog');
  const { appendRows, updateRow } = require('./sheets');
  await cookLog.ensureTab(LOTS_TAB, LOT_HEADERS);
  for (const [id] of book.consumed) {
    const lot = book.byId.get(id);
    if (lot && lot.rowIndex) await updateRow(LOTS_TAB, lot.rowIndex, lotRow(lot));
  }
  if (book.added.length) await appendRows(LOTS_TAB, book.added.map((l) => lotRow(l)));
  if (usage.length) {
    await cookLog.ensureTab(USAGE_TAB, USAGE_HEADERS);
    await appendRows(USAGE_TAB, usage);
  }
}

// New purchase lots. items: [{ date, name, qty, unit, price, source }]
async function addLots(items) {
  if (!items.length) return [];
  const cookLog = require('./cookLog');
  const { appendRows } = require('./sheets');
  await cookLog.ensureTab(LOTS_TAB, LOT_HEADERS);
  const lots = items.map((it) => ({ id: newLotId(it.date), name: it.name, date: it.date, source: it.source || 'Receipt', qty: it.qty, unit: baseUnit(it.unit), remaining: it.qty, total: it.price, unitCost: it.price / it.qty, note: it.note || '' }));
  await appendRows(LOTS_TAB, lots.map((l) => lotRow(l)));
  return lots;
}

// "1000g", "2kg", "8pc" -> { qty (g / ml / piece), unit } or null
function toBaseQty(qtyText) { return parsePurchaseUnit(qtyText); }

module.exports = { LotBook, loadLotBook, loadUntracked, saveLotBook, addLots, baseUnit, toBaseQty, DEFAULT_UNTRACKED, LOTS_TAB, USAGE_TAB, UNTRACKED_TAB, LOT_HEADERS, newLotId };
