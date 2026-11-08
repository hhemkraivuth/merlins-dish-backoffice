// Monthly overheads: dollars stay dollars, "monthly" repeats on the 1st, nothing logs twice.
const test = require('node:test');
const assert = require('node:assert');
const { overheadItem, splitOverheads, overheadRows } = require('../lib/overheads');
const r = require('../lib/recurringOverheads');
const { toBaht } = require('../lib/usdRate');
const { utc, formatDMY } = require('../lib/dates');

test('dollar amounts and the monthly word are read', () => {
  assert.deepEqual(overheadItem('Railway 5usd'), { name: 'Railway', price: null, usd: 5, repeat: false });
  assert.deepEqual(overheadItem('railway, $5 monthly'), { name: 'railway', price: null, usd: 5, repeat: true });
  assert.deepEqual(overheadItem('freezer, 135 thb every month'), { name: 'freezer', price: 135, repeat: true });
  assert.equal(overheadItem('pot 7lt, 2575thb').repeat, false);
});

test('the dollar amount is kept in the Remarks beside the baht', () => {
  const sp = splitOverheads('09/11\noverhead\nRailway 5usd, monthly', utc(2026, 11, 9));
  assert.equal(sp.problems.length, 0);
  const it = sp.items[0]; it.rate = 33.2; it.price = toBaht(it.usd, it.rate);
  const row = overheadRows([it], 'R1')[0];
  assert.equal(row[3], 166);
  assert.match(row[5], /USD 5\.00 at 33\.2; Repeats monthly; Receipt R1/);
});

test('a monthly item logs once on the 1st, never twice, and dollars are reconverted each month', async () => {
  let list = r.addItem([], { name: 'Railway', usd: 5 }, utc(2026, 11, 9)).list;
  const rows = []; let rate = 33.2;
  const deps = { appendOverheads: async (x) => rows.push(...x), getRate: async () => ({ rate }), save: async (n) => { list = n; } };
  assert.equal((await r.runDue(list, utc(2026, 11, 20), deps)).logged.length, 0); // November was logged when typed
  assert.equal((await r.runDue(list, utc(2026, 12, 1), deps)).logged.length, 1);
  assert.equal(rows[0][0], '01/12/2026'); assert.equal(rows[0][3], 166);
  assert.equal((await r.runDue(list, utc(2026, 12, 2), deps)).logged.length, 0); // not twice
  rate = 34; await r.runDue(list, utc(2027, 1, 1), deps);
  assert.equal(rows[1][3], 170); assert.match(rows[1][5], /USD 5\.00 at 34/);
});

test('no rate means a dollar item waits instead of guessing, a baht item still logs', async () => {
  let list = r.addItem(r.addItem([], { name: 'Railway', usd: 5 }, utc(2026, 11, 9)).list, { name: 'Freezer', thb: 135 }, utc(2026, 11, 9)).list;
  const rows = [];
  const out = await r.runDue(list, utc(2026, 12, 1), { appendOverheads: async (x) => rows.push(...x), getRate: async () => null, save: async (n) => { list = n; } });
  assert.deepEqual(out.logged.map((x) => x.name), ['Freezer']);
  assert.deepEqual(out.skipped, ['Railway']);
  assert.equal(r.dueItems(list, utc(2026, 12, 2)).length, 1); // Railway is tried again next run
});

test('adding the same name replaces it and stop removes it', () => {
  let l = r.addItem([], { name: 'Railway', usd: 5 }, utc(2026, 11, 9)).list;
  l = r.addItem(l, { name: ' railway ', usd: 6 }, utc(2026, 11, 9)).list;
  assert.equal(l.length, 1); assert.equal(l[0].usd, 6);
  assert.equal(r.stopItem(l, l[0].id).length, 0);
});
