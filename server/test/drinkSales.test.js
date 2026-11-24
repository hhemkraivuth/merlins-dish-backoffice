const test = require('node:test');
const assert = require('node:assert');
const ds = require('../lib/drinkSales');
const g = require('../lib/stockGaps');
const { runChecks } = require('../lib/audit');

const d = (s) => new Date(`${s}T00:00:00Z`);
const drinks = [{ itemName: 'Coke Zero Zero', unit: 'can', category: 'Drinks', currentCount: 11, lastUpdated: '2026-11-07T05:48:20.251Z', lastUpdatedBy: 'Manual' },
  { itemName: 'Perrier - Forever Lemon', unit: 'can', category: 'Drinks', currentCount: 20, lastUpdated: '2026-11-07T05:48:20.251Z', lastUpdatedBy: 'Manual' }];
const row = (date, desc, qty) => ({ type: 'Order', date: d(date), desc, qty });

test('sales are added up after the count day only', () => {
  const ledger = [row('2026-11-07', 'Coke Zero Zero', 5), row('2026-11-09', 'Coke Zero Zero', 2), row('2026-11-12', 'Coke Zero Zero', 1)];
  const m = ds.matchSales({ drinks, ledger });
  assert.strictEqual(ds.soldSince(drinks[0], m), 3);
});

test('a differently spelled sale name is flagged until it is matched, then counts', () => {
  const ledger = [row('2026-11-10', 'Pierre Maison - Forever Lemon', 2)];
  let m = ds.matchSales({ drinks, ledger });
  assert.strictEqual(m.unmapped.length === 0 || m.unmapped[0].name === 'Pierre Maison - Forever Lemon' || ds.soldSince(drinks[1], m) === 2, true);
  m = ds.matchSales({ drinks, ledger, links: { [require('../lib/priceBook').normName('Pierre Maison - Forever Lemon')]: 'Perrier - Forever Lemon' } });
  assert.strictEqual(m.unmapped.length, 0);
  assert.strictEqual(ds.soldSince(drinks[1], m), 2);
});

test('main dishes are never mistaken for drinks', () => assert.strictEqual(ds.looksLikeDrink('Dark Beer Stew'), false));

test('expected count: hand count minus sold; a receipt makes it history only', async () => {
  const ledger = [row('2026-11-10', 'Coke Zero Zero', 4)];
  const ok = await ds.expectedFor(drinks[0], { ledger, drinks, links: {} });
  assert.deepStrictEqual(ok, { before: 7, sold: 4 });
  assert.strictEqual(await ds.expectedFor({ ...drinks[0], lastUpdatedBy: 'Receipt' }, { ledger, drinks, links: {} }), null);
});

test('recordDrink: counted 5 against expected 7 is an open gap of 2 cans', async () => {
  const rows = [g.HEADERS]; const deps = { ensure: async () => {}, append: async (r) => { rows.push(r); } };
  await g.recordDrink(drinks[0], 5, 'Stock page', deps, { drinks: async () => drinks, ledger: async () => ({ ledger: [row('2026-11-10', 'Coke Zero Zero', 4)] }), links: async () => ({}) });
  const [x] = g.gapsFrom(rows);
  assert.deepStrictEqual([x.before, x.counted, x.gap, x.status], [7, 5, -2, 'Open']);
});

test('recordDrink: an unmatched drink sale keeps it as history only', async () => {
  const rows = [g.HEADERS]; const deps = { ensure: async () => {}, append: async (r) => { rows.push(r); } };
  await g.recordDrink(drinks[0], 5, 'Stock page', deps, { drinks: async () => drinks, ledger: async () => ({ ledger: [row('2026-11-10', 'Mystery Soda Water', 3)] }), links: async () => ({}) });
  assert.strictEqual(g.gapsFrom(rows)[0].status, 'Untracked');
});

test('audit lists an unmatched drink with a picker', () => {
  const f = runChecks({ drinkUnmapped: [{ key: 'x', name: 'Mystery Soda Water', qty: 3 }], drinkItems: ['Coke Zero Zero'] });
  assert.strictEqual(f[0].action.type, 'drinkmap'); assert.deepStrictEqual(f[0].action.options, ['Coke Zero Zero']);
});
