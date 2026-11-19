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

const { planCustomerEdit, planMerge } = require('../lib/customers');

test('redeeming resets the count to 0 only when the customer is eligible', () => {
  const rows = [HEAD, ['0815656584', 'Jong', '6', '10/11/2026', '', '', '', '', ''], ['0822222222', 'B', '3', '10/11/2026', '', '', '', '', ''], ['0833333333', 'C', '10', '10/11/2026', '', '', '', '', '']];
  const ok = planCustomerWrite(rows, { phone: '0815656584', name: 'Jong', dmy: '19/11/2026', redeem: 5 });
  assert.strictEqual(ok.count, 0);
  assert.strictEqual(ok.cells.find((c) => c.range === 'Customers!C2').values[0][0], 0);
  assert.strictEqual(planCustomerWrite(rows, { phone: '0822222222', dmy: '19/11/2026', redeem: 5 }).action, 'skip');
  assert.strictEqual(planCustomerWrite(rows, { phone: '0815656584', dmy: '19/11/2026', redeem: 10 }).action, 'skip');
  assert.strictEqual(planCustomerWrite(rows, { phone: '0833333333', dmy: '19/11/2026', redeem: 5 }).action, 'skip');
  assert.strictEqual(planCustomerWrite(rows, { phone: '0833333333', dmy: '19/11/2026', redeem: 10 }).count, 0);
});

test('editing a customer checks the row, validates, and clears the pin on a new address', () => {
  const rows = [HEAD, ['0815656584', 'Jong', '4', '10/11/2026', 'Uabc', '13.7', '100.5', 'Old', '']];
  const edit = planCustomerEdit(rows, { row: 2, expectPhone: '0815656584', name: 'Robin P', phone: '081-565-6584', orders: '1', lastOrder: '19/11/2026', address: 'New place', note: '' });
  const by = Object.fromEntries(edit.cells.map((c) => [c.range, c.values[0][0]]));
  assert.strictEqual(by['Customers!A2'], "'0815656584");
  assert.strictEqual(by['Customers!B2'], 'Robin P');
  assert.strictEqual(by['Customers!C2'], 1);
  assert.strictEqual(by['Customers!F2'], '');
  assert.ok(!('Customers!E2' in by));
  assert.throws(() => planCustomerEdit(rows, { row: 2, expectPhone: '0899999999', phone: '0815656584', orders: 1 }), /changed since the page loaded/);
  assert.throws(() => planCustomerEdit(rows, { row: 2, expectPhone: '0815656584', phone: '12', orders: 1 }), /phone number/);
  assert.throws(() => planCustomerEdit(rows, { row: 2, expectPhone: '0815656584', phone: '0815656584', orders: 'x' }), /whole number/);
  assert.throws(() => planCustomerEdit(rows, { phone: '0815656584', orders: 0 }), /already on the list/);
  assert.strictEqual(planCustomerEdit(rows, { phone: '0877777777', name: 'New', orders: 0 }).action, 'append');
});

test('merging adds the orders, keeps the newest date and LINE id, and blanks the other row', () => {
  const rows = [HEAD, ['0959539401', 'นทิน', '2', '11/11/2026', 'Uline', '', '', '', ''], ['0959539401', 'นทิน', '2', '02/11/2026', '', '', '', 'Some address', '']];
  const plan = planMerge(rows, { keepRow: 2, dropRow: 3, expectKeepPhone: '0959539401', expectDropPhone: '0959539401' });
  const by = Object.fromEntries(plan.cells.map((c) => [c.range, c.values[0]]));
  assert.strictEqual(plan.total, 4);
  assert.strictEqual(by['Customers!C2'][0], 4);
  assert.strictEqual(by['Customers!D2'][0], '11/11/2026');
  assert.strictEqual(by['Customers!E2'][0], 'Uline');
  assert.strictEqual(by['Customers!H2'][0], 'Some address');
  const blank = plan.cells.find((c) => c.range.startsWith('Customers!A3:'));
  assert.ok(blank.values[0].every((v) => v === ''));
  assert.strictEqual(planMerge(rows, { keepRow: 2, dropRow: 3, expectKeepPhone: '0959539401', expectDropPhone: '0959539401', orders: 3 }).total, 3);
  assert.throws(() => planMerge(rows, { keepRow: 2, dropRow: 2 }), /two different/);
});
