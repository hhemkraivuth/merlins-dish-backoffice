const test = require('node:test');
const assert = require('node:assert');
const { eventsFromRows, buildHistory, heatmap, monthlyResult } = require('../lib/analysis');
const { snapshotFromMenu } = require('../lib/botStock');
const { weekStart } = require('../lib/reports');
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const row = (date, desc, from, type, qty, price, net) => [date, desc, '', from, type, String(qty), String(price), '0', String(net)];

test('sales are portions x price (Net Income), not the price of one portion', () => {
  const ev = eventsFromRows([row('23/11/2025', 'Pot Pie', '', 'Order', 3, 155, 465)], { carryDate: true });
  assert.strictEqual(ev[0].money, 465);
});

test('from May a blank Order from is Grab, before May it is a direct customer', () => {
  const ev = eventsFromRows([row('10/03/2026', 'A', 'K Ja', 'Order', 1, 100, 100), row('10/06/2026', 'B', '', 'Order', 2, 100, 200), row('10/06/2026', 'C', 'Grab-N', 'Order', 1, 50, 50), row('10/06/2026', 'D', 'Line', 'Order', 1, 50, 50), row('10/07/2026', 'E', 'IG', 'Order', 1, 50, 50)]);
  assert.deepStrictEqual(ev.map((e) => e.channel), ['line', 'grab', 'grab', 'line', 'ig']);
});

test('weeks start on Sunday and end on Saturday', () => {
  assert.strictEqual(weekStart(utc(2026, 11, 6)).toISOString().slice(0, 10), '2026-11-01'); // Friday
  assert.strictEqual(weekStart(utc(2026, 11, 7)).toISOString().slice(0, 10), '2026-11-01'); // Saturday
  assert.strictEqual(weekStart(utc(2026, 11, 8)).toISOString().slice(0, 10), '2026-11-08'); // Sunday
});

test('history runs monthly from Nov 2025', () => {
  const ev = eventsFromRows([row('23/11/2025', 'Pot Pie', '', 'Order', 3, 155, 465)]);
  const h = buildHistory({ events: ev, today: utc(2026, 1, 10) });
  assert.strictEqual(h.months[0].key, '2025-11');
  assert.strictEqual(h.months[0].line, 465);
});

test('weekday map runs Sunday to Saturday and 10:00 to 22:00', () => {
  const mk = (dmy, d, time) => ({ type: 'Order', date: d, dmy, channel: 'Grab', orderNo: dmy + time, time, customer: 'x' });
  const hm = heatmap([mk('05/10/2026', utc(2026, 10, 5), '12:10'), mk('10/10/2026', utc(2026, 10, 10), '12:10')]);
  assert.deepStrictEqual(hm.days, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  assert.strictEqual(hm.hours[0], '10'); assert.strictEqual(hm.hours[hm.hours.length - 1], '22');
  assert.strictEqual(hm.perDay[1], 1); assert.strictEqual(hm.perDay[6], 1); assert.strictEqual(hm.perDay[0], 0);
});

test('monthly result: sales less every cost row', () => {
  const m = monthlyResult([row('15/11/2025', 'Ads', '', 'Ads', 1, 0, -522), row('23/11/2025', 'Pot Pie', '', 'Order', 3, 155, 465)]);
  assert.strictEqual(m.months[0].sales, 465);
  assert.strictEqual(m.months[0].costs, 522);
});

test('stock left from the bot menu: counts and sold out only', () => {
  const s = snapshotFromMenu({ items: [{ name: 'Bolo', remaining: 4, available: true }, { name: 'Soup', remaining: null, available: false }, { name: 'Pie', remaining: null, available: true }] }, 'T');
  assert.deepStrictEqual(s.items, [{ name: 'Bolo', left: 4, soldOut: false, sizes: [] }, { name: 'Soup', left: null, soldOut: true, sizes: [] }]);
});

test('monthly result uses the Master Log only to September', () => {
  const m = monthlyResult([row('23/09/2026', 'A', '', 'Order', 1, 100, 100), row('03/10/2026', 'B', '', 'Order', 1, 500, 500)]);
  assert.deepStrictEqual(m.months.map((x) => x.key), ['2026-09']);
});
