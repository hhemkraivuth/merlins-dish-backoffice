// What is running out. Anything counted at 0 or below 2 is red: it needs filling asap and goes first on the shopping list.
// Works on both kinds of stock: the counted items (cans, bottles, packaging) and the ingredient lots (counted in packs when
// the pack size is known). An ingredient with no pack size is only red when its own "alert below" level says so.
const RED_BELOW = 2;

const isRed = (qty) => Number.isFinite(qty) && qty < RED_BELOW;

// ---- how long it will last --------------------------------------------------------------------------------
// A bottle of pepper at "1" is fine if it is 450g and you use 20g a week. So for anything whose use is known from the batches,
// red means "less than RED_DAYS of cooking left", not "fewer than 2 packs". Use is the average over the last USE_DAYS days
// of the Cook Log Lines, matched on the ingredient name with any (brand) or (size) in brackets removed.
const RED_DAYS = Number(process.env.STOCK_RED_DAYS) || 7;
const USE_DAYS = 28;
const { normName } = require('./priceBook');
const baseKey = (name) => normName(String(name || '').replace(/\s*\([^)]*\)\s*/g, ' '));

// "Black Pepper (450g)" -> { qty: 450, unit: 'g' }. Only a size in brackets counts.
function sizeFromName(name) {
  const m = String(name || '').match(/\(\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gm|ml|l|ltr)\s*\)/i);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.')); const u = m[2].toLowerCase();
  return u === 'kg' ? { qty: n * 1000, unit: 'g' } : u === 'l' || u === 'ltr' ? { qty: n * 1000, unit: 'ml' } : { qty: n, unit: u === 'gm' ? 'g' : u };
}

// usage: Map(baseKey|unit -> perDay). Returns days of cooking left, or null when the use or the amount is not known.
function daysLeft({ name, count, unit, usage, size }) {
  if (!usage || !usage.size) return null;
  const sz = size || sizeFromName(name);
  const tries = [];
  if (sz) tries.push([count * sz.qty, sz.unit]);
  const u = String(unit || '').toLowerCase();
  if (['g', 'ml'].includes(u)) tries.push([count, u]);
  if (!sz && !['g', 'ml'].includes(u)) tries.push([count, 'piece']);
  for (const [qty, un] of tries) {
    const perDay = usage.get(`${baseKey(name)}|${un}`);
    if (perDay > 0) return qty / perDay;
  }
  return null;
}

// Red when there is none, or when the use is known and it will not last RED_DAYS. With no use known, the old rule stands for
// cans, drinks and packaging (below 2). An ingredient with no use known is only red at 0 (or at its own alert level).
function statusOf({ count, days, category, low, belowBatch }) {
  if (!(count > 0)) return true;
  if (belowBatch) return true; // bagged meat: not enough together for one batch
  if (days !== null && days !== undefined) return days < RED_DAYS;
  if (low) return true;
  return category === 'Ingredients' || category === 'Meat' ? false : isRed(count);
}

// manual: getAllStock() rows. ingredients: ingredientStockItems(). usage: from loadUsage().
// Returns [{ name, qty, unit, kind, category, daysLeft }] with the soonest to run out first.
function buildUrgent({ manual = [], ingredients = [], usage = null, bags = {} }) {
  const out = [];
  const { normName } = require('./priceBook');
  const baseOf = (n) => normName(String(n || '').replace(/\s*\([^)]*\)\s*/g, ' '));
  const bagged = new Set(Object.keys(bags).map((k) => baseOf(k)));
  for (const m of manual) {
    const category = m.category || m.guess || '';
    const days = daysLeft({ name: m.itemName, count: m.currentCount, unit: m.unit, usage });
    const bg = bags[normName(m.itemName)];
    if (statusOf({ count: m.currentCount, days, category, belowBatch: Boolean(bg && bg.batch > 0 && m.currentCount < bg.batch) })) out.push({ name: m.itemName, qty: m.currentCount, unit: m.unit || '', kind: 'counted', category, daysLeft: days });
  }
  for (const i of ingredients) {
    if (bagged.has(baseOf(i.name))) continue; // bagged meat is counted as one item in grams
    const packs = i.pack ? i.pack.packs : null;
    const days = i.daysLeft !== undefined ? i.daysLeft : daysLeft({ name: i.name, count: i.left, unit: i.unit, usage });
    if (statusOf({ count: i.left, days, category: 'Ingredients', low: i.low })) out.push({ name: i.name, qty: packs !== null ? packs : i.left, unit: packs !== null ? i.pack.word : i.unit, kind: 'ingredient', category: 'Ingredients', daysLeft: days });
  }
  const d = (x) => (x.daysLeft === null || x.daysLeft === undefined ? 1e9 : x.daysLeft);
  return out.sort((a, b) => (a.qty === 0 ? -1 : 0) - (b.qty === 0 ? -1 : 0) || d(a) - d(b) || a.qty - b.qty || a.name.localeCompare(b.name));
}

// Average use per day over the last USE_DAYS days, from the Cook Log Lines.
function usageFromLines({ log = [], sizes = [], lines = [], today, days = USE_DAYS }) {
  const { cookItems } = require('./logViews');
  const { UNIT_FACTORS, toNumber } = require('./priceBook');
  const since = new Date(today.getTime() - days * 86400000);
  const batches = new Map(cookItems(log, sizes).filter((b) => b.date >= since && b.date <= today).map((b) => [b.key, b]));
  const total = new Map();
  for (const r of lines.slice(1)) {
    if (!batches.has(String(r[0]))) continue;
    const kind = String(r[3] || '').trim();
    if (kind !== 'Ingredient' && kind !== 'Packaging') continue;
    const qty = toNumber(r[5]);
    const name = String(r[4] || '').trim();
    if (!name || !qty || qty <= 0) continue;
    const f = UNIT_FACTORS[String(r[6] || '').trim().toLowerCase()];
    const base = f ? { qty: qty * f[1], unit: f[0] } : { qty, unit: 'piece' };
    const k = `${baseKey(name)}|${base.unit}`;
    total.set(k, (total.get(k) || 0) + base.qty);
  }
  const out = new Map();
  for (const [k, v] of total) out.set(k, v / days);
  return out;
}

async function loadUsage(today) {
  const { readTab } = require('./sheets');
  const own = async (t) => { try { return await readTab(t); } catch (err) { return []; } };
  const [log, sizes, lines] = await Promise.all([own('Cook Log'), own('Cook Log Sizes'), own('Cook Log Lines')]);
  return usageFromLines({ log, sizes, lines, today });
}

// The ingredient lots as the Stock page shows them.
async function ingredientStockItems(usage = null) {
  const { bangkokToday } = require('./dates');
  const lots = require('./ingredientLots');
  const { normName } = require('./priceBook');
  const { loadPackSizes, packView } = require('./packSizes');
  const book = await lots.loadLotBook(bangkokToday());
  let levels = new Map();
  try { levels = await require('./reorderLevels').loadLevels(); } catch (err) { /* levels are optional */ }
  let sizes = new Map();
  try { sizes = await loadPackSizes(); } catch (err) { /* pack sizes are optional */ }
  return book.names().map((name) => {
    const live = book.lotsFor(name).filter((l) => l.remaining > 1e-6);
    const all = book.lotsFor(name);
    const lv = levels.get(normName(name));
    // Used up completely: stays in the list at 0 (red) only when Lily tracks it, meaning it has a pack size or an alert level.
    // Otherwise a one off buy would sit at 0 for ever.
    if (!live.length && !lv && !sizes.get(normName(name))) return null;
    const unit = (live[0] || all[0]).unit;
    const left = book.totalRemaining(name);
    return { name, left: Math.round(left * 100) / 100, unit, oldest: live.length ? live[0].date : null, low: Boolean(lv && lv.unit === unit && left < lv.qty), level: lv ? lv.text : '', pack: packView(left, unit, sizes.get(normName(name))), daysLeft: daysLeft({ name, count: left, unit, usage }) };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

async function loadUrgent() {
  const { getAllStock } = require('./stockCounts');
  const { bangkokToday } = require('./dates');
  const usage = await loadUsage(bangkokToday()).catch(() => null);
  const [manual, ingredients] = await Promise.all([getAllStock().catch(() => []), ingredientStockItems(usage).catch(() => [])]);
  let bags = {}; try { bags = await require('./stockBags').load(); } catch (err) { bags = {}; }
  return buildUrgent({ manual, ingredients, usage, bags });
}

module.exports = { RED_BELOW, RED_DAYS, isRed, statusOf, daysLeft, sizeFromName, baseKey, usageFromLines, loadUsage, buildUrgent, ingredientStockItems, loadUrgent };
