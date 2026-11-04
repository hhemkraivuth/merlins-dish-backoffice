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
    const items = book.names().map((name) => {
      const live = book.lotsFor(name).filter((l) => l.remaining > 1e-6);
      if (!live.length) return null;
      const lv = levels.get(normName(name));
      const left = book.totalRemaining(name);
      return { name, left: Math.round(left * 100) / 100, unit: live[0].unit, oldest: live[0].date, low: Boolean(lv && lv.unit === live[0].unit && left < lv.qty), level: lv ? lv.text : '' };
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ items: items.map((i) => ({ ...i, oldest: i.oldest instanceof Date ? i.oldest.toISOString().slice(0, 10) : String(i.oldest || '') })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listStock, updateStock, seedPackagingRoute , listIngredientStock };