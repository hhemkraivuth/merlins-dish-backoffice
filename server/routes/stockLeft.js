const appState = require('../lib/appState');
const bot = require('../lib/botStock');
const store = { get: appState.getState, set: appState.setState };

// Home box: the 03:00 snapshot. ?refresh=1 asks the bot now (still read only).
async function stockLeftJson(req, res) {
  try {
    let snap = await bot.loadSnapshot(store);
    let note = '';
    if (String(req.query.refresh || '') === '1' || !snap) {
      try { snap = await bot.fetchSnapshot(); await bot.saveSnapshot(store, snap); }
      catch (err) { note = err.message; }
    }
    res.json({ snapshot: snap, note });
  } catch (err) { console.error(err); res.status(500).json({ error: String((err && err.message) || err) }); }
}
async function runSnapshot() { const snap = await bot.fetchSnapshot(); await bot.saveSnapshot(store, snap); return snap; }

// Stock left box: the same "left" message as the LINE group. One typed line updates the order app (through its control API)
// and saves BOH's own count for the cooked dishes. Each side answers for itself, so one failing never hides the other.
async function stockLeftSet(req, res) {
  try {
    let text = String((req.body && req.body.text) || '').trim();
    const lead = /^(left|setstock)\b[\s:]*([\s\S]*)$/i.exec(text);
    if (lead) text = lead[2].trim();
    if (!text) return res.status(400).json({ error: 'Type the dishes and counts, for example: tpb 3, bolo 8, noir 0' });
    const out = { text };
    try {
      const { processReadyCount } = require('../lib/readyCount');
      const { bangkokToday } = require('../lib/dates');
      const deps = require('./line').getDefaultDeps();
      const r = await processReadyCount(`left ${text}`, bangkokToday(), deps.waste);
      out.boh = r ? r.join('\n') : 'BOH did not recognise that.';
    } catch (err) { out.boh = `BOH could not save: ${String((err && err.message) || err)}`; out.bohFailed = true; }
    try {
      const r = await require('../lib/botAdmin').act('stock', { text });
      out.bot = r.message;
    } catch (err) { out.bot = `The order app was not updated: ${String((err && err.message) || err)}`; out.botFailed = true; }
    try { const snap = await bot.fetchSnapshot(); await bot.saveSnapshot(store, snap); out.snapshot = snap; } catch (err) { /* the box keeps its old snapshot */ }
    res.json(out);
  } catch (err) { console.error(err); res.status(500).json({ error: String((err && err.message) || err) }); }
}
module.exports = { stockLeftJson, runSnapshot, stockLeftSet };
