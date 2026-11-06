const { bangkokToday } = require('../lib/dates');
const { buildAnalysis } = require('../lib/analysis');

// The Master Log (Merlin's numbers, read only) holds the history from the first order. A failure is reported on the page, not hidden.
async function analysisJson(req, res) {
  try {
    const svc = require('../lib/ledgerService');
    const d = await svc.loadAll();
    const { weekly, monthly } = await svc.computeReports(d);
    const warnings = [];
    let master = [];
    try { master = await require('../lib/liveSheet').readLiveRange('Master Log', 'A:K'); }
    catch (err) { warnings.push(`Could not read the Master Log (${err.message}), so the history to September is missing.`); }
    const out = buildAnalysis({ weekly, monthly, ledger: d.ledger, today: bangkokToday(), master, cookBatches: d.cookBatches, expense: d.expense });
    out.warnings = warnings;
    res.json(out);
  } catch (err) { console.error(err); res.status(500).json({ error: String((err && err.message) || err) }); }
}
module.exports = { analysisJson };
