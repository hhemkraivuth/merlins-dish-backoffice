const test = require('node:test');
const assert = require('node:assert');
const { utc } = require('../lib/dates');
const { buildSpend, buildCooking, NO_SHOP } = require('../lib/summaries');

const today = utc(2026, 11, 5); // Thursday. Week starts Sunday 01/11.

test('spend: week and month, by shop, ads kept out of the shop list', () => {
  const expenseRows = [
    ['Date', 'Ingredient', 'Purchase Price', 'Purchase Unit', 'Cost per Recipe Unit', 'Shopped at', 'Remarks'],
    ['03/11/2026', 'minced pork', 110, '1000g', 0.11, 'Makro', ''],
    ['04/11/2026', 'onion', 90, '2kg', 0.045, 'Makro', ''],
    ['04/11/2026', 'basil', 40, '100g', 0.4, '', ''],
    ['28/10/2026', 'flour', 500, '5kg', 0.1, 'Tops', ''],      // October: in neither period
    ['01/11/2026', 'butter', 300, '500g', 0.6, 'Tops', ''],    // Sunday, the first day of this week
  ];
  const overheadRows = [
    ['Date', 'Item', 'Category', 'Price', 'Shopped at', 'Remarks'],
    ['04/11/2026', 'pot 7lt', 'equipment', 2575, 'Makro', ''],
    ['04/11/2026', 'Meta ads', 'ads', 1200, '', ''],
  ];
  const { periods } = buildSpend({ today, expenseRows, overheadRows });
  const [wk, mo] = periods;
  assert.strictEqual(wk.range, '01/11/2026 to 07/11/2026');
  assert.strictEqual(wk.ingredients, 540);
  assert.strictEqual(wk.overheads, 2575);
  assert.strictEqual(wk.ads, 1200);
  assert.strictEqual(wk.total, 4315);
  assert.deepStrictEqual(wk.byShop, [{ shop: 'Makro', amount: 2775 }, { shop: 'Tops', amount: 300 }, { shop: NO_SHOP, amount: 40 }]);
  assert.strictEqual(mo.ingredients, 540);
  assert.deepStrictEqual(mo.byShop.map((s) => s.shop), ['Makro', 'Tops', NO_SHOP]);
});

test('spend: empty tabs give zeros, not errors', () => {
  const { periods } = buildSpend({ today });
  assert.strictEqual(periods[0].total, 0);
  assert.deepStrictEqual(periods[1].byShop, []);
});

test('cooking: batches and portions per period, per dish, with low yield flagged', () => {
  const batches = [
    { key: 'a', date: utc(2026, 11, 3), dish: 'Noir Ragu', portions: 10, cost: 800 },
    { key: 'b', date: utc(2026, 11, 4), dish: 'Noir Ragu', portions: 8, cost: 720 },
    { key: 'c', date: utc(2026, 11, 4), dish: 'Bolognese', portions: 3, cost: 330 },
    { key: 'd', date: utc(2026, 10, 30), dish: 'Bolognese', portions: 12, cost: 960 },
  ];
  const [wk, mo] = buildCooking({ today, batches }).periods;
  assert.strictEqual(wk.batches, 3);
  assert.strictEqual(wk.portions, 21);
  assert.strictEqual(wk.cost, 1850);
  assert.strictEqual(wk.byDish[0].dish, 'Noir Ragu');
  assert.strictEqual(wk.byDish[0].batches, 2);
  assert.strictEqual(wk.byDish[0].perPortion, 84.44);
  assert.deepStrictEqual(wk.lowYield, [{ dish: 'Bolognese', date: '04/11/2026', portions: 3 }]);
  assert.strictEqual(mo.batches, 3); // 30/10 is October
});

test('cooking: nothing cooked', () => {
  const [wk] = buildCooking({ today }).periods;
  assert.strictEqual(wk.batches, 0);
  assert.strictEqual(wk.perPortion, null);
});
