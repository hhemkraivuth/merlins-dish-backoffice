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

test('several unlogged meat cooks make one card, not one each', () => {
  const f = runChecks({ today: new Date('2026-11-23T00:00:00Z'), meatGaps: [{ key: 'a', dish: 'Noir Ragu', dmy: '12/11/2026', names: ['Brisket'] }, { key: 'b', dish: 'Tuscan Pork Braise', dmy: '23/11/2026', names: ['Pork shoulder'] }] });
  const m = f.filter((x) => x.action && x.action.type === 'meatcatch');
  assert.strictEqual(m.length, 1); assert.match(m[0].line, /2 cooks never took their meat off/);
});

test('only a day with no orders on either channel can be marked shut', () => {
  const day = (iso, ch) => ({ key: `${ch}${iso}`, channel: ch, date: new Date(`${iso}T00:00:00Z`), dmy: iso, type: 'Order', desc: 'x', moneyIn: 100, qty: 1 });
  const ledger = [day('2026-11-17', 'Grab'), day('2026-11-19', 'LINE'), day('2026-11-19', 'Grab'), day('2026-11-16', 'LINE'), day('2026-11-16', 'Grab'), day('2026-11-13', 'LINE'), day('2026-11-13', 'Grab')];
  const f = runChecks({ today: new Date('2026-11-23T00:00:00Z'), ledger });
  const line = f.find((x) => x.id.startsWith('gap:LINE'));
  assert.ok(line, 'LINE gap listed');
  assert.ok(!(line.action && line.action.days.includes('17/11/2026')), 'a day Grab sold on is never offered as shut');
  assert.ok(line.action && line.action.days.includes('18/11/2026'), 'a day with no orders at all can be marked shut');
});

test('open days with no orders on one channel can be noted, and stop being named', async () => {
  const day = (iso, ch) => ({ key: `${ch}${iso}`, channel: ch, date: new Date(`${iso}T00:00:00Z`), dmy: iso, type: 'Order', desc: 'x', moneyIn: 100, qty: 1 });
  const ledger = [day('2026-11-17', 'Grab'), day('2026-11-19', 'Grab'), day('2026-11-19', 'LINE'), day('2026-11-18', 'Grab')];
  const base = { today: new Date('2026-11-23T00:00:00Z'), ledger };
  const before = runChecks(base).find((x) => x.id.startsWith('gap:LINE'));
  assert.deepStrictEqual(before.action.others.sort(), ['17/11/2026', '18/11/2026']);
  const store = (() => { const m = new Map(); return { getState: async (k) => m.get(k) || null, setState: async (k, v) => { m.set(k, v); } }; })();
  const a = require('../lib/audit');
  await a.noOrders('LINE', before.action.others, { store, reason: 'no riders' });
  const noOrders = JSON.parse(await store.getState('audit_noorders'));
  const after = runChecks({ ...base, noOrders }).find((x) => x.id.startsWith('gap:LINE'));
  assert.ok(!after || !after.action.others.length);
});

test('the meat card lists each cook as its own bullet', () => {
  const f = runChecks({ today: new Date('2026-11-23T00:00:00Z'), meatGaps: [{ key: 'a', dish: 'Noir Ragu', dmy: '12/11/2026', names: ['Brisket'] }, { key: 'b', dish: 'Tuscan Pork Braise', dmy: '23/11/2026', names: ['Pork shoulder'] }] }).find((x) => x.bullets);
  assert.deepStrictEqual(f.bullets, ['Noir Ragu, 12/11: Brisket', 'Tuscan Pork Braise, 23/11: Pork shoulder']);
});
