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

module.exports = { listStock, updateStock, seedPackagingRoute };
