const test = require('node:test');
const assert = require('node:assert');
const { summarise } = require('../lib/linkClicks');

const now = new Date('2026-11-16T05:00:00Z'); // 16/11/2026 in Bangkok
const rows = [
  ['Date', 'Time', 'LINE User ID', 'Display Name', 'Trigger'],
  ['16/11/2026', '09:00:00', 'u1', 'A', 'order app open (ig)'],
  ['16/11/2026', '10:00:00', '(not signed in)', 'Web visitor', 'order app open (ig)'],
  ['12/11/2026', '10:00:00', 'u2', 'B', 'order app open (ig)'],
  ['01/11/2026', '10:00:00', 'u3', 'C', 'order app open (gnew)'],
  ['15/11/2026', '10:00:00', 'u4', 'D', 'order app open (ad2)'],
  ['15/11/2026', '10:00:00', 'u5', 'E', 'menu'],
  ['15/11/2026', '10:00:00', 'u6', 'F', 'order app open'],
  ['01/10/2026', '10:00:00', 'u7', 'G', 'order app open (ig)'],
];

test('counts today, 7 and 30 days per tag and ignores other triggers', () => {
  const r = summarise(rows, now);
  const ig = r.sources.find((s) => s.tag === 'ig');
  assert.deepStrictEqual([ig.today, ig.d7, ig.d30], [2, 3, 3]);
  const g = r.sources.find((s) => s.tag === 'gnew');
  assert.deepStrictEqual([g.today, g.d7, g.d30], [0, 0, 1]);
  assert.strictEqual(r.sources.find((s) => s.tag === 'ad2').label, 'Meta ads (ad2)');
  assert.strictEqual(r.sources.find((s) => s.tag === '').label, 'No tag');
  assert.deepStrictEqual([r.totals.today, r.totals.d7, r.totals.d30], [2, 5, 6]);
});
test('busiest link over 7 days comes first', () => {
  assert.strictEqual(summarise(rows, now).sources[0].tag, 'ig');
});
test('empty or odd rows are fine', () => {
  assert.deepStrictEqual(summarise([], now).sources, []);
  assert.deepStrictEqual(summarise([['x', 'y', 'z', 'w', 'order app open (ig)']], now).sources, []);
});

const orderRows = [
  ['Date', 'Time', 'Items', 'Order From', 'Type', 'Qty', 'Total', 'Name', 'Address', 'Phone', 'Ref', 'Slip', 'No', 'Link'],
  ['01/11/2026', '10:00:00', '1x A', 'LINE Bot', 'Order', 1, 200, 'x', '', '', '', '', '001', ''],
  ['14/11/2026', '10:00:00', '1x A', 'LINE Bot', 'Order', 1, 200, 'x', '', '', '', '', '001', 'ig'],
  ['16/11/2026', '10:00:00', '1x A', 'LINE Bot', 'Order', 1, 200, 'x', '', '', '', '', '002', 'ig'],
  ['16/11/2026', '11:00:00', '1x A', 'LINE Bot', 'Order', 1, 200, 'x', '', '', '', '', '003', ''],
  ['16/11/2026', '11:00:00', 'Delivery fee', 'LINE Bot', 'Delivery', '', 50, 'x', '', '', '', '', '003', ''],
];
test('orders by link count from the first tagged order and give an order rate', () => {
  const r = summarise(rows, now, orderRows);
  const ig = r.sources.find((s) => s.tag === 'ig');
  assert.deepStrictEqual([ig.o7, ig.o30, ig.rate30], [2, 2, 67]);
  assert.strictEqual(r.sources.find((s) => s.tag === '').o7, 1);
  assert.strictEqual(r.ordersTrackedFrom, '2026-11-14');
  assert.strictEqual(r.totals.o30, 3);
});
test('no tagged orders yet means no order counts', () => {
  const r = summarise(rows, now, [orderRows[0], orderRows[1].slice(0, 13), orderRows[4]]);
  assert.strictEqual(r.totals.o30, 0);
  assert.strictEqual(r.ordersTrackedFrom, null);
});
test('new and returning Grab cards stay next to each other, new first', () => {
  const rows = [
    ['16/11/2026', '10:00:00', 'u1', 'A', 'order app open (gnew)'],
    ['16/11/2026', '10:01:00', 'u2', 'B', 'order app open (rich)'], ['16/11/2026', '10:02:00', 'u3', 'B', 'order app open (rich)'],
    ['16/11/2026', '11:00:00', 'u4', 'C', 'order app open (gback)'], ['16/11/2026', '11:01:00', 'u5', 'C', 'order app open (gback)'],
    ['16/11/2026', '11:02:00', 'u6', 'D', 'order app open (ig)'],
  ];
  const tags = summarise(rows, now).sources.map((s) => s.tag);
  assert.strictEqual(Math.abs(tags.indexOf('gnew') - tags.indexOf('gback')), 1);
  assert.ok(tags.indexOf('gnew') < tags.indexOf('gback'));
});
