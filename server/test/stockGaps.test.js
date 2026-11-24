const test = require('node:test');
const assert = require('node:assert');
const g = require('../lib/stockGaps');
const { runChecks } = require('../lib/audit');

const mem = () => { const rows = [g.HEADERS]; return { rows, ensure: async () => {}, readRows: async () => rows, append: async (r) => { rows.push(r); }, closeRow: async (i, _g, reason) => { rows[i - 1] = [...rows[i - 1]]; rows[i - 1][10] = 'Closed'; rows[i - 1][11] = reason; } }; };

test('no gap when the count matches', () => assert.strictEqual(g.buildGap({ item: 'Cup', before: 10, counted: 10, tracked: true }), null));

test('a tracked shortfall is Open, with baht from the unit price', () => {
  const row = g.buildGap({ item: 'Tomato Paste', unit: 'g', before: 800, counted: 700, unitPrice: 0.1, tracked: true, now: 'T' });
  assert.strictEqual(row[5], -100); assert.strictEqual(row[7], -10); assert.strictEqual(row[10], 'Open');
});

test('an untracked item is history only, never Open', () => {
  const row = g.buildGap({ item: 'Coke Original', unit: 'can', before: 9, counted: 6, tracked: false });
  assert.strictEqual(row[10], 'Untracked');
});

test('only items last moved by Auto count as tracked', () => {
  assert.strictEqual(g.isTracked({ lastUpdatedBy: 'Auto' }), true);
  assert.strictEqual(g.isTracked({ lastUpdatedBy: 'Manual' }), false);
  assert.strictEqual(g.isTracked(null), false);
});

test('record writes a row and never throws', async () => {
  const d = mem();
  await g.record({ item: 'Cup', unit: 'Set', before: 146, counted: 140, tracked: true }, d);
  assert.strictEqual(d.rows.length, 2);
  const bad = { ensure: async () => { throw new Error('sheet down'); } };
  assert.strictEqual(await g.record({ item: 'Cup', before: 5, counted: 1, tracked: true }, bad), null);
});

test('recordStock uses the system number as before', async () => {
  const d = mem();
  await g.recordStock({ itemName: 'Packaging Cup (26oz)', unit: 'Set', currentCount: 146, lastUpdatedBy: 'Auto' }, 140, 'Stock page', d);
  const [x] = g.gapsFrom(d.rows);
  assert.deepStrictEqual([x.before, x.counted, x.gap, x.status], [146, 140, -6, 'Open']);
});

test('open gaps show on the Audit desk until a reason closes them', async () => {
  const d = mem();
  await g.record({ item: 'Tomato Paste', unit: 'tin', before: 11, counted: 9, unitPrice: 40, tracked: true }, d);
  let f = runChecks({ stockGaps: g.gapsFrom(d.rows) });
  assert.strictEqual(f.length, 1); assert.strictEqual(f[0].check, 'Stock gap'); assert.strictEqual(f[0].baht, 80);
  const r = await g.processGap('gap tomato paste lost', d);
  assert.match(r[0], /closed as lost, no explanation/); assert.match(r[0], /฿80 lost/);
  f = runChecks({ stockGaps: g.gapsFrom(d.rows) });
  assert.strictEqual(f.length, 0);
  assert.strictEqual(g.lostCost(g.gapsFrom(d.rows)), 80);
});

test('a reason other than lost is not lost cost', async () => {
  const d = mem();
  await g.record({ item: 'Bay Leaf', unit: 'g', before: 100, counted: 90, unitPrice: 1, tracked: true }, d);
  await g.processGap('gap bay leaf cook', d);
  assert.strictEqual(g.lostCost(g.gapsFrom(d.rows)), 0);
});

test('gap command: list, unknown item, bad reason, not a gap command', async () => {
  const d = mem();
  assert.deepStrictEqual(await g.processGap('gap', d), ['No open stock gaps.']);
  assert.match((await g.processGap('gap rice lost', d))[0], /No open gap/);
  await g.record({ item: 'Rice', unit: 'g', before: 5, counted: 1, tracked: true }, d);
  assert.match((await g.processGap('gap rice', d))[0], /I need an item and a reason/);
  assert.match((await g.processGap('gap', d))[0], /Rice: the system said 5 g, you counted 1 g/);
  assert.strictEqual(await g.processGap('gapless thing', d), null);
});
