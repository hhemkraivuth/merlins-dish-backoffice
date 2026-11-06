// Weekly export to Google Drive. Every Sunday the app saves the week just finished (Sunday to Saturday) as CSV files:
//
//   <DRIVE_WEEKLY_FOLDER_ID>/2026/08-11/   (year folder, then a dd-mm folder named for the Sunday it was saved)
//   for example 08-11 holds Sunday 01/11 to Saturday 07/11. A Saturday night shop is in that week;
//   anything bought on the Sunday itself belongs to the next week.
//     Weekly Receipts.csv        Receipts page: every item bought in the week (ingredients, overheads, ads)
//     Batch Cook.csv             Batch Cook page: one row per batch cooked in the week
//     Batch Cook Lines.csv       every ingredient / packaging / utility line of those batches
//     Marketing Sales.csv        Marketing page: orders and money by Grab, LINE and Instagram
//     Marketing Notes.csv        Marketing page: notes logged in the week
//     Numbers Ledger.csv         Numbers page: every Ledger row dated in the week
//     Numbers Weekly Report.csv  Numbers page: the weekly table as it stood when saved
//     Numbers Monthly Report.csv Numbers page: the monthly table as it stood when saved
//
// A week is Sunday to Saturday, so no day is missed or counted twice.
// A folder uses a dash, not a slash, because "/" breaks file names once downloaded.
// Running it again for the same day replaces the files, never duplicates them.
//
// Needs DRIVE_WEEKLY_FOLDER_ID, shared with the service account as Editor. WEEKLY_EXPORT_AUTO=on turns the timer on.

const { Readable } = require('stream');
const { parseDate, formatDMY } = require('./dates');
const v = require('./logViews');
const { LEDGER_TAB, LEDGER_HEADERS, COL, num, ledgerObjects } = require('./ledger');
const { REPORT_HEADERS, reportRows } = require('./reports');
const marketingLib = require('./marketing');

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

// The Saturday on or before `today` (a midnight UTC Date).
function lastSaturday(today) {
  return new Date(today.getTime() - ((today.getUTCDay() + 1) % 7) * DAY);
}
// The last finished Sunday to Saturday week as of `today`: its Saturday. On a Sunday that is yesterday.
const weekEndFor = (today) => lastSaturday(new Date(today.getTime() - DAY));
const windowOf = (end) => ({ from: new Date(end.getTime() - 6 * DAY), to: end });
// The Sunday after the week ends, which is the day it is saved. It names the year folder and the dd-mm folder.
const savedOn = (end) => new Date(end.getTime() + DAY);
const folderNameOf = (end) => { const d = savedOn(end); return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}`; };
const inWindow = (date, w) => !!date && date.getTime() >= w.from.getTime() && date.getTime() <= w.to.getTime();
const blank = (x) => (x === null || x === undefined ? '' : x);

// data: the raw tab rows (header first) and the two report tables. Returns [{ name, csv, rows }].
function buildFiles({ end, data }) {
  const w = windowOf(end);
  const files = [];
  const add = (name, headers, rows) => files.push({ name, rows: rows.length, csv: v.toCsv(headers, rows) });

  add('Weekly Receipts.csv', v.RECEIPT_CSV_HEADERS,
    v.receiptItems(data.expenseRows, data.overheadRows).filter((x) => inWindow(x.date, w))
      .map((x) => [formatDMY(x.date), x.type, x.item, x.qty, x.price, blank(x.perUnit), x.shop, x.category, x.remarks]));

  const batches = v.cookItems(data.cookLog, data.cookSizes).filter((x) => inWindow(x.date, w));
  add('Batch Cook.csv', v.COOK_CSV_HEADERS,
    batches.map((x) => [formatDMY(x.date), x.dish, x.portions, x.sizes, x.ingredients, x.packaging, x.utility, x.total, blank(x.perPortion), x.flags, x.key]));
  const keys = new Set(batches.map((b) => b.key));
  add('Batch Cook Lines.csv', v.COOK_LINES_CSV_HEADERS,
    (data.cookLines || []).slice(1).filter((r) => keys.has(r[0]) && inWindow(parseDate(r[1]), w))
      .map((r) => [formatDMY(parseDate(r[1])), r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[10], r[0]]));

  const ledger = ledgerObjects(data.ledgerRows).filter((r) => inWindow(r.date, w));
  const channel = (label, pick) => {
    const mine = ledger.filter(pick);
    const orders = new Set(mine.filter((r) => r.type === 'Order').map((r) => r.orderNo || `${r.dmy}|${r.customer}`));
    const sum = (f) => Math.round(mine.reduce((s, r) => s + (f(r) || 0), 0) * 100) / 100;
    return [label, orders.size, sum((r) => (r.type === 'Order' ? r.moneyIn : 0)), sum((r) => r.net)];
  };
  const isIg = (r) => r.channel === 'LINE' && /^instagram$/i.test(r.orderFrom);
  add('Marketing Sales.csv', ['Channel', 'Orders', 'Money in (orders)', 'Net income (all rows)'], [
    channel('Grab', (r) => r.channel === 'Grab'),
    channel('LINE direct', (r) => r.channel === 'LINE' && !isIg(r)),
    channel('Instagram', isIg),
  ]);
  add('Marketing Notes.csv', marketingLib.HEADERS,
    (data.noteRows || []).slice(1).filter((r) => r && (r[2] || r[3]) && inWindow(parseDate(r[0]), w)).map((r) => marketingLib.HEADERS.map((_, i) => blank(r[i]))));

  add('Numbers Ledger.csv', LEDGER_HEADERS,
    (data.ledgerRows || []).filter((r) => { const d = parseDate(r[COL.date]); return inWindow(d, w); }).map((r) => LEDGER_HEADERS.map((_, i) => blank(r[i]))));
  add('Numbers Weekly Report.csv', REPORT_HEADERS, reportRows(data.weekly || []));
  add('Numbers Monthly Report.csv', REPORT_HEADERS, reportRows(data.monthly || []));
  return files;
}

// ---- Drive -----------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const FOLDER = 'application/vnd.google-apps.folder';

async function findChild(drive, parentId, name, folder) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and trashed = false and name = '${esc(name)}' and mimeType ${folder ? '=' : '!='} '${FOLDER}'`,
    fields: 'files(id, name)', pageSize: 5, supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  return (res.data.files || [])[0] || null;
}
async function ensureFolder(drive, parentId, name) {
  const found = await findChild(drive, parentId, name, true);
  if (found) return found.id;
  const res = await drive.files.create({ requestBody: { name, mimeType: FOLDER, parents: [parentId] }, fields: 'id', supportsAllDrives: true });
  return res.data.id;
}
async function upsertCsv(drive, folderId, name, csv) {
  const media = { mimeType: 'text/csv', body: Readable.from([Buffer.from(csv, 'utf8')]) };
  const found = await findChild(drive, folderId, name, false);
  if (found) { await drive.files.update({ fileId: found.id, media, fields: 'id', supportsAllDrives: true }); return 'replaced'; }
  await drive.files.create({ requestBody: { name, parents: [folderId] }, media, fields: 'id', supportsAllDrives: true });
  return 'created';
}

// drive is passed in so tests run without Google. A file that fails is reported and the rest still go up.
async function uploadWeek({ drive, parentId, end, files, log = console }) {
  const yearId = await ensureFolder(drive, parentId, String(savedOn(end).getUTCFullYear()));
  const weekId = await ensureFolder(drive, yearId, folderNameOf(end));
  const results = [];
  for (const f of files) {
    try { results.push({ name: f.name, rows: f.rows, ok: true, action: await upsertCsv(drive, weekId, f.name, f.csv) }); }
    catch (err) { log.error(`Weekly export: ${f.name} failed:`, err.message); results.push({ name: f.name, rows: f.rows, ok: false, error: err.message }); }
  }
  return { folder: `${savedOn(end).getUTCFullYear()}/${folderNameOf(end)}`, window: `${formatDMY(windowOf(end).from)} to ${formatDMY(end)}`, files: results };
}

let running = false;

// The real run. end: the Saturday that closes the week to save (a midnight UTC Date). Default: the last finished week.
async function exportWeekly({ end } = {}) {
  if (running) return { busy: true, files: [] };
  running = true;
  try {
    const parentId = String(process.env.DRIVE_WEEKLY_FOLDER_ID || '').trim();
    if (!parentId) throw new Error('Set DRIVE_WEEKLY_FOLDER_ID in Railway first (the Drive folder, shared with the service account as Editor).');
    const { bangkokToday } = require('./dates');
    const day = end || weekEndFor(bangkokToday());
    const svc = require('./ledgerService');
    const d = await svc.loadAll();
    const reports = await svc.computeReports(d);
    const [expenseRows, overheadRows, cookLog, cookSizes, cookLines, ledgerRows, noteRows] = await Promise.all([
      svc.readOrEmpty('Expense Log'), svc.readOrEmpty('Overheads'), svc.readOrEmpty('Cook Log'), svc.readOrEmpty('Cook Log Sizes'),
      svc.readOrEmpty('Cook Log Lines'), svc.readOrEmpty(LEDGER_TAB), svc.readOrEmpty(marketingLib.TAB),
    ]);
    const files = buildFiles({ end: day, data: { expenseRows, overheadRows, cookLog, cookSizes, cookLines, ledgerRows, noteRows, weekly: reports.weekly, monthly: reports.monthly } });
    return await uploadWeek({ drive: require('./driveImport').driveClient(), parentId, end: day, files });
  } finally { running = false; }
}

// One short message for the BOH LINE group.
function summaryText(run) {
  if (!run || run.busy) return '';
  const bad = run.files.filter((f) => !f.ok);
  const head = `Weekly export ${run.folder.split('/')[1].replace('-', '/')}: ${run.files.length - bad.length} of ${run.files.length} files saved to Drive (${run.window}).`;
  return bad.length ? `${head}\nFailed: ${bad.map((f) => `${f.name} (${f.error})`).join('; ')}` : head;
}

module.exports = { buildFiles, uploadWeek, exportWeekly, summaryText, lastSaturday, weekEndFor, savedOn, windowOf, folderNameOf };
