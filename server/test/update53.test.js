const test = require('node:test');
const assert = require('node:assert');
const bags = require('../lib/stockBags');
const ls = require('../lib/lowStock');
const stock = require('../lib/stockCounts');

test('parseBags reads a typed list of weights', () => {
  assert.deepStrictEqual(bags.parseBags('1,400g 180, 240 + 600; 900'), [1400, 180, 240, 600, 900]);
  assert.deepStrictEqual(bags.parseBags([100, 'x', 0, 50]), [100, 50]);
  assert.deepStrictEqual(bags.parseBags(''), []);
  assert.strictEqual(bags.total([1400, 180, 240, 600, 900]), 3320);
});

test('suggest picks the bags that reach one batch with the least over', () => {
  const s = bags.suggest([1400, 180, 240, 600, 900], 1600);
  assert.deepStrictEqual(s.use.slice().sort((x, y) => y - x), [1400, 240]); // 1,640 g, the closest to 1,600 without going under
  assert.strictEqual(s.over, 40);
  assert.deepStrictEqual(s.leave.slice().sort((x, y) => y - x), [900, 600, 180]);
});

test('suggest reports a shortfall and uses every bag', () => {
  const s = bags.suggest([500, 300], 1600);
  assert.strictEqual(s.short, 800);
  assert.deepStrictEqual(s.use.sort((a, b) => a - b), [300, 500]);
  assert.deepStrictEqual(s.leave, []);
});

test('suggest prefers fewer bags when the overshoot ties', () => {
  const s = bags.suggest([1000, 600, 400, 600], 1600);
  assert.strictEqual(s.over, 0);
  assert.strictEqual(s.use.length, 2);
});

test('bagged meat is red only below one batch', () => {
  assert.strictEqual(ls.statusOf({ count: 3320, days: null, category: 'Meat', belowBatch: false }), false);
  assert.strictEqual(ls.statusOf({ count: 1500, days: null, category: 'Meat', belowBatch: true }), true);
  assert.strictEqual(ls.statusOf({ count: 0, days: null, category: 'Meat', belowBatch: false }), true);
  assert.strictEqual(ls.statusOf({ count: 180, days: null, category: 'Meat' }), false); // no batch set, no days: not red
});

test('Meat is the first category and meat names are guessed into it', () => {
  assert.strictEqual(stock.CATEGORIES[0], 'Meat');
  assert.strictEqual(stock.guessCategory('Pork shoulder'), 'Meat');
  assert.strictEqual(stock.guessCategory('Bacon slice'), 'Meat');
  assert.strictEqual(stock.guessCategory('Chicken thigh'), 'Meat');
});

test('buildUrgent skips receipt rows for bagged meat and flags the bagged item below a batch', () => {
  const { normName } = require('../lib/priceBook');
  const out = ls.buildUrgent({
    manual: [{ itemName: 'Brisket', currentCount: 1200, unit: 'g', category: 'Meat' }],
    ingredients: [{ name: 'Brisket (Makro)', left: 0, unit: 'g', packs: 0 }],
    bags: { [normName('Brisket')]: { bags: [1200], batch: 1600 } },
  });
  assert.strictEqual(out.filter((x) => /brisket/i.test(x.name)).length, 1);
});
