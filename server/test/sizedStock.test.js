const test = require('node:test');
const assert = require('node:assert');
const { snapshotFromMenu } = require('../lib/botStock');
const { buildReadyStock, sizesFromTyped } = require('../lib/logViews');
const { cookBatchesFrom } = require('../lib/ledgerService');
const { utc } = require('../lib/dates');

const d = (day) => utc(2026, 11, day);
const sale = (day, desc, qty) => ({ date: d(day), type: 'Order', desc, qty, channel: 'Grab' });

test('the order app menu feed keeps Regular and Large apart', () => {
  const s = snapshotFromMenu({ items: [{ name: 'Dark beer Stew', remaining: null, available: true, variantRemaining: [{ id: 'regular', name: 'Regular', left: 5 }, { id: 'large', name: 'Large', left: 3 }] }] }, 'T');
  assert.deepStrictEqual(s.items, [{ name: 'Dark beer Stew', left: null, soldOut: false, sizes: [{ name: 'Regular', left: 5 }, { name: 'Large', left: 3 }] }]);
});

test('typed counts are read per size', () => {
  assert.deepStrictEqual(sizesFromTyped('5r 3l'), { Regular: 5, Large: 3 });
  assert.deepStrictEqual(sizesFromTyped('4l'), { Regular: 0, Large: 4 });
  assert.strictEqual(sizesFromTyped(''), null);
});

test('cook batches carry the packed count of each size', () => {
  const b = cookBatchesFrom([['h'], ['k1', '10/11/2026', 'Dark beer Stew', '12', '', '', '', '500']], [['h'], ['k1', '10/11/2026', 'Dark beer Stew', 'Regular', 380, 7], ['k1', '10/11/2026', 'Dark beer Stew', 'Large', 525, 5]]);
  assert.deepStrictEqual(b[0].sizes, { Regular: 7, Large: 5 });
  assert.strictEqual(b[0].portions, 12);
});

test('stew stock after a count: each size has its own packed and sold numbers', () => {
  const batches = [{ key: 'k2', date: d(12), dish: 'Dark beer Stew', portions: 10, cost: 400, sizes: { Regular: 6, Large: 4 } }];
  const ledger = [sale(12, 'Dark beer Stew (Large 525g)', 1), sale(13, 'Dark beer Stew (Large 525g)', 2), sale(13, 'Dark beer Stew (Regular 380g)', 1), sale(10, 'Dark beer Stew (Large 525g)', 9)];
  const countRows = [['Dish', 'Count', 'Counted on', 'Logged at', 'As typed'], ['Dark beer Stew', 8, '11/11/2026', 'x', '5r 3l']];
  const stew = buildReadyStock({ today: d(14), ledger, cookBatches: batches, countRows }).items.find((i) => i.dish === 'Dark beer Stew');
  // Regular: 5 + 6 packed - 1 sold; Large: 3 + 4 packed - 3 sold (the sale on 10/11 is before the count)
  assert.deepStrictEqual(stew.sizes, { Regular: 10, Large: 4 });
});

test('a dish that is not sold in sizes has no size split', () => {
  const countRows = [['Dish', 'Count', 'Counted on', 'Logged at', 'As typed'], ['Noir Ragu', 4, '11/11/2026', 'x', '']];
  assert.strictEqual(buildReadyStock({ today: d(14), ledger: [], cookBatches: [], countRows }).items.find((i) => i.dish === 'Noir Ragu').sizes, null);
});
