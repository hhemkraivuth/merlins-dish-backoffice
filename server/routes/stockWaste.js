// Stock page "Waste" form: builds the same line as the LINE command (waste mushroom 500g mould) and runs it through the stock lots.
const { processLots } = require('../lib/lotService');
const { bangkokToday } = require('../lib/dates');

const UNITS = new Set(['g', 'kg', 'ml', 'l', 'pcs']);

async function wasteIngredientRoute(req, res) {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const qty = Number(String(b.qty || '').replace(',', '.'));
    const unit = String(b.unit || 'g').trim().toLowerCase();
    const reason = String(b.reason || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Say which ingredient was thrown away.' });
    if (!(qty > 0)) return res.status(400).json({ error: 'Type how much was thrown away, as a number.' });
    if (!UNITS.has(unit)) return res.status(400).json({ error: 'The unit must be g, kg, ml, l or pcs.' });
    const date = /^\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?$/.test(String(b.date || '').trim()) ? `${String(b.date).trim()} ` : '';
    const text = `waste ${date}${name} ${qty}${unit} ${reason}`.trim();
    const deps = require('./line').getDefaultDeps().lots;
    const r = await processLots(text, bangkokToday(), deps);
    const message = r ? r.join('\n') : 'Nothing was logged.';
    res.json({ ok: /^Logged /.test(message), message });
  } catch (err) { console.error(err); res.status(500).json({ error: String((err && err.message) || err) }); }
}
module.exports = { wasteIngredientRoute };
