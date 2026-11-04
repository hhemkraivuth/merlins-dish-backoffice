// Web routes for the Ledger, reports and huddle. The nightly timer and the LINE group use the same functions.

const svc = require('../lib/ledgerService');
const lineApi = require('../lib/lineApi');
const { formatDMY } = require('../lib/dates');

const fail = (res, err) => { console.error(err); res.status(500).json({ error: String((err && err.message) || err) }); };

// Upload the Grab CSV (form field "csv") or post JSON { csv: "..." }.
async function importGrab(req, res) {
  try {
    const text = req.file ? req.file.buffer.toString('utf8') : (req.body && req.body.csv);
    if (!text) return res.status(400).json({ error: 'No CSV received.' });
    const out = await svc.importGrabCsv(text);
    if (!out.imported) return res.status(400).json({ error: out.problems[0] || 'Nothing could be read from that file.', ...out });
    res.json(out);
  } catch (err) { fail(res, err); }
}

async function syncLine(req, res) {
  try { res.json(await svc.syncLineOrders()); } catch (err) { fail(res, err); }
}

async function refresh(req, res) {
  try { res.json(await svc.refreshReports()); } catch (err) { fail(res, err); }
}

const shape = (p) => ({ ...p, from: formatDMY(p.from), to: formatDMY(p.to) });
async function summary(req, res) {
  try {
    const { weekly, monthly } = await svc.computeReports();
    res.json({ weekly: weekly.map(shape), monthly: monthly.map(shape) });
  } catch (err) { fail(res, err); }
}

// Triggered by the nightly timer, a Railway cron, or a scheduled task. Needs HUDDLE_TOKEN.
async function runHuddle(req, res) {
  try {
    const token = process.env.HUDDLE_TOKEN;
    if (!token) return res.status(503).json({ error: 'HUDDLE_TOKEN is not set.' });
    if (req.get('x-huddle-token') !== token) return res.status(401).json({ error: 'Wrong token.' });
    res.json(await sendHuddle());
  } catch (err) { fail(res, err); }
}

async function sendHuddle() {
  const { text } = await svc.huddle();
  const to = process.env.BOH_GROUP_ID;
  const access = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (to && access) await lineApi.push(to, text, access);
  return { sent: Boolean(to && access), text };
}

module.exports = { importGrab, syncLine, refresh, summary, runHuddle, sendHuddle };
