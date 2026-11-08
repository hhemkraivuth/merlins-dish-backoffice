const { getPlan, invalidate } = require('../lib/shoppingService');
const { normName } = require('../lib/priceBook');

async function planJson(req, res) {
  try { res.json(await getPlan({ force: String(req.query.refresh || '') === '1' })); }
  catch (err) { console.error(err); res.status(500).json({ error: String((err && err.message) || err) }); }
}

async function readJson(key, fallback) {
  try { return JSON.parse((await require('../lib/appState').getState(key)) || JSON.stringify(fallback)); } catch (err) { return fallback; }
}

// "Stop buying": the ingredient leaves the plan until it is restored. Recipes, costs and stock are not touched.
async function retire(req, res) {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: 'Send the ingredient name.' });
    const list = (await readJson('plan_retired', [])).filter((n) => normName(n) !== normName(name));
    if (!(req.body && req.body.undo)) list.push(normName(name));
    await require('../lib/appState').setState('plan_retired', JSON.stringify(list));
    invalidate();
    res.json({ ok: true, retired: list });
  } catch (err) { console.error(err); res.status(500).json({ error: String((err && err.message) || err) }); }
}

// Tell the plan which recipe ingredient a counted stock item is. Leave "to" empty to remove the link.
async function linkStockItem(req, res) {
  try {
    const stock = String((req.body && req.body.stock) || '').trim();
    const to = String((req.body && req.body.to) || '').trim();
    if (!stock) return res.status(400).json({ error: 'Send the stock item name.' });
    const links = await readJson('stock_links', {});
    if (to) links[normName(stock)] = to; else delete links[normName(stock)];
    await require('../lib/appState').setState('stock_links', JSON.stringify(links));
    invalidate();
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: String((err && err.message) || err) }); }
}
module.exports = { planJson, retire, linkStockItem };
