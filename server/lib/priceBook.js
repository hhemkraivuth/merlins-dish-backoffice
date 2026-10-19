// Date-aware price book.
//
// Built from the live Price Log (Merlin's numbers, read only) plus the Expense Log
// (receipts scanned but not yet copied across). For a cook date, the price used for an
// ingredient is the latest purchase ON OR BEFORE that date. Backfilled rows dated later
// never leak into an earlier batch.

const { parseDate, daysBetween } = require('./dates');

const STALE_DAYS = 45;

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^mutti /, ''); // "Mutti polpa" and "Polpa" are the same ingredient
}

function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const UNIT_FACTORS = {
  g: ['g', 1], gm: ['g', 1], gram: ['g', 1], grams: ['g', 1],
  kg: ['g', 1000],
  ml: ['ml', 1],
  l: ['ml', 1000], ltr: ['ml', 1000], liter: ['ml', 1000], litre: ['ml', 1000],
  p: ['piece', 1], pc: ['piece', 1], pcs: ['piece', 1], piece: ['piece', 1], pieces: ['piece', 1],
  pack: ['piece', 1], packs: ['piece', 1], set: ['piece', 1],
  // things counted by the container: cans, bottles, bags and so on are each one piece
  can: ['piece', 1], cans: ['piece', 1], tin: ['piece', 1], tins: ['piece', 1],
  bottle: ['piece', 1], bottles: ['piece', 1], jar: ['piece', 1], jars: ['piece', 1],
  bag: ['piece', 1], bags: ['piece', 1], box: ['piece', 1], boxes: ['piece', 1],
  sachet: ['piece', 1], sachets: ['piece', 1], carton: ['piece', 1], cartons: ['piece', 1],
  bunch: ['piece', 1], head: ['piece', 1], heads: ['piece', 1], tray: ['piece', 1], trays: ['piece', 1],
  roll: ['piece', 1], rolls: ['piece', 1], loaf: ['piece', 1], loaves: ['piece', 1],
};

// "1000g", "1kg", "2000ml", "8p", "48-pieces" -> { qty (in g/ml/piece), unit } or null
function parsePurchaseUnit(s) {
  const m = String(s || '').trim().match(/^(\d+(?:[.,]\d+)?)\s*-?\s*([a-zA-Z]+)$/);
  if (!m) return null;
  const f = UNIT_FACTORS[m[2].toLowerCase()];
  if (!f) return null;
  return { qty: Number(m[1].replace(',', '.')) * f[1], unit: f[0] };
}

// priceLogRows / expenseRows: 2D arrays as read from the sheets (header row first).
// Columns (both tabs): Date | Ingredient | Purchase Price | Purchase Unit | Cost per Recipe Unit | Shopped at | Remarks
function buildPriceBook({ priceLogRows = [], expenseRows = [], today } = {}) {
  const map = new Map();
  const skipped = { noDate: 0, noCost: 0, inherited: 0 };
  let seq = 0;

  function add(rows, source) {
    // The live Price Log uses one merged date cell per shopping trip, so Google returns the date
    // only on the first row of each trip and blanks below it. A blank date therefore means "same
    // trip as the row above" (Price Log only; receipt rows always carry their own date).
    let lastDate = null;
    rows.forEach((r, i) => {
      if (i === 0 && /date/i.test(String(r[0] || ''))) return; // header
      const rawDate = r[0];
      let date = parseDate(rawDate, today);
      if (date) lastDate = date;
      else if (source === 'Price Log' && (rawDate === undefined || rawDate === null || String(rawDate).trim() === '')) {
        date = lastDate;
        if (date) skipped.inherited++;
      }

      const name = normName(r[1]);
      if (!name) return;
      if (!date) { skipped.noDate++; return; }

      let cost = null;
      if (source === 'Expense Log') {
        // Receipt rows: recompute per g/ml/piece from price and unit rather than trusting
        // the stored column, which may be per kg when the receipt said kg.
        const price = toNumber(r[2]);
        const pu = parsePurchaseUnit(r[3]);
        cost = price !== null && pu && pu.qty > 0 ? price / pu.qty : toNumber(r[4]);
      } else {
        cost = toNumber(r[4]);
      }
      if (cost === null) { skipped.noCost++; return; }

      if (!map.has(name)) map.set(name, []);
      map.get(name).push({ date, cost, source, rowNumber: i + 1, seq: seq++ });
    });
  }

  add(priceLogRows, 'Price Log');
  add(expenseRows, 'Expense Log');
  for (const list of map.values()) list.sort((a, b) => a.date - b.date || a.seq - b.seq);

  function lookup(name, onDate) {
    const list = map.get(normName(name));
    if (!list) return null;
    let idx = -1;
    for (let i = 0; i < list.length; i++) if (list[i].date <= onDate) idx = i;
    if (idx < 0) return { missing: true, earliest: list[0] };

    const chosen = list[idx];
    const prev = idx > 0 ? list[idx - 1] : null;
    const result = {
      cost: chosen.cost,
      date: chosen.date,
      source: chosen.source,
      rowNumber: chosen.rowNumber,
      staleDays: daysBetween(onDate, chosen.date),
    };
    if (result.staleDays > STALE_DAYS) result.stale = true;
    if (prev && prev.cost > 0 && (chosen.cost / prev.cost >= 2 || chosen.cost / prev.cost <= 0.5)) {
      result.jumpFrom = prev.cost;
    }
    return result;
  }

  return { lookup, skipped, size: map.size, names: () => [...map.keys()] };
}

// Unit word -> g / ml / piece (anything not recognised comes back lower cased)
function unitKind(u) {
  const k = String(u || '').trim().toLowerCase();
  return UNIT_FACTORS[k] ? UNIT_FACTORS[k][0] : k;
}

module.exports = { unitKind, UNIT_FACTORS, buildPriceBook, normName, toNumber, parsePurchaseUnit, STALE_DAYS };
