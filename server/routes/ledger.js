// Web routes for the Ledger, reports and huddle. The nightly timer and the LINE group use the same functions.

const svc = require('../lib/ledgerService');
const lineApi = require('../lib/lineApi');
const { formatDMY, parseDate } = require('../lib/dates');
const { withHistory } = require('../lib/history');

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

async function manualOrders(req, res) {
  try {
    const text = req.body && req.body.text;
    if (!String(text || '').trim()) return res.status(400).json({ error: 'Nothing was typed.' });
    const out = await svc.addManualOrders(text);
    if (!out.added.length && !out.skipped.length) return res.status(400).json({ error: out.problems[0] || 'No orders could be read.', ...out });
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
    const { daily, weekly, monthly } = await svc.computeReports();
    res.json({ daily: (daily || []).map(shape), weekly: weekly.map(shape), monthly: monthly.map(shape), profit: withHistory(monthly).map(shape) });
  } catch (err) { fail(res, err); }
}

// One day, like a Master Log page. Called by the Reports page when a row is clicked: /api/reports/day?date=DD/MM/YYYY
async function day(req, res) {
  try {
    const date = parseDate(req.query && req.query.date);
    if (!date) return res.status(400).json({ error: 'Send a date like 04/11/2026.' });
    const to = req.query && req.query.to ? parseDate(req.query.to) : null;
    if (req.query && req.query.to && !to) return res.status(400).json({ error: 'The end date was not a date.' });
    res.json(await svc.dayDetailFor(date, to));
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


// Delete a date range of Ledger rows. Body: { from: "08/09/2026", to: "30/09/2026", channel: "Grab"|"LINE"|"All", dryRun: true|false }
async function deleteRange(req, res) {
  try {
    const b = req.body || {};
    const from = parseDate(b.from); const to = parseDate(b.to);
    if (!from || !to) return res.status(400).json({ error: 'Send both dates like 08/09/2026.' });
    if (to.getTime() < from.getTime()) return res.status(400).json({ error: 'The end date is before the start date.' });
    const channel = ['all', 'grab', 'line'].includes(String(b.channel || 'all').toLowerCase()) ? b.channel || 'All' : null;
    if (!channel) return res.status(400).json({ error: 'Channel must be Grab, LINE or All.' });
    res.json(await svc.deleteLedgerRange({ from, to, channel, dryRun: !!b.dryRun }));
  } catch (err) { fail(res, err); }
}

async function deleteRow(req, res) {
  try { res.json(await svc.deleteLedgerRow(req.body && req.body.key)); } catch (err) { fail(res, err); }
}

async function updateRow(req, res) {
  try { res.json(await svc.updateLedgerRow(req.body && req.body.key, req.body && req.body.changes)); }
  catch (err) { const bad = /not a number|can't be edited|Nothing to change|No row key/.test(String(err.message)); if (bad) return res.status(400).json({ error: err.message }); fail(res, err); }
}

module.exports = { manualOrders, deleteRange, deleteRow, updateRow, importGrab, syncLine, refresh, summary, day, runHuddle, sendHuddle };
