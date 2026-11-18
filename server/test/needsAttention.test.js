const test = require('node:test');
const assert = require('node:assert');
const { attentionItems, looseKey } = require('../lib/needsAttention');
const { utc } = require('../lib/dates');

const today = utc(2026, 10, 18);
const rows = [
  ['Date', 'Ingredient', 'Price', 'Unit', 'Cost', 'Shop', 'Remarks'],
  ['15/11/2026', 'Pasta - Tubetti', 130, '500g', 0.26, 'Tops', 'Receipt R1'],
  ['15/11/2026', 'Orzo', 78, '500g', 0.156, 'Tops', '"orzo" not matched to a known ingredient'],
  ['15/11/2026', 'Eden Green Apple Sparkling', 36, '2cans', 18, 'Tops', ''],
  ['01/09/2026', 'Old thing', 10, '1pcs', 10, '', ''],
  ['16/11/2026', 'Soy Sauce', 30, '1pcs', 30, '', ''],
];
const stock = [{ itemName: 'Eden Green Apple Sparkling', unit: 'can' }];

test('lists what the receipts bought that the Stock page or Price Tracker does not have', () => {
  const out = attentionItems({ expenseRows: rows, stock, untracked: ['Soy Sauce'], today });
  const by = Object.fromEntries(out.map((o) => [o.name, o]));
  assert.deepStrictEqual(Object.keys(by).sort(), ['Orzo', 'Pasta - Tubetti']);
  assert.deepStrictEqual(by['Pasta - Tubetti'].reasons, ['Not on the Stock page']);
  assert.strictEqual(by.Orzo.reasons.length, 2);
  assert.strictEqual(by['Pasta - Tubetti'].bought, '15/11/2026');
});

test('an ignored item stays gone, and a stocked item is not listed', () => {
  const out = attentionItems({ expenseRows: rows, stock: [...stock, { itemName: 'Pasta - Tubetti' }], ignored: [looseKey('Orzo')], untracked: ['Soy Sauce'], today });
  assert.strictEqual(out.length, 0);
});
