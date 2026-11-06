const { getPlan } = require('../lib/shoppingService');

async function planJson(req, res) {
  try { res.json(await getPlan({ force: String(req.query.refresh || '') === '1' })); }
  catch (err) { console.error(err); res.status(500).json({ error: String((err && err.message) || err) }); }
}
module.exports = { planJson };
