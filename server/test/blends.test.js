const test = require('node:test');
const assert = require('node:assert');
const { parseBlends } = require('../lib/blends');
const { LotBook } = require('../lib/ingredientLots');
const { buildUrgent, daysLeft, statusOf, sizeFromName, usageFromLines } = require('../lib/lowStock');
const { guessCategory } = require('../lib/stockCounts');

const d = (s) => new Date(s + 'T00:00:00Z');
// Lot rows: id, name, date, source, qty, unit, remaining, total
const book = () => {
  const b = new LotBook([
    ['id', 'Ingredient'],
    ['A1', 'Red wine (Ti)', '01/11/2026', 'Receipt', 750, 'ml', 750, 150],
    ['A2', 'Red wine (Familia)', '01/11/2026', 'Receipt', 750, 'ml', 750, 450],
  ], [], d('2026-11-07'));
  b.setBlends(parseBlends([['Blend', 'Ingredient', 'Parts'], ['Red wine', 'Red wine (Ti)', 1], ['Red wine', 'Red wine (Familia)', 1]]));
  return b;
};

test('a blend takes each part from its own stock and costs the real mix', () => {
  const b = book();
  assert.ok(b.hasLots('Red wine'));
  const r = b.allocate('Red wine', 550, 'ml', d('2026-11-07'));
  assert.strictEqual(r.short, 0);
  assert.strictEqual(r.parts.length, 2);
  const cost = r.parts.reduce((s, x) => s + x.qty * x.unitCost, 0);
  assert.ok(Math.abs(cost - (275 * 0.2 + 275 * 0.6)) < 1e-6); // Ti 0.2 per ml, Familia 0.6 per ml
  assert.ok(Math.abs(b.totalRemaining('Red wine (Ti)') - 475) < 1e-6);
  assert.ok(Math.abs(b.totalRemaining('Red wine (Familia)') - 475) < 1e-6);
});

test('parts are ratios: 3 and 5 give 37.5% and 62.5%', () => {
  const m = parseBlends([['Blend', 'Ingredient', 'Parts'], ['Thyme', 'Thyme (McCormick)', 3], ['Thyme', 'Thyme (Nguan Soon)', 5]]);
  const t = m.get('thyme');
  assert.deepStrictEqual(t.parts.map((p) => p.share), [0.375, 0.625]);
});

test('a blend is limited by the part that runs out first', () => {
  const b = book();
  b.allocate('Red wine (Ti)', 700, 'ml', d('2026-11-07'));
  assert.ok(Math.abs(b.totalRemaining('Red wine') - 100) < 1e-6); // Ti has 50 left, 50 / 0.5
});

test('with no use known: cans and packaging are red below 2, an ingredient only at 0', () => {
  const u = buildUrgent({
    manual: [{ itemName: 'Coke', currentCount: 1, unit: 'can' }, { itemName: 'Cups', currentCount: 0, unit: 'set' }, { itemName: 'Lemon', currentCount: 2, unit: 'can' }, { itemName: 'Black Pepper (450g)', currentCount: 1, unit: 'pcs', category: 'Ingredients' }],
    ingredients: [{ name: 'Stout', left: 0, unit: 'ml', pack: { packs: 0, word: 'can' }, low: false }],
  });
  assert.deepStrictEqual(u.map((x) => x.name), ['Cups', 'Stout', 'Coke']);
});

test('450g of pepper is fine at 1 bottle, and a bottle that runs out within a week is red', () => {
  const usage = new Map([['black pepper|g', 5], ['bay leaf|g', 2]]);
  assert.deepStrictEqual(sizeFromName('Black Pepper (450g)'), { qty: 450, unit: 'g' });
  assert.ok(Math.abs(daysLeft({ name: 'Black Pepper (450g)', count: 1, unit: 'pcs', usage }) - 90) < 1e-9);
  assert.strictEqual(statusOf({ count: 1, days: 90, category: 'Ingredients' }), false);
  assert.strictEqual(statusOf({ count: 1, days: 3, category: 'Ingredients' }), true);
  assert.strictEqual(statusOf({ count: 0, days: 999, category: 'Ingredients' }), true);
  const u = buildUrgent({ manual: [{ itemName: 'Bay Leaf (50g)', currentCount: 1, unit: 'pcs', category: 'Ingredients' }, { itemName: 'Black Pepper (450g)', currentCount: 1, unit: 'pcs', category: 'Ingredients' }], usage });
  assert.deepStrictEqual(u.map((x) => x.name), []); // 50g at 2g a day is 25 days, not red
  const fast = buildUrgent({ manual: [{ itemName: 'Bay Leaf (50g)', currentCount: 1, unit: 'pcs', category: 'Ingredients' }], usage: new Map([['bay leaf|g', 20]]) });
  assert.deepStrictEqual(fast.map((x) => x.name), ['Bay Leaf (50g)']); // 2.5 days left
});

test('use per day comes from the batches of the last 28 days, brands and sizes in brackets ignored', () => {
  const today = d('2026-11-07');
  const log = [['Key', 'Date', 'Dish', 'Portions'], ['K1', '01/11/2026', 'Noir Ragu', 10], ['K0', '01/09/2026', 'Noir Ragu', 10]];
  const lines = [['K', '', '', 'Kind', 'Name', 'Qty', 'Unit'], ['K1', '', '', 'Ingredient', 'Red wine', 560, 'ml'], ['K1', '', '', 'Ingredient', 'Thyme', 28, 'g'], ['K0', '', '', 'Ingredient', 'Thyme', 999, 'g']];
  const m = usageFromLines({ log, sizes: [], lines, today });
  assert.strictEqual(m.get('red wine|ml'), 20);
  assert.strictEqual(m.get('thyme|g'), 1);
});

test('a recipe name takes from every brand of it, oldest first, at each price', () => {
  const b = new LotBook([
    ['id', 'Ingredient'],
    ['T1', 'Tomato paste (Brand A)', '01/11/2026', 'Receipt', 1000, 'g', 1000, 100],
    ['T2', 'Tomato paste (Brand B)', '03/11/2026', 'Receipt', 1000, 'g', 1000, 60],
  ], [], d('2026-11-07'));
  assert.ok(b.hasLots('Tomato paste'));
  const r = b.allocate('Tomato paste', 1500, 'g', d('2026-11-07'));
  assert.strictEqual(r.short, 0);
  const cost = r.parts.reduce((s, x) => s + x.qty * x.unitCost, 0);
  assert.ok(Math.abs(cost - (1000 * 0.1 + 500 * 0.06)) < 1e-6);
  assert.ok(Math.abs(b.totalRemaining('Tomato paste (Brand B)') - 500) < 1e-6);
});

test('drinks and wine are sorted by name', () => {
  assert.strictEqual(guessCategory('coke zero zero'), 'Drinks');
  assert.strictEqual(guessCategory('red wine Ti'), 'Ingredients');
  assert.strictEqual(guessCategory('Packaging Cup (12oz)'), 'Packaging');
});
