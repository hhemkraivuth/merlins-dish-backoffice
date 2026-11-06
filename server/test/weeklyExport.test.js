const test = require('node:test');
const assert = require('node:assert');
const wk = require('../lib/weeklyExport');
const { utc } = require('../lib/dates');
const { startWeeklyExportTimer } = require('../lib/scheduler');
const { LEDGER_HEADERS } = require('../lib/ledger');

const sat = utc(2026, 11, 7); // a Saturday, week is Sun 01/11 to Sat 07/11
const data = {
  expenseRows: [['Shopping Date', 'Ingredient', 'Purchase Price', 'Purchase Unit', 'Cost per Recipe Unit', 'Shopped at', 'Remarks'],
    ['31/10/2026', 'Onion', 90, '2000g', 0.045, 'Makro', ''], ['01/11/2026', 'Milk', 99.75, '2000ml', 0.05, 'Makro', ''], ['07/11/2026', 'Pork', 110, '1000g', 0.11, 'Makro', ''], ['08/11/2026', 'Later', 1, '1g', 1, '', '']],
  overheadRows: [['Date', 'Item', 'Category', 'Price', 'Shopped at', 'Remarks'], ['03/11/2026', 'pot', 'equipment', 2575, 'Paragon', '']],
  cookLog: [['Batch Key', 'Date Cooked', 'Dish', 'Yield', 'I', 'P', 'U', 'Total', 'Per'], ['B1', '03/11/2026', 'Noir Ragu', 10, 1, 1, 1, 920, 92], ['B0', '20/10/2026', 'Noir Ragu', 8, 1, 1, 1, 800, 100]],
  cookSizes: [['k', 'd', 'dish', 'Size', 'w', 'Count'], ['B1', '03/11/2026', 'Noir Ragu', 'Regular', 250, 10]],
  cookLines: [['k'], ['B1', '03/11/2026', 'Noir Ragu', 'Ingredient', 'Pork', 1000, 'g', 0.11, '', '', 110], ['B0', '20/10/2026', 'Noir Ragu', 'Ingredient', 'Pork', 900, 'g', 0.11, '', '', 99]],
  ledgerRows: [LEDGER_HEADERS,
    ['01/11/2026', 'Noir Ragu', 'Grab', '', 'Order', 2, 300, 50, 250, 'A', 'G1', '12:00', 'k1', ''],
    ['02/11/2026', 'Noir Ragu', 'LINE', 'Instagram', 'Order', 1, 150, 40, 110, 'B', 'L1', '12:00', 'k2', ''],
    ['03/11/2026', 'Noir Ragu', 'LINE', '', 'Order', 1, 150, 40, 110, 'C', 'L2', '12:00', 'k3', ''],
    ['20/10/2026', 'Old', 'Grab', '', 'Order', 1, 100, 10, 90, 'D', 'G0', '12:00', 'k0', '']],
  noteRows: [['Date', 'Kind', 'Title', 'Note', 'Status'], ['04/11/2026', 'Trend', 'Soup season', 'cold snap', ''], ['10/10/2026', 'Trend', 'Old', 'x', '']],
  weekly: [], monthly: [],
};
const byName = (files, n) => files.find((f) => f.name === n);
const lines = (f) => f.csv.replace('﻿', '').trim().split('\r\n');

test('the week to save is the last finished Sunday to Saturday, and the folder is named for the Sunday it is saved', () => {
  const t = (d) => wk.weekEndFor(d).getTime();
  assert.equal(t(utc(2026, 11, 8)), sat.getTime());  // Sunday: the week that ended yesterday
  assert.equal(t(utc(2026, 11, 7)), utc(2026, 10, 31).getTime()); // Saturday: this week is not finished yet
  assert.equal(t(utc(2026, 11, 11)), sat.getTime()); // Wednesday
  assert.equal(wk.folderNameOf(sat), '08-11');
  assert.equal(wk.savedOn(utc(2026, 12, 26)).getUTCFullYear(), 2026);
  assert.equal(wk.savedOn(utc(2027, 1, 2)).getUTCMonth(), 0);
  assert.equal(wk.windowOf(sat).from.getTime(), utc(2026, 11, 1).getTime()); // Sunday 01/11
});
test('Saturday night shop is in the week, Sunday shop is not', () => {
  const d = { ...data, expenseRows: [data.expenseRows[0], ['07/11/2026', 'Sat night', 50, '1000g', 0.05, 'Makro', ''], ['08/11/2026', 'Sunday shop', 60, '1000g', 0.06, 'Makro', ''], ['31/10/2026', 'Prev Sat', 70, '1000g', 0.07, 'Makro', '']], overheadRows: [data.overheadRows[0]] };
  const rows = lines(byName(wk.buildFiles({ end: sat, data: d }), 'Weekly Receipts.csv'));
  assert.equal(rows.length, 2); assert.match(rows[1], /Sat night/);
});

test('files hold only the 7 days ending on the Saturday', () => {
  const files = wk.buildFiles({ end: sat, data });
  assert.equal(files.length, 8);
  assert.equal(lines(byName(files, 'Weekly Receipts.csv')).length, 1 + 3); // Milk, Pork, pot (not 31/10, not 08/11)
  assert.equal(lines(byName(files, 'Batch Cook.csv')).length, 2);
  assert.equal(lines(byName(files, 'Batch Cook Lines.csv')).length, 2);
  assert.equal(lines(byName(files, 'Numbers Ledger.csv')).length, 1 + 3);
  assert.equal(lines(byName(files, 'Marketing Notes.csv')).length, 2);
  assert.match(lines(byName(files, 'Batch Cook.csv'))[1], /^03\/11\/2026,Noir Ragu,10,Regular x10/);
});

test('marketing sales splits Grab, LINE direct and Instagram', () => {
  const rows = lines(byName(wk.buildFiles({ end: sat, data }), 'Marketing Sales.csv'));
  assert.deepEqual(rows.slice(1), ['Grab,1,300,250', 'LINE direct,1,150,110', 'Instagram,1,150,110']);
});

function fakeDrive() {
  const files = []; let id = 0;
  const q = (s) => ({ parent: s.match(/'([^']+)' in parents/)[1], name: s.match(/name = '([^']+)'/)[1], folder: / = 'application\/vnd.google-apps.folder'/.test(s) });
  return {
    files,
    drive: { files: {
      list: async ({ q: s }) => { const x = q(s); return { data: { files: files.filter((f) => f.parent === x.parent && f.name === x.name && f.folder === x.folder) } }; },
      create: async ({ requestBody: b, media }) => { const f = { id: `f${++id}`, name: b.name, parent: b.parents[0], folder: b.mimeType === 'application/vnd.google-apps.folder', body: media ? 'x' : '' }; files.push(f); return { data: { id: f.id } }; },
      update: async ({ fileId }) => { files.find((f) => f.id === fileId).updated = (files.find((f) => f.id === fileId).updated || 0) + 1; return { data: {} }; },
    } },
  };
}
test('upload makes year/dd-mm folders, and a second run replaces instead of duplicating', async () => {
  const fd = fakeDrive(); const files = wk.buildFiles({ end: sat, data });
  const a = await wk.uploadWeek({ drive: fd.drive, parentId: 'root', end: sat, files });
  assert.equal(a.folder, '2026/08-11'); assert.ok(a.files.every((f) => f.ok && f.action === 'created'));
  const b = await wk.uploadWeek({ drive: fd.drive, parentId: 'root', end: sat, files });
  assert.ok(b.files.every((f) => f.ok && f.action === 'replaced'));
  assert.equal(fd.files.filter((f) => f.folder).length, 2);
  assert.equal(fd.files.filter((f) => !f.folder).length, 8);
  assert.match(wk.summaryText(b), /^Weekly export 08\/11: 8 of 8 files saved to Drive \(01\/11\/2026 to 07\/11\/2026\)\.$/);
});
test('one failing file is reported and the others still upload', async () => {
  const fd = fakeDrive(); const orig = fd.drive.files.create;
  fd.drive.files.create = async (a) => { if (a.requestBody.name === 'Batch Cook.csv') throw new Error('Service Accounts do not have storage quota'); return orig(a); };
  const r = await wk.uploadWeek({ drive: fd.drive, parentId: 'root', end: sat, files: wk.buildFiles({ end: sat, data }), log: { error() {} } });
  assert.equal(r.files.filter((f) => !f.ok).length, 1);
  assert.match(wk.summaryText(r), /Failed: Batch Cook\.csv \(Service Accounts/);
});

// ---- timer ---- (Sunday 08/11/2026 is the day it runs, for the week 01/11 to 07/11)
const bkk = (iso) => Date.parse(iso + 'Z') - 7 * 3600 * 1000; // Bangkok wall clock -> epoch, whatever the machine's timezone
async function timerRuns(at, { last = '', fail = 0 } = {}) {
  process.env.WEEKLY_EXPORT_AUTO = 'on'; delete process.env.WEEKLY_EXPORT_TIME;
  const ran = []; let k = 0; let stored = last; const clock = bkk(at);
  const t = startWeeklyExportTimer(async (d) => { ran.push(d); if (k++ < fail) throw new Error('boom'); }, { now: () => clock, every: 5, log: { log() {}, error() {} }, store: { get: async () => stored, set: async (_, x) => { stored = x; } } });
  await new Promise((r) => setTimeout(r, 40)); clearInterval(t);
  return { ran, stored };
}
test('timer: does nothing on a Saturday, even late', async () => assert.deepEqual((await timerRuns('2026-11-07T23:30:00', { last: '2026-11-01' })).ran, []));
test('timer: not before 20:00 on Sunday', async () => assert.deepEqual((await timerRuns('2026-11-08T19:30:00', { last: '2026-11-01' })).ran, []));
test('timer: runs on Sunday after 20:00 and records it', async () => { const r = await timerRuns('2026-11-08T20:05:00', { last: '2026-11-01' }); assert.deepEqual(r.ran, ['2026-11-08']); assert.equal(r.stored, '2026-11-08'); });
test('timer: does not repeat once saved', async () => assert.deepEqual((await timerRuns('2026-11-08T21:00:00', { last: '2026-11-08' })).ran, []));
test('timer: catches up on Tuesday if Sunday was missed', async () => assert.deepEqual((await timerRuns('2026-11-10T10:00:00', { last: '2026-11-01' })).ran, ['2026-11-08']));
test('timer: a failure is not retried inside 10 minutes and is not recorded', async () => { const r = await timerRuns('2026-11-08T20:05:00', { last: '2026-11-01', fail: 1 }); assert.equal(r.ran.length, 1); assert.equal(r.stored, '2026-11-01'); });
test('timer is off unless WEEKLY_EXPORT_AUTO=on', () => { process.env.WEEKLY_EXPORT_AUTO = ''; assert.equal(startWeeklyExportTimer(async () => {}), null); });
