const test = require('node:test');
const assert = require('node:assert');
const { processTypedReceipt } = require('../lib/cookService');
const { processLots } = require('../lib/lotService');
const { parseSizes } = require('../lib/packSizes');
const { undoBatch } = require('../lib/batchUndo');
const { buildPriceBook } = require('../lib/priceBook');
const { utc } = require('../lib/dates');

const TODAY = utc(2026, 10, 19);
const catalogue = ['Worcestershire Sauce', "Campbell's - Mushroom"];
const sizes = parseSizes([['Ingredient', 'Size per container', 'Note'], ['Worcestershire Sauce', '290ml', '']]);
const pb = buildPriceBook({ expenseRows: [['Date', 'Ingredient', 'Price', 'Unit', 'Cost'], ['01/10/2026', 'Worcestershire Sauce', 123, '290ml', 0.424]], today: TODAY });

function receiptDeps(withSizes = true) {
  const state = { rows: [], lots: [] };
  return {
    state,
    deps: {
      loadCatalogue: async () => catalogue,
      appendExpenseRows: async (r) => state.rows.push(...r),
      addLots: async (l) => state.lots.push(...l),
      loadUntracked: async () => [],
      loadPackSizes: async () => (withSizes ? sizes : new Map()),
      loadPriceBook: async () => pb,
    },
  };
}

test('2 bottles of Worcestershire is stored as 580ml, not 2 pieces', async () => {
  const { state, deps } = receiptDeps();
  const out = await processTypedReceipt('5/10\nworcestershire sauce, 2bottles, 363', TODAY, deps);
  assert.strictEqual(state.rows[0][3], '580ml');
  assert.strictEqual(state.rows[0][4], 0.62586);
  assert.deepStrictEqual([state.lots[0].qty, state.lots[0].unit, state.lots[0].price], [580, 'ml', 363]);
  assert.match(out[0], /580ml \(2 bottles x 290ml\)/);
});

test('plain pieces and items without a size are left as they were', async () => {
  const { state, deps } = receiptDeps();
  await processTypedReceipt("5/10\ncampbells mushroom 4 cans, 520", TODAY, deps);
  assert.strictEqual(state.rows[0][3], '4cans');
  assert.strictEqual(state.lots[0].unit, 'piece');
});

test('a bottle count with no size and a price far from the past is held back, not logged', async () => {
  const { state, deps } = receiptDeps(false);
  const out = await processTypedReceipt('5/10\nworcestershire sauce, 2bottles, 363', TODAY, deps);
  assert.strictEqual(state.rows.length, 0);
  assert.match(out[0], /size worcestershire sauce 290ml/);
});

test('size command sets the size, undo command reaches the undo function', async () => {
  let set = null; let undone = null;
  const deps = {
    loadCatalogue: async () => catalogue,
    setPackSize: async (n, t) => { set = [n, t]; return 'added'; },
    undoBatch: async (w, d) => { undone = [w, d.toISOString().slice(0, 10)]; return { text: 'ok' }; },
  };
  const a = await processLots('size worcestershire sauce 290ml', TODAY, deps);
  assert.deepStrictEqual(set, ['Worcestershire Sauce', '290ml']);
  assert.match(a[0], /580ml/);
  await processLots('undo noir ragu 6/10', TODAY, deps);
  assert.deepStrictEqual(undone, ['noir ragu', '2026-10-06']);
});

test('undo gives the grams back and removes the batch rows', async () => {
  const tabs = {
    'Cook Log': [['Batch Key', 'Date Cooked', 'Dish'], ['K1', '06/10/2026', 'Noir Ragu', 20], ['K2', '07/10/2026', 'Bolo', 21]],
    'Cook Log Lines': [['Batch Key'], ['K1', '', '', 'Ingredient'], ['K2', '', '', 'Ingredient']],
    'Lot Usage': [['Batch Key', 'd', 'i', 'Lot ID', 'ld', 'Qty Used'], ['K1', '', '', 'L1', '', 580], ['K2', '', '', 'L1', '', 100]],
    'Ingredient Lots': [['Lot ID'], ['L1', 'Worcestershire Sauce', '05/10/2026', 'Receipt', 580, 'ml', 0, 363, 0.6, 'Used up', '', '']],
  };
  const io = {
    readTab: async (t) => tabs[t].map((r) => r.slice()),
    updateRow: async (t, i, v) => { tabs[t][i - 1] = v; },
    deleteRowsWhere: async (t, fn) => { tabs[t] = tabs[t].filter((r, i) => i === 0 || !fn(r)); },
  };
  const r = await undoBatch('noir ragu', utc(2026, 10, 6), io);
  assert.strictEqual(r.status, 'undone');
  assert.strictEqual(tabs['Ingredient Lots'][1][6], 580);
  assert.strictEqual(tabs['Ingredient Lots'][1][9], 'Active');
  assert.deepStrictEqual(tabs['Cook Log'].map((x) => x[0]), ['Batch Key', 'K2']);
  assert.deepStrictEqual(tabs['Lot Usage'].map((x) => x[0]), ['Batch Key', 'K2']);
  const none = await undoBatch('noir ragu', utc(2026, 10, 6), io);
  assert.strictEqual(none.status, 'none');
});
