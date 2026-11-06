const test = require('node:test');
const assert = require('node:assert');
const { rowInRange, cellsFor, ledgerObjects } = require('../lib/ledger');
const { summarise } = require('../lib/reports');
const { utc } = require('../lib/dates');
const svc = require('../lib/ledgerService');
const route = require('../routes/ledger');

const row = (dmy, channel) => [dmy, 'x', channel, '', 'Order', 1, 100, '', 100, '', 'GF-1', '1:00PM', 'G|k|1', ''];

test('rowInRange matches inclusive dates and the chosen channel', () => {
  const from = utc(2026, 9, 8); const to = utc(2026, 9, 30);
  assert.ok(rowInRange(row('08/09/2026', 'Grab'), from, to, 'Grab'));
  assert.ok(rowInRange(row('30/09/2026', 'Grab'), from, to, 'grab'));
  assert.ok(!rowInRange(row('01/10/2026', 'Grab'), from, to, 'Grab'));
  assert.ok(!rowInRange(row('15/09/2026', 'LINE'), from, to, 'Grab'));
  assert.ok(rowInRange(row('15/09/2026', 'LINE'), from, to, 'All'));
  assert.ok(!rowInRange(['not a date'], from, to, 'All'));
});

test('cellsFor writes numbers as numbers, blanks as blanks, and refuses anything else', () => {
  const ok = cellsFor({ desc: ' Noir Ragu ', qty: '2', moneyIn: '110', cost: '', net: '220.5', customer: 'Lily', time: '8:15PM' });
  assert.deepStrictEqual(ok.cells.map((c) => [c.col, c.value]), [[1, 'Noir Ragu'], [5, 2], [6, 110], [7, ''], [8, 220.5], [9, 'Lily'], [11, '8:15PM']]);
  assert.match(cellsFor({ qty: 'two' }).error, /not a number/);
  assert.match(cellsFor({ date: '01/01/2026' }).error, /can't be edited/);
  assert.match(cellsFor({}).error, /Nothing to change/);
});

test('Daily, weekly and monthly lists have no skipped dates', () => {
  const ledger = ledgerObjects([row('01/10/2026', 'Grab'), row('05/10/2026', 'Grab')]);
  const days = summarise(ledger, [], [], 'day');
  assert.deepStrictEqual(days.map((d) => d.key), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
  assert.strictEqual(days[1].grab.orders, 0);
  const upto = summarise(ledger, [], [], 'day', { through: utc(2026, 10, 7) });
  assert.strictEqual(upto.length, 7);
  const weeks = summarise(ledger, [], [utc(2026, 10, 20)].map((date) => ({ date, amount: 1 })), 'week');
  assert.deepStrictEqual(weeks.map((w) => w.key), ['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18']);
  const months = summarise(ledger, [], [{ date: utc(2026, 12, 3), amount: 1 }], 'month');
  assert.deepStrictEqual(months.map((m) => m.key), ['2026-10', '2026-11', '2026-12']);
});

function call(handler, body) {
  return new Promise((resolve) => { const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } }; handler({ body }, res); });
}

test('delete range route checks its input and passes the dry run through', async () => {
  const keep = svc.deleteLedgerRange; const seen = [];
  svc.deleteLedgerRange = async (a) => { seen.push(a); return { count: 3, deleted: a.dryRun ? 0 : 3 }; };
  try {
    assert.strictEqual((await call(route.deleteRange, { from: '08/09/2026' })).code, 400);
    assert.strictEqual((await call(route.deleteRange, { from: '30/09/2026', to: '08/09/2026' })).code, 400);
    assert.strictEqual((await call(route.deleteRange, { from: '08/09/2026', to: '30/09/2026', channel: 'Bot' })).code, 400);
    const peek = await call(route.deleteRange, { from: '08/09/2026', to: '30/09/2026', channel: 'Grab', dryRun: true });
    assert.deepStrictEqual(peek.body, { count: 3, deleted: 0 });
    assert.strictEqual(seen[0].dryRun, true);
    const go = await call(route.deleteRange, { from: '08/09/2026', to: '30/09/2026', channel: 'Grab' });
    assert.strictEqual(go.body.deleted, 3);
  } finally { svc.deleteLedgerRange = keep; }
});
