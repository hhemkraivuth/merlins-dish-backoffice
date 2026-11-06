const test = require('node:test');
const assert = require('node:assert');
const sp = require('../lib/shoppingPlan');
const { utc } = require('../lib/dates');

const today = utc(2026, 11, 6);
const sale = (d, desc, q, order) => [d, desc, 'LINE', 'LINE', 'Order', q, q * 200, 0, q * 200, 'x', order];

const master = [
  ['Date', 'Description', 'Channel', 'From', 'Type', 'QTY'],
  ['01/08/2026', 'Noir Ragu', 'LINE', 'LINE', 'Order', 10, 2000, 0, 2000, 'a', 'A1'],
  ['', 'Tuscan Pork Braise', 'LINE', 'LINE', 'Order', 5, 1000, 0, 1000, 'b', 'A2'], // blank date carries forward
  ['', 'Rigatoni (paired with Noir Ragu)', 'LINE', 'LINE', 'Order', 3, 0, 0, 0, 'b', 'A2'], // pasta, not a batch dish
  ['05/09/2026', 'Noir Ragu', 'LINE', 'LINE', 'Order', 20, 4000, 0, 4000, 'x', 'B1'], // the Master Log runs to the end of September
];
const ledger = [
  ['Date'],
  sale('05/09/2026', 'Noir Ragu', 20, 'B1'), // BOH starts in October, so a September row here is ignored
  sale('05/10/2026', 'Noir Ragu', 2, 'C1'), // slow month
];

test('combineSales carries blank dates and never counts a row twice', () => {
  const s = sp.combineSales({ master, ledger });
  assert.strictEqual(s.filter((x) => x.dish === 'Noir Ragu').reduce((a, x) => a + x.qty, 0), 10 + 20 + 2);
  assert.strictEqual(s.find((x) => x.dish === 'Tuscan Pork Braise').date.getUTCDate(), 1);
  assert.ok(!s.some((x) => /rigatoni/i.test(x.dish)));
});

test('demand leaves out the slow October', () => {
  const d = sp.demandOf(sp.combineSales({ master, ledger }), today);
  assert.strictEqual(d.dishes.find((x) => x.dish === 'Noir Ragu').perMonth, 15); // (10 + 20) / 2
});

const cookLog = [['Batch Key', 'Date Cooked', 'Dish', 'Yield'], ['K1', '20/09/2026', 'Noir Ragu', 10]];
const sizes = [['k'], ['K1', '20/09/2026', 'Noir Ragu', 'Regular', 250, 10]];
const lines = [['k'],
  ['K1', '20/09/2026', 'Noir Ragu', 'Ingredient', 'Pork mince', 5000, 'g'],
  ['K1', '20/09/2026', 'Noir Ragu', 'Ingredient', 'Onion', 1000, 'g'],
  ['K1', '20/09/2026', 'Noir Ragu', 'Packaging', 'Tub', 10, 'piece']];
const priceLog = [['Date', 'Ingredient', 'Price', 'Unit', 'c', 'Shop'],
  ['01/11/2026', 'Pork mince', 1000, '5 kg', '', 'Makro'],
  ['01/11/2026', 'Onion', 100, '1 kg', '', 'Fresh market']];

function run(extra = {}) {
  return sp.buildShoppingPlan({ today, sales: sp.combineSales({ master, ledger }), cookLogRows: cookLog, sizeRows: sizes, lineRows: lines, priceLogRows: priceLog, ...extra });
}

test('onion is a fresh run, pork is bulk, and amounts follow portions', () => {
  const p = run();
  const onion = p.fresh.items.find((x) => x.name === 'Onion');
  assert.ok(onion, 'onion is fresh');
  assert.ok(p.bulk.groups.some((g) => g.items.some((i) => i.name === 'Pork mince')) || p.bulk.enough.some((e) => e.name === 'Pork mince'));
  // 15 portions x 100 g (1000 g / 10) x 1.1 = 1650 g a month
  assert.strictEqual(onion.monthly, 1650);
});

test('a Shelf Life row makes an ingredient fresh, a long one makes it bulk', () => {
  const a = run({ shelfRows: [['Ingredient', 'Days'], ['Pork mince', 5]] });
  assert.ok(a.fresh.items.some((x) => x.name === 'Pork mince'));
  const b = run({ shelfRows: [['Ingredient', 'Days'], ['Onion', 60]] });
  assert.ok(!b.fresh.items.some((x) => x.name === 'Onion'));
});

test('fresh items never exceed 14 days and onHand never goes negative', () => {
  const p = run();
  assert.ok(p.fresh.cycleDays <= sp.FRESH_MAX);
  for (const i of [...p.fresh.items, ...p.bulk.groups.flatMap((g) => g.items)]) assert.ok(i.onHand >= 0);
});

test('an ingredient with no receipts is warned about, not invented', () => {
  const p = run({ priceLogRows: [priceLog[0]] });
  assert.ok(p.warnings.some((w) => /No receipt history/.test(w)));
});

test('roundToPack rounds up to whole packs', () => {
  assert.deepStrictEqual(sp.roundToPack(5200, 5000, 'g'), { qty: 10000, packs: 2 });
  assert.deepStrictEqual(sp.roundToPack(0, 5000, 'g'), { qty: 0, packs: 0 });
});
