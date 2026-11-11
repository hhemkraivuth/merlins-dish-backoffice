// Full marketing reports: list, read one, post one (the weekly check posts them here after each run).
const lib = require('../lib/marketingReports');

const fail = (res, err) => { console.error(err); res.status((err && err.status) || 500).json({ error: String((err && err.message) || err) }); };

async function list(req, res) { try { res.json({ reports: await lib.listReports() }); } catch (err) { fail(res, err); } }
async function one(req, res) {
  try {
    const r = await lib.getReport(req.params.slug);
    if (!r) return res.status(404).json({ error: 'That report has not been posted yet.' });
    res.json(r);
  } catch (err) { fail(res, err); }
}
async function save(req, res) { try { res.json(await lib.saveReport(req.body || {})); } catch (err) { fail(res, err); } }

module.exports = { list, one, save };
