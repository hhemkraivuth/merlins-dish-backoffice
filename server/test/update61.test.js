// Update 61: counted stock is linked to recipe ingredients by meaning, retired ingredients leave the plan, swaps apply.
const test = require('node:test');
const assert = require('node:assert');
const { normName } = require('../lib/priceBook');
const { linkStock } = require('../lib/stockLink');
const { parseBlends } = require('../lib/blends');
const { countedToStock } = require('../lib/countedStock');

const needs = ['Beef - brisket', 'Beef - chuck roll', 'Chicken - thigh', 'Pork - minced', 'Pork - sholder', 'Knorr cube - beef', 'Knorr cube - pork full',
  'Wine - Red - blend', "Campbell's - Chicken mushroom", "Campbell's - Mushroom", 'Packaging Cup (12oz)', 'Packaging Cup (26oz)', 'Packaging Cup (16oz)', 'Pelati', 'Homestyle bacon', 'Butter']
  .map((name) => ({ key: normName(name), name }));
const stockNames = ['Brisket', 'Chuck', 'Chicken thigh', 'Pork mince', 'Pork shoulder', 'Knorr - beef', 'Knorr - Pork', 'Wine - Ti', 'Wine - Familia', "Campbell's - Chicken Mushroom", "Campbell's - Mushroom",
  'Packaging Cup (12oz)', 'Packaging Cup (26oz)', 'Packaging Cup (16oz)', 'Pelati', 'Bacon steak', 'Foil']
  .map((name) => ({ key: normName(name), name }));
const blends = parseBlends([['Blend', 'Ingredient', 'Parts'], ['Red Wine', 'Wine - Ti', 1], ['Red Wine', 'Wine - Familia', 1]]);

test('stock names that differ from recipe names are linked by meaning', () => {
  const { assign, unlinked } = linkStock(needs, stockNames, { blends });
  const to = (n) => assign.get(normName(n));
  assert.strictEqual(to('Brisket'), normName('Beef - brisket'));
  assert.strictEqual(to('Chuck'), normName('Beef - chuck roll'));
  assert.strictEqual(to('Chicken thigh'), normName('Chicken - thigh'));
  assert.strictEqual(to('Pork mince'), normName('Pork - minced'));
  assert.strictEqual(to('Pork shoulder'), normName('Pork - sholder'), 'a spelling slip in the recipe still links');
  assert.strictEqual(to('Knorr - beef'), normName('Knorr cube - beef'));
  assert.strictEqual(to('Knorr - Pork'), normName('Knorr cube - pork full'));
  assert.strictEqual(to('Wine - Ti'), normName('Wine - Red - blend'));
  assert.strictEqual(to('Wine - Familia'), normName('Wine - Red - blend'));
  assert.strictEqual(to("Campbell's - Mushroom"), normName("Campbell's - Mushroom"), 'the exact name beats the longer one that also contains it');
  assert.strictEqual(to("Campbell's - Chicken Mushroom"), normName("Campbell's - Chicken mushroom"));
  assert.strictEqual(to('Packaging Cup (12oz)'), normName('Packaging Cup (12oz)'));
  assert.deepStrictEqual(unlinked.map((u) => u.name).sort(), ['Bacon steak', 'Foil']);
});

test('a link set by hand wins, and a brand change joins old and new names', () => {
  const r = linkStock(needs, stockNames, { blends, links: { [normName('Bacon steak')]: 'Homestyle bacon' } });
  assert.strictEqual(r.assign.get(normName('Bacon steak')), normName('Homestyle bacon'));
  const sw = linkStock([{ key: 'chiangmai winter', name: 'Chiangmai Winter' }], [{ key: 'stout', name: 'Stout' }], { swaps: [{ from: 'Stout', to: 'Chiangmai Winter' }] });
  assert.strictEqual(sw.assign.get('stout'), 'chiangmai winter');
});

test('different things are not linked by accident', () => {
  const r = linkStock([{ key: 'butter', name: 'Butter' }, { key: 'peanut butter', name: 'Peanut butter' }], [{ key: 'cheese', name: 'Cheese' }, { key: 'butter', name: 'Butter' }]);
  assert.strictEqual(r.assign.get('butter'), 'butter');
  assert.strictEqual(r.assign.has('cheese'), false);
});

test('tins counted with no size are kept as pieces, sizes in brackets keep cups apart, sets count as pieces', () => {
  const r = countedToStock([
    { itemName: "Campbell's - Mushroom", unit: 'tin', currentCount: 10 },
    { itemName: 'Packaging Cup (12oz)', unit: 'Set', currentCount: 300 },
    { itemName: 'Packaging Cup (26oz)', unit: 'Set', currentCount: 200 },
    { itemName: 'Stout (Chiangmai Winter)', unit: 'can', currentCount: 2 },
  ], { [normName('Stout (Chiangmai Winter)')]: { size: 490, unit: 'ml' } }, normName);
  assert.deepStrictEqual(r.loose.get(normName("Campbell's - Mushroom")), { left: 10, unit: 'piece', word: 'tin' });
  assert.strictEqual(r.stock.get(normName('Packaging Cup (12oz)')).left, 300);
  assert.strictEqual(r.stock.get(normName('Packaging Cup (26oz)')).left, 200);
  assert.strictEqual(r.stock.get('stout').left, 980);
});

test('an ingredient missing from the dish\'s two latest batches leaves the plan, and swaps rename old batches', () => {
  const { usageOf } = require('../lib/shoppingPlan');
  const dish = 'Dark beer Stew';
  const log = [['Key', 'Date', 'Dish', 'Portions'], ['b1', '2026-09-01', dish, 10], ['b2', '2026-10-01', dish, 10], ['b3', '2026-10-20', dish, 10], ['b4', '2026-11-01', dish, 10], ['b5', '2026-11-03', dish, 10]];
  const L = (b, name, qty) => [b, '', '', 'Ingredient', name, qty, 'g'];
  const lines = [['Key', '', '', 'Kind', 'Name', 'Qty', 'Unit'],
    L('b1', 'Spacecraft', 500), L('b1', 'Beef', 1000), L('b2', 'Spacecraft', 500), L('b2', 'Beef', 1000), L('b3', 'Spacecraft', 500), L('b3', 'Beef', 1000),
    L('b4', 'Chiangmai Winter', 500), L('b4', 'Beef', 1000)];
  const names = (rows) => [...usageOf(log.slice(0, rows), [], lines).perDish.get(dish).lines.values()].map((l) => l.name).sort();
  assert.deepStrictEqual(names(5), ['Beef', 'Chiangmai Winter', 'Spacecraft'], 'still in the second latest batch with lines');
  lines.push(L('b5', 'Chiangmai Winter', 500), L('b5', 'Beef', 1000));
  assert.deepStrictEqual(names(6), ['Beef', 'Chiangmai Winter'], 'gone once two newer batches no longer use it');
  const swapped = usageOf(log, [], lines, [{ dish: '*', line: 'Spacecraft', to: 'Chiangmai Winter' }]).perDish.get(dish);
  assert.deepStrictEqual([...swapped.lines.values()].map((l) => l.name).sort(), ['Beef', 'Chiangmai Winter']);
  assert.ok([...swapped.lines.values()].find((l) => l.name === 'Chiangmai Winter').qty > 1000, 'old batches count under the new name');
});

test('the plan uses counted stock held under another name and honours Stop buying', () => {
  const { buildShoppingPlan } = require('../lib/shoppingPlan');
  const today = new Date(Date.UTC(2026, 10, 9));
  const dish = 'Red Wine Beef Stew';
  const sales = [{ date: new Date(Date.UTC(2026, 8, 5)), dish, qty: 60 }, { date: new Date(Date.UTC(2026, 7, 5)), dish, qty: 60 }];
  const log = [['Key', 'Date', 'Dish', 'Portions'], ['b1', '2026-10-30', dish, 10], ['b2', '2026-11-02', dish, 10]];
  const L = (b, name, qty, unit = 'g', kind = 'Ingredient') => [b, '', '', kind, name, qty, unit];
  const lines = [['Key', '', '', 'Kind', 'Name', 'Qty', 'Unit']];
  for (const b of ['b1', 'b2']) lines.push(L(b, 'Knorr cube - beef', 4, 'piece'), L(b, 'Spacecraft', 400), L(b, 'Beef - brisket', 2000));
  const stock = new Map([['brisket', { left: 4820, unit: 'g' }], ['knorr - beef', { left: 47, unit: 'piece' }]]);
  const base = { today, sales, cookLogRows: log, lineRows: lines, stock, stockNames: new Map([['brisket', 'Brisket'], ['knorr - beef', 'Knorr - beef']]) };
  const all = (p) => [...p.fresh.items, ...p.bulk.groups.flatMap((g) => g.items)];
  const before = buildShoppingPlan(base);
  const brisket = all(before).find((i) => i.name === 'Beef - brisket');
  assert.ok(brisket, 'brisket is in the plan');
  assert.strictEqual(brisket.handSource, 'counted');
  assert.strictEqual(brisket.onHand, 4820);
  const knorr = all(before).find((i) => i.name === 'Knorr cube - beef');
  assert.ok(!knorr || knorr.onHand === 47, 'knorr counted stock is read');
  assert.ok(all(before).some((i) => i.name === 'Spacecraft'));
  const after = buildShoppingPlan({ ...base, retired: ['Spacecraft'] });
  assert.ok(!all(after).some((i) => i.name === 'Spacecraft'), 'retired ingredient is gone');
  assert.deepStrictEqual(after.retired, ['spacecraft']);
});
