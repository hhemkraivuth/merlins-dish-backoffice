const test = require('node:test');
const assert = require('node:assert');
const { parseManualOrders } = require('../lib/manualOrder');
const { utc } = require('../lib/dates');
const today = utc(2026, 11, 4);

test('direct orders typed by hand become LINE ledger rows that add up', () => {
  const { orders, problems } = parseManualOrders(`23/10 Cee / นนทรียา
Red Wine Beef Stew (Regular) 285
Noir Ragu + Pasta (Radiatori) 230
Polished Pork Bolognese + Pasta (Rigatoni) 195
delivery 50
total 760

28/10 Sasha
Polished Pork Bolognese + Pasta (Spaghetti) 195
Creamy Chicken Soup 165
total 360`, today);
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual(orders.map((o) => [o.dmy, o.name, o.total]), [['23/10/2026', 'Cee / นนทรียา', 760], ['28/10/2026', 'Sasha', 360]]);
  assert.strictEqual(orders[0].rows.length, 4);
  assert.deepStrictEqual(orders[0].rows[3].slice(1, 9), ['Delivery fee charged', 'LINE', 'LINE', 'Delivery', 1, 50, '', 50]);
  assert.ok(orders[0].rows[0][10].startsWith('#M'));
  assert.ok(orders[0].rows[0][12].startsWith('L|M'));
});

test('a total that does not match refuses the order', () => {
  const { orders, problems } = parseManualOrders('23/10 Tin\nRed Wine Beef Stew (Regular) 285\nTubetti (Extra) 45\ntotal 340', today);
  assert.strictEqual(orders.length, 0);
  assert.match(problems[0], /add to 330 but you wrote total 340/);
});

test('quantity prefix and the same order twice give the same keys', () => {
  const a = parseManualOrders('02/11 Tin\n2x Tubetti (Extra) 45', today).orders[0];
  const b = parseManualOrders('02/11 Tin\n2x Tubetti (Extra) 45', today).orders[0];
  assert.strictEqual(a.total, 90);
  assert.strictEqual(a.rows[0][5], 2);
  assert.deepStrictEqual(a.rows.map((r) => r[12]), b.rows.map((r) => r[12]));
});

test('ig after the date marks the order as Instagram', () => {
  const { parseManualOrders } = require('../lib/manualOrder');
  const r = parseManualOrders('23/10 ig Cee\nCreamy Chicken Soup 165\n', new Date(Date.UTC(2026, 9, 25)));
  assert.strictEqual(r.problems.length, 0);
  assert.strictEqual(r.orders[0].name, 'Cee');
  assert.strictEqual(r.orders[0].rows[0][2], 'LINE');
  assert.strictEqual(r.orders[0].rows[0][3], 'Instagram');
});
