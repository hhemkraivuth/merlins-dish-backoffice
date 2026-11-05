const test = require('node:test');
const assert = require('node:assert');
const { utc } = require('../lib/dates');
const { buildPit, openRows } = require('../lib/pit');

const today = utc(2026, 11, 5);
const row = (o) => ({ date: utc(2026, 11, 4), dmy: '04/11/2026', desc: '', channel: 'Grab', orderFrom: '', type: 'Order', qty: 1, moneyIn: 0, cost: 0, net: 0, customer: '', orderNo: '', time: '', key: '', flags: '', ...o });

test('pit has the four teams and says how far each one runs', () => {
  const ledger = [
    row({ channel: 'Grab', type: 'Order', net: 300, orderNo: 'GF-1' }),
    row({ channel: 'Grab', type: 'Grab', desc: 'Order commission', net: -90, orderNo: '' }),
    row({ channel: 'LINE', type: 'Order', date: utc(2026, 11, 5), dmy: '05/11/2026', net: 330, orderNo: '#001' }),
  ];
  const cookBatches = [{ key: 'k1', date: utc(2026, 11, 3), dish: 'Noir Ragu', portions: 10, cost: 800 }];
  const purchases = [{ date: utc(2026, 11, 2), name: 'minced pork', amount: 110 }, { date: utc(2026, 11, 2), name: 'pot', amount: 2575, kind: 'overhead' }];
  const handoffRows = [['Raised', 'From', 'To', 'Message', 'Status', 'Reply', 'Key'],
    ['04/11/2026', 'Operations', 'App sales, Direct sales', 'Noir Ragu is sold out.', 'Open', '', 'k'],
    ['03/11/2026', 'Purchasing', 'Operations', 'Pork is up 12%.', 'Done', '', 'k2']];
  const pit = buildPit({ today, ledger, cookBatches, purchases, handoffRows, stock: [{ dish: 'Noir Ragu', remaining: 4, oldestAgeDays: 2 }] });
  assert.deepStrictEqual(pit.teams.map((t) => t.name), ['App sales', 'Direct sales', 'Operations', 'Purchasing']);
  const [app, direct, ops, buy] = pit.teams;
  assert.strictEqual(app.asOf, '04/11/2026');
  assert.match(app.updates[0], /1 order, ฿300 gross, ฿210 after fees/);
  assert.match(direct.updates[0], /today/);
  assert.match(ops.updates[0], /Noir Ragu, 10 portions \(฿80 a portion\)/);
  assert.match(ops.updates.join(' '), /Noir Ragu 4 \(oldest 2d\)/);
  assert.match(buy.updates[0], /1 item, ฿110/);
  assert.strictEqual(pit.openTotal, 1);
  assert.strictEqual(app.open.length, 1);
  assert.strictEqual(direct.open.length, 1);
  assert.strictEqual(ops.open.length, 1);
  assert.strictEqual(buy.open.length, 0);
});

test('pit copes with nothing logged', () => {
  const pit = buildPit({ today });
  assert.strictEqual(pit.teams.length, 4);
  assert.match(pit.teams[0].updates[0], /No Grab data/);
  assert.strictEqual(pit.openTotal, 0);
});

test('pit warns when Grab data is behind and flags a low yield batch', () => {
  const ledger = [row({ date: utc(2026, 11, 1), dmy: '01/11/2026', net: 100, orderNo: 'GF-9' })];
  const pit = buildPit({ today, ledger, cookBatches: [{ key: 'k', date: utc(2026, 11, 4), dish: 'Bolognese', portions: 3, cost: 300 }] });
  assert.match(pit.teams[0].updates.join(' '), /behind/);
  assert.match(pit.teams[2].updates.join(' '), /Low yield this week: Bolognese 3/);
});

test('openRows keeps only open handoffs, newest first', () => {
  const rows = [['h'], ['01/11', 'a', 'b', 'first', 'Open'], ['02/11', 'a', 'b', 'second', 'Open'], ['03/11', 'a', 'b', 'third', 'Done (cleared)']];
  assert.deepStrictEqual(openRows(rows).map((r) => r.message), ['second', 'first']);
});
