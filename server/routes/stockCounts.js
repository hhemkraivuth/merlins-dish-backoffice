const { getAllStock, setStockCount, editStock } = require('../lib/stockCounts');

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
    const { itemName, newCount, unit, category } = req.body;
    if (!itemName || newCount == null) {
      return res.status(400).json({ error: 'itemName and newCount are required' });
    }
    const result = await setStockCount(itemName, Number(newCount), unit, 'Manual', category);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

async function editStockRoute(req, res) {
  try {
    const b = req.body || {};
    if (!b.oldName) return res.status(400).json({ error: 'oldName is required' });
    res.json(await editStock(b));
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
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

// Ingredient stock from the receipts (the stock lots). Counts are corrected from LINE with "count" or from the Stock page in packs.
// Used up ingredients stay in the list at 0 so they show red.
async function listIngredientStock(req, res) {
  try {
    const items = await require('../lib/lowStock').ingredientStockItems();
    const dmy = (d) => { const t = d instanceof Date ? d.toISOString().slice(0, 10) : String(d || ''); const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : t; };
    res.json({ items: items.map((i) => ({ ...i, oldest: dmy(i.oldest) })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// Blends: one recipe ingredient made of two or more stocked ingredients in fixed parts.
async function listBlends(req, res) {
  try {
    const m = await require('../lib/blends').loadBlends();
    res.json({ blends: [...m.values()].map((b) => ({ name: b.name, parts: b.parts.map((p) => ({ name: p.name, parts: p.parts, share: Math.round(p.share * 1000) / 10 })) })) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}
async function saveBlendRoute(req, res) {
  try {
    const b = req.body || {};
    res.json(await require('../lib/blends').saveBlend(b.name, b.parts));
  } catch (err) { console.error(err); res.status(400).json({ error: err.message }); }
}
async function deleteBlendRoute(req, res) {
  try {
    await require('../lib/blends').deleteBlend((req.body || {}).name);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(400).json({ error: err.message }); }
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

module.exports = { listStock, updateStock, editStockRoute, seedPackagingRoute, listIngredientStock, countIngredientPacks, listBlends, saveBlendRoute, deleteBlendRoute };