// Monthly logs (receipts, cooking) with CSV downloads, and the ready to eat stock box.
const { readTab, appendRows } = require('../lib/sheets');
const { ensureTab } = require('../lib/cookLog');
const { bangkokToday, bangkokNow, formatDMY } = require('../lib/dates');
const { BATCH_DISHES } = require('../lib/dishes');
const v = require('../lib/logViews');

const fail = (res, err) => { console.error(err); res.status((err && err.status) || 500).json({ error: String((err && err.message) || err) }); };

// A tab that does not exist yet counts as empty. Any other failure stops with a clear error.
async function readOrEmpty(tab) {
  try { return await readTab(tab); } catch (err) {
    if (/unable to parse range|not found/i.test(String(err && err.message))) return [];
    throw new Error(`Could not read the "${tab}" tab: ${err.message}`);
  }
}

const csvName = (prefix, log) => `${prefix}-${log.month === 'all' ? 'all-months' : log.month}.csv`;
function sendCsv(res, name, headers, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(v.toCsv(headers, rows));
}

async function receiptLog(req) {
  const [expenseRows, overheadRows] = await Promise.all([readOrEmpty('Expense Log'), readOrEmpty('Overheads')]);
  return v.buildReceiptLog({ expenseRows, overheadRows, month: req.query.month, today: bangkokToday() });
}
async function cookLog(req) {
  const [logRows, sizeRows] = await Promise.all([readOrEmpty('Cook Log'), readOrEmpty('Cook Log Sizes')]);
  return v.buildCookLog({ logRows, sizeRows, month: req.query.month, today: bangkokToday() });
}

async function receiptsJson(req, res) { try { res.json(await receiptLog(req)); } catch (err) { fail(res, err); } }
async function receiptsCsv(req, res) {
  try {
    const log = await receiptLog(req);
    if (String(req.query.format || '') === 'pricelog') return sendCsv(res, csvName('price-log', log), v.PRICE_LOG_HEADERS, v.priceLogCsvRows(log));
    sendCsv(res, csvName('receipts', log), v.RECEIPT_CSV_HEADERS, v.receiptCsvRows(log));
  } catch (err) { fail(res, err); }
}

async function cookJson(req, res) { try { res.json(await cookLog(req)); } catch (err) { fail(res, err); } }
async function cookCsv(req, res) {
  try {
    if (String(req.query.detail || '') === '1') {
      const key = v.parseMonth(req.query.month, bangkokToday());
      if (key === null) return res.status(400).json({ error: 'Month must look like 11/2026 or "all".' });
      const lineRows = await readOrEmpty('Cook Log Lines');
      return sendCsv(res, `cook-lines-${key === 'all' ? 'all-months' : key}.csv`, v.COOK_LINES_CSV_HEADERS, v.cookLinesCsvRows({ lineRows, month: key, today: bangkokToday() }));
    }
    const log = await cookLog(req);
    sendCsv(res, csvName('batch-cook', log), v.COOK_CSV_HEADERS, v.cookCsvRows(log));
  } catch (err) { fail(res, err); }
}

// Ready to eat: needs the Ledger (sales) and the Cook Log (batches), the same data as the Home page.
async function readyJson(req, res) {
  try {
    const svc = require('../lib/ledgerService');
    const d = await svc.loadAll();
    const countRows = await readOrEmpty('Ready Counts');
    res.json(v.buildReadyStock({ today: bangkokToday(), ledger: d.ledger, cookBatches: d.cookBatches, countRows }));
  } catch (err) { fail(res, err); }
}

// Body: { dish, count }. Appends a row, so every count stays on record; the latest one for a dish wins.
async function readyCount(req, res) {
  try {
    const dish = String((req.body && req.body.dish) || '').trim();
    const count = Number(req.body && req.body.count);
    if (!dish) return res.status(400).json({ error: 'Send the dish name.' });
    if (!BATCH_DISHES.some(([n]) => n === dish)) return res.status(400).json({ error: `"${dish}" is not one of the batch dishes.` });
    if (!Number.isInteger(count) || count < 0) return res.status(400).json({ error: 'The count must be a whole number of zero or more.' });
    await ensureTab('Ready Counts', v.READY_HEADERS);
    await appendRows('Ready Counts', [[dish, count, formatDMY(bangkokToday()), bangkokNow()]], { raw: true });
    res.json({ dish, count });
  } catch (err) { fail(res, err); }
}

// Weekly Drive export. Manual run: POST /api/export/weekly, body { date?: "DD/MM/YYYY" }. It saves the last finished
// Sunday to Saturday week as of that date (default today), into the same folder the Sunday timer would use.
// The Sunday timer uses sendWeeklyExport, which also tells the BOH LINE group.
async function weeklyExportRoute(req, res) {
  try {
    const { parseDate } = require('../lib/dates');
    const wk = require('../lib/weeklyExport');
    const raw = req.body && req.body.date;
    const day = raw ? parseDate(raw) : bangkokToday();
    if (!day) return res.status(400).json({ error: 'Send a date like 08/11/2026.' });
    const run = await wk.exportWeekly({ end: wk.weekEndFor(day) });
    if (run.busy) return res.status(409).json({ error: 'An export is already running. Try again in a minute.' });
    res.json({ ...run, text: wk.summaryText(run) });
  } catch (err) {
    const setup = /DRIVE_|GOOGLE_|File not found|insufficient|permission|403|404|storage/i.test(String(err.message));
    if (setup) return res.status(503).json({ error: `Drive is not set up for this yet: ${err.message}` });
    fail(res, err);
  }
}
async function sendWeeklyExport(sunday) {
  const { parseDate } = require('../lib/dates');
  const wk = require('../lib/weeklyExport');
  const lineApi = require('../lib/lineApi');
  const run = await wk.exportWeekly({ end: wk.weekEndFor(parseDate(sunday)) });
  if (run.busy) return run;
  const text = wk.summaryText(run);
  const to = process.env.BOH_GROUP_ID;
  const access = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (text && to && access) await lineApi.push(to, text, access);
  if (run.files.some((f) => !f.ok)) throw new Error(text); // so the timer tries again
  return run;
}

module.exports = { weeklyExportRoute, sendWeeklyExport, receiptsJson, receiptsCsv, cookJson, cookCsv, readyJson, readyCount };
