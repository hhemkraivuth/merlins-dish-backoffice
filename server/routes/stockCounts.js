const { getAllStock, setStockCount } = require('../lib/stockCounts');

async function listStock(req, res) {
  try {
    const stock = await getAllStock();
    res.json({ stock });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

async function updateStock(req, res) {
  try {
    const { itemName, newCount, unit } = req.body;
    if (!itemName || newCount == null) {
      return res.status(400).json({ error: 'itemName and newCount are required' });
    }
    const result = await setStockCount(itemName, Number(newCount), unit);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

async function seedPackagingRoute(req, res) {
  try {
    const { seedPackaging } = require('../lib/stockService');
    res.json(await seedPackaging({ getAll: getAllStock, setCount: setStockCount }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// Ingredient stock from the receipts (the stock lots), read only. Counts are corrected from LINE with "count".
async function listIngredientStock(req, res) {
  try {
    const { bangkokToday } = require('../lib/dates');
    const lots = require('../lib/ingredientLots');
    const book = await lots.loadLotBook(bangkokToday());
    let levels = new Map();
    try { levels = await require('../lib/reorderLevels').loadLevels(); } catch (err) { /* levels are optional */ }
    const { normName } = require('../lib/priceBook');
    const { loadPackSizes, packView } = require('../lib/packSizes');
    let sizes = new Map();
    try { sizes = await loadPackSizes(); } catch (err) { /* pack sizes are optional */ }
    const items = book.names().map((name) => {
      const live = book.lotsFor(name).filter((l) => l.remaining > 1e-6);
      if (!live.length) return null;
      const lv = levels.get(normName(name));
      const left = book.totalRemaining(name);
      return { name, left: Math.round(left * 100) / 100, unit: live[0].unit, oldest: live[0].date, low: Boolean(lv && lv.unit === live[0].unit && left < lv.qty), level: lv ? lv.text : '', pack: packView(left, live[0].unit, sizes.get(normName(name))) };
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ items: items.map((i) => ({ ...i, oldest: (() => { const t = i.oldest instanceof Date ? i.oldest.toISOString().slice(0, 10) : String(i.oldest || ''); const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : t; })() })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// Recount one ingredient in packs (cans, bags, bottles). Same correction as "count" in LINE, but typed as a pack number.
// Body: { name, packs, size?, word? }. size ("330ml") and word ("can") are only needed the first time, and are saved to Pack Sizes.
async function countIngredientPacks(req, res) {
  try {
    const { name, packs, size, word, base } = req.body || {};
    const n = Number(packs);
    if (!name || (base == null && (!Number.isFinite(n) || n < 0))) return res.status(400).json({ error: 'Send the ingredient name and a pack count of zero or more.' });
    const { bangkokToday } = require('../lib/dates');
    const lots = require('../lib/ingredientLots');
    const { normName } = require('../lib/priceBook');
    const ps = require('../lib/packSizes');
    const today = bangkokToday();
    const book = await lots.loadLotBook(today);
    const have = book.lotsFor(name);
    if (!have.length) return res.status(400).json({ error: `${name} has no stock lots yet.` });
    const unit = have[0].unit;
    if (base != null) {
      const b = Number(base);
      if (!Number.isFinite(b) || b < 0) return res.status(400).json({ error: `Send ${unit} as a number of zero or more.` });
      const r0 = book.countTo(name, b, today);
      await lots.saveLotBook(book, []);
      return res.json({ name: r0.name, before: r0.before, after: r0.after, unit: r0.unit });
    }
    let entry = (await ps.loadPackSizes()).get(normName(name));
    if (size) {
      const base = lots.toBaseQty(String(size).replace(/\s+/g, ''));
      if (!base || base.unit !== unit) return res.status(400).json({ error: `${name} is counted in ${unit}, so the size of one pack needs to be in ${unit}, for example 330${unit}.` });
      const w = String(word || '').trim().toLowerCase().replace(/[^a-z]/g, '') || 'pack';
      await ps.setPackSize(name, `${base.qty}${base.unit}`, w);
      entry = { name, qty: base.qty, unit: base.unit, text: `${base.qty}${base.unit}`, word: w };
    }
    if (!entry) return res.status(400).json({ error: 'Set the size of one pack first, for example 330ml and the word can.' });
    if (entry.unit !== unit) return res.status(400).json({ error: `${name} is counted in ${unit} but its pack size is in ${entry.unit}.` });
    const r = book.countTo(name, ps.packsToBase(n, entry), today);
    await lots.saveLotBook(book, []);
    res.json({ name: r.name, before: r.before, after: r.after, unit: r.unit, pack: ps.packView(r.after, r.unit, entry) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listStock, updateStock, seedPackagingRoute, listIngredientStock, countIngredientPacks };