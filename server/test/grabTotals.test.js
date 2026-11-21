const test = require('node:test');
const assert = require('node:assert');
const { parseTotalsCsv, importTotals, checkTotals, totalsFrom } = require('../lib/grabTotals');
const { runChecks } = require('../lib/audit');

const d = (s) => new Date(`${s}T00:00:00Z`);
const row = (o) => ({ date: d('2026-11-19'), channel: 'Grab', type: 'Order', qty: 1, moneyIn: 0, net: 0, orderNo: '', ...o });
const CSV = '﻿Date,Orders,Gross,Store promo,Commission,Marketing fee,Net,Advertising fee\n19/11/2026,2,300,-30,-81,-9,180,40\n';
const good = [
  row({ moneyIn: 200, net: 200, orderNo: 'GF-1' }), row({ type: 'Grab', desc: 'Order commission', net: -54 }),
  row({ moneyIn: 100, net: 100, orderNo: 'GF-2' }), row({ type: 'Grab', desc: 'Merchant funded discount', net: -30 }), row({ type: 'Grab', desc: 'Order commission', net: -27 }), row({ type: 'Grab', desc: 'Marketing success fee', net: -9 }),
];

test('the totals CSV is read, with its BOM and columns in any order', () => {
  const r = parseTotalsCsv(CSV);
  assert.strictEqual(r.rows.length, 1);
  assert.deepStrictEqual([r.rows[0].orders, r.rows[0].gross, r.rows[0].net, r.rows[0].adFee], [2, 300, 180, 40]);
  assert.match(parseTotalsCsv('Date,Foo\n1/1/2026,2')[0 ] ? '' : parseTotalsCsv('Date,Foo\n1/1/2026,2').problems[0], /Gross and Net/);
});

test('a matching day raises nothing, a mismatched day says what differs', () => {
  const t = parseTotalsCsv(CSV).rows;
  assert.strictEqual(checkTotals(good, t).length, 0);
  const bad = checkTotals(good.slice(0, 5), t);
  assert.strictEqual(bad.length, 1);
  assert.strictEqual(bad[0].dNet, 9);
  const f = runChecks({ today: d('2026-11-21'), ledger: good.slice(0, 5), grabTotals: t }).filter((x) => x.check === 'Grab totals');
  assert.match(f[0].line, /Grab 19\/11\/2026.*net ฿189 against ฿180/);
});

test('a PDF day with no Ledger rows is flagged, and a re-sent day replaces its row', async () => {
  const t = parseTotalsCsv(CSV).rows;
  assert.ok(checkTotals([], t)[0].missing);
  const tab = []; let deleted = 0;
  const deps = { ensureTab: async () => {}, appendRows: async (_n, r) => tab.push(...r), deleteRowsWhere: async (_n, p) => { deleted += tab.filter((r) => p(r)).length; } };
  const out = await importTotals(CSV, deps);
  assert.strictEqual(out.imported, 1);
  assert.strictEqual(totalsFrom([['Date'], ...tab]).length, 1);
  assert.deepStrictEqual(out.days, ['19/11/2026']);
});
