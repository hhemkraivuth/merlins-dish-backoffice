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

test('items sold with no cost on record are listed, from Grab and LINE orders', () => {
  const { soldWithoutCost } = require('../lib/needsAttention');
  const d = utc(2026, 10, 16);
  const ledger = [
    { date: d, dmy: '16/11/2026', desc: 'Red Wine Beef Stew (Tubetti)', channel: 'LINE', type: 'Order', qty: 2, cost: null },
    { date: d, dmy: '16/11/2026', desc: 'Lemon Soda', channel: 'Grab', type: 'Recipe', qty: 1, cost: 0 },
    { date: utc(2026, 8, 1), dmy: '01/09/2026', desc: 'Ancient', channel: 'Grab', type: 'Recipe', qty: 1, cost: 0 },
  ];
  const out = soldWithoutCost({ ledger, today });
  assert.deepStrictEqual(out.map((o) => o.name).sort(), ['Lemon Soda', 'Tubetti (pasta)']);
  assert.strictEqual(soldWithoutCost({ ledger, today, ignored: ['sold:lemonsoda'] }).length, 1);
});

test('an old "not matched" note is dropped once the name matches the ingredient list, and stays when it still does not', () => {
  const r = [
    ['22/11/2026', 'risoni', 300, '2000g', 0.15, 'Foodland', '"risoni" not matched to a known ingredient; 75 each x 4 = 300'],
    ['22/11/2026', 'mystery', 10, '1pcs', 10, 'Foodland', '"mystery" not matched to a known ingredient'],
  ];
  const st = [{ itemName: 'risoni' }, { itemName: 'mystery' }];
  const out = attentionItems({ expenseRows: r, stock: st, known: (n) => n === 'risoni', today });
  assert.deepStrictEqual(out.map((o) => o.name), ['mystery']);
});
