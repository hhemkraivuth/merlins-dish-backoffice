// What is running out. Anything counted at 0 or below 2 is red: it needs filling asap and goes first on the shopping list.
// Works on both kinds of stock: the counted items (cans, bottles, packaging) and the ingredient lots (counted in packs when
// the pack size is known). An ingredient with no pack size is only red when its own "alert below" level says so.
const RED_BELOW = 2;

const isRed = (qty) => Number.isFinite(qty) && qty < RED_BELOW;

// manual: getAllStock() rows. ingredients: the items from ingredientStockItems().
// Returns [{ name, qty, unit, kind, category }] with 0 first, then ascending.
function buildUrgent({ manual = [], ingredients = [] }) {
  const out = [];
  for (const m of manual) {
    if (!isRed(m.currentCount)) continue;
    out.push({ name: m.itemName, qty: m.currentCount, unit: m.unit || '', kind: 'counted', category: m.category || m.guess || '' });
  }
  for (const i of ingredients) {
    const packs = i.pack ? i.pack.packs : null;
    if (packs !== null ? isRed(packs) : i.low) {
      out.push({ name: i.name, qty: packs !== null ? packs : i.left, unit: packs !== null ? i.pack.word : i.unit, kind: 'ingredient', category: 'Ingredients' });
    }
  }
  return out.sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name));
}

// The ingredient lots as the Stock page shows them.
async function ingredientStockItems() {
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
    return { name, left: Math.round(left * 100) / 100, unit, oldest: live.length ? live[0].date : null, low: Boolean(lv && lv.unit === unit && left < lv.qty), level: lv ? lv.text : '', pack: packView(left, unit, sizes.get(normName(name))) };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

async function loadUrgent() {
  const { getAllStock } = require('./stockCounts');
  const [manual, ingredients] = await Promise.all([getAllStock().catch(() => []), ingredientStockItems().catch(() => [])]);
  return buildUrgent({ manual, ingredients });
}

module.exports = { RED_BELOW, isRed, buildUrgent, ingredientStockItems, loadUrgent };
