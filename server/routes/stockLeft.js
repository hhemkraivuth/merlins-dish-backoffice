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
module.exports = { stockLeftJson, runSnapshot };
