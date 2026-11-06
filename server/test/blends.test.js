const test = require('node:test');
const assert = require('node:assert');
const { parseBlends } = require('../lib/blends');
const { LotBook } = require('../lib/ingredientLots');
const { buildUrgent } = require('../lib/lowStock');
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

test('0 and below 2 are red, 0 first, ingredients count in packs', () => {
  const u = buildUrgent({
    manual: [{ itemName: 'Coke', currentCount: 1, unit: 'can' }, { itemName: 'Cups', currentCount: 0, unit: 'set' }, { itemName: 'Lemon', currentCount: 2, unit: 'can' }],
    ingredients: [{ name: 'Stout', left: 490, unit: 'ml', pack: { packs: 1, word: 'can' }, low: false }, { name: 'Salt', left: 900, unit: 'g', pack: null, low: false }],
  });
  assert.deepStrictEqual(u.map((x) => x.name), ['Cups', 'Coke', 'Stout']);
});

test('drinks and wine are sorted by name', () => {
  assert.strictEqual(guessCategory('coke zero zero'), 'Drinks');
  assert.strictEqual(guessCategory('red wine Ti'), 'Ingredients');
  assert.strictEqual(guessCategory('Packaging Cup (12oz)'), 'Packaging');
});
