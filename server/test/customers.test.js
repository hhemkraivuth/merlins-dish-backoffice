const test = require('node:test');
const assert = require('node:assert');
const { normalisePhone, buildCustomerList, summarise, planCustomerWrite } = require('../lib/customers');

const HEAD = ['Phone', 'Customer Name', 'Order Count', 'Last Order Date', 'LINE User ID', 'Last lat', 'Last lng', 'Last address', 'Last rider note'];
const today = Date.UTC(2026, 10, 19);

test('phones are normalised the same way as the order app', () => {
  assert.strictEqual(normalisePhone('081 565 6584'), '0815656584');
  assert.strictEqual(normalisePhone('+66815656584'), '0815656584');
  assert.strictEqual(normalisePhone('815656584'), '0815656584');
  assert.strictEqual(normalisePhone('12'), null);
});

test('a new customer is appended with one order and the phone kept as text', () => {
  const plan = planCustomerWrite([HEAD], { phone: '081 565 6584', name: 'Jong', address: 'The Address Asoke', dmy: '19/11/2026' });
  assert.strictEqual(plan.action, 'append');
  assert.strictEqual(plan.row[0], "'0815656584");
  assert.deepStrictEqual([plan.row[1], plan.row[2], plan.row[3], plan.row[7]], ['Jong', 1, '19/11/2026', 'The Address Asoke']);
});

test('a returning customer gets one more order and a changed address clears the old map pin', () => {
  const rows = [HEAD, ['0815656584', 'Jong', '4', '10/11/2026', 'Uabc', '13.7', '100.5', 'Old place', '']];
  const plan = planCustomerWrite(rows, { phone: '0815656584', name: 'Jong', address: 'The Address Asoke', dmy: '19/11/2026' });
  assert.strictEqual(plan.action, 'update');
  assert.strictEqual(plan.count, 5);
  const by = Object.fromEntries(plan.cells.map((c) => [c.range, c.values[0][0]]));
  assert.strictEqual(by['Customers!C2'], 5);
  assert.strictEqual(by['Customers!D2'], '19/11/2026');
  assert.strictEqual(by['Customers!H2'], 'The Address Asoke');
  assert.strictEqual(by['Customers!F2'], '');
  assert.strictEqual(by['Customers!G2'], '');
  assert.ok(!Object.keys(by).some((k) => k.startsWith('Customers!E')), 'LINE id is never touched');
});

test('an older order does not move the last order date back, and a missing phone is skipped', () => {
  const rows = [HEAD, ['0815656584', 'Jong', '2', '18/11/2026', '', '', '', '', '']];
  const plan = planCustomerWrite(rows, { phone: '0815656584', name: '', address: '', dmy: '10/11/2026' });
  assert.ok(!plan.cells.some((c) => c.range === 'Customers!D2'));
  assert.strictEqual(planCustomerWrite(rows, { phone: '', name: 'X', dmy: '10/11/2026' }).action, 'skip');
});

test('the list shows reward status and the summary counts repeat and quiet customers', () => {
  const rows = [HEAD,
    ['0811111111', 'A', '1', '18/11/2026', 'U1', '', '', 'x', ''],
    ['0822222222', 'B', '5', '01/10/2026', '', '', '', '', ''],
    ['0833333333', 'C', '4', '15/11/2026', '', '', '', 'y', '']];
  const list = buildCustomerList(rows, today);
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list[1].canLow, true);
  assert.strictEqual(list[1].status, 'Bacon Steak ready (5)');
  assert.strictEqual(list[0].daysSince, 1);
  const s = summarise(list);
  assert.deepStrictEqual([s.customers, s.repeat, s.rewardReady, s.nearReward, s.lapsed], [3, 2, 1, 1, 1]);
});
