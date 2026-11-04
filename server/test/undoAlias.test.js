const test = require('node:test');
const assert = require('node:assert');
const { processTypedReceipt } = require('../lib/cookService');
const { processReceiptUndo, newReceiptId } = require('../lib/receiptUndo');
const { processAlias, receiptAliases } = require('../lib/ingredientAlias');
const { utc } = require('../lib/dates');

const CAT = ['Pork - minced', 'EN Ziero - Golden Apple and Yuzu', 'EN Ziero - Lemon'];

test('receipt IDs sort by time and are written to the rows', async () => {
  assert.match(newReceiptId(Date.UTC(2026, 10, 4, 8, 32, 11)), /^R261104-153211$/);
  const expense = []; const lots = [];
  const out = await processTypedReceipt('13/10\nat Makro\nminced pork 1000g 110thb', utc(2026, 10, 13), {
    loadCatalogue: async () => CAT, appendExpenseRows: async (r) => expense.push(...r),
    addLots: async (l) => lots.push(...l), loadUntracked: async () => [],
  });
  assert.match(out[0], /Receipt R\d{6}-\d{6}\. If this was a mistake, send: undo receipt/);
  assert.match(expense[0][6], /Receipt R\d{6}-\d{6}/);
  assert.match(lots[0].note, /Makro R\d{6}-\d{6}/);
});

test('a heading line "ingredients" does not cause an error', async () => {
  const out = await processTypedReceipt('13/10\ningredients\nminced pork 1000g 110thb', utc(2026, 10, 13), {
    loadCatalogue: async () => CAT, appendExpenseRows: async () => {},
  });
  assert.ok(!out.join('\n').includes("Couldn't read"));
});

test('undo receipt removes the latest receipt rows and keeps a lot a batch already used', async () => {
  const tabs = {
    'Expense Log': [['Date'], ['13/10', 'A', 1, '', '', '', 'Typed in LINE; Receipt R261104-100000'], ['14/10', 'B', 1, '', '', '', 'Receipt R261104-153211'], ['14/10', 'C', 1, '', '', '', 'Receipt R261104-153211']],
    'Overheads': [['Date'], ['14/10', 'pot', 'x', 100, '', 'Receipt R261104-153211']],
    'Ingredient Lots': [['id'], ['L1', 'B', '14/10', 'Receipt', 100, 'g', 100, 10, 0.1, 'Active', '', 'Makro R261104-153211'], ['L2', 'C', '14/10', 'Receipt', 100, 'g', 40, 10, 0.1, 'Active', '', 'R261104-153211']],
  };
  const deps = {
    readRows: async (t) => tabs[t],
    deleteWhere: async (t, pred) => { const keep = tabs[t].filter((r, i) => i === 0 || !pred(r)); const n = tabs[t].length - keep.length; tabs[t] = keep; return n; },
  };
  const out = await processReceiptUndo('undo receipt', deps);
  assert.match(out[0], /2 ingredient lines, 1 overhead items, 1 stock lots/);
  assert.match(out[1], /C \(40 of 100 left\)/);
  assert.strictEqual(tabs['Expense Log'].length, 2);
  assert.strictEqual(await processReceiptUndo('undo noir ragu 6/10', deps), null);
});

test('alias: saved short names turn en ziero into the full name on a receipt', async () => {
  const saved = [];
  const said = await processAlias('alias en ziero = EN Ziero - Golden Apple and Yuzu', { loadCatalogue: async () => CAT, save: async (s, f) => saved.push([s, f]) });
  assert.match(said[0], /Saved/);
  assert.deepStrictEqual(saved[0], ['en ziero', 'EN Ziero - Golden Apple and Yuzu']);
  const expense = [];
  await processTypedReceipt('13/10\nen ziero 290ml, 8bottles, 400thb', utc(2026, 10, 13), {
    loadCatalogue: async () => CAT, appendExpenseRows: async (r) => expense.push(...r),
    loadAliases: async () => receiptAliases([['Ingredient', 'en ziero', 'EN Ziero - Golden Apple and Yuzu']]),
  });
  assert.strictEqual(expense[0][1], 'EN Ziero - Golden Apple and Yuzu');
});
