const test = require('node:test');
const assert = require('node:assert');
const { buildAnalysis } = require('../lib/analysis');
const { summarise } = require('../lib/reports');
const { utc } = require('../lib/dates');

const row = (d, desc, channel, type, qty, net, orderNo) => ({ date: d, dmy: '', desc, channel, orderFrom: '', type, qty, moneyIn: net, cost: null, net, customer: '', orderNo, flags: '' });
const ledger = [
  row(utc(2026, 9, 29), 'Noir Ragu', 'LINE', 'Order', 2, 400, 'S1'),
  row(utc(2026, 10, 6), 'Noir Ragu', 'LINE', 'Order', 3, 600, 'A1'),
  row(utc(2026, 10, 7), 'Tubetti', 'Grab', 'Order', 1, 100, 'G1'),
  row(utc(2026, 10, 14), 'Noir Ragu', 'LINE', 'Order', 5, 1000, 'A2'),
];
const today = utc(2026, 10, 20);
const weekly = summarise(ledger, [], [], 'week', { through: today });
const monthly = summarise(ledger, [], [], 'month', { through: today });

test('analysis starts in October and counts orders and portions', () => {
  const a = buildAnalysis({ weekly, monthly, ledger, today });
  assert.ok(a.months.every((m) => m.label.includes('/2026')) && a.months.length === 1, 'only October');
  assert.strictEqual(a.months[0].gross, 1700);
  assert.strictEqual(a.months[0].orders, 3);
  assert.strictEqual(a.months[0].aov, Math.round(1700 / 3));
  const ragu = a.mix[0].items.find((i) => i.name === 'Noir Ragu');
  assert.strictEqual(ragu.qty, 8); // 29 Sept row is left out
});

test('the current week is flagged as not finished, the first week as starting in September', () => {
  const a = buildAnalysis({ weekly, monthly, ledger, today });
  assert.ok(a.weeks[0].startsBeforeOct);
  assert.ok(a.weeks[a.weeks.length - 1].inProgress);
});

test('empty data does not crash', () => {
  const a = buildAnalysis({ weekly: [], monthly: [], ledger: [], today });
  assert.deepStrictEqual(a.weeks, []);
});

const A = require('../lib/analysis');
const { periodOf } = require('../lib/reports');

test('channels are sorted into Grab, LINE and Instagram, from either column', () => {
  assert.strictEqual(A.channelFromText('Grab', ''), 'grab');
  assert.strictEqual(A.channelFromText('LINE', 'Instagram'), 'ig');
  assert.strictEqual(A.channelFromText('LINE', 'LINE'), 'line');
  assert.strictEqual(A.channelFromText('', 'GrabFood-n'), 'grab');
});

test('history: Master Log before September, Ledger from September, a September row in both is counted once', () => {
  const master = [['Date', 'Description', 'Branch', 'Order from', 'Type', 'QTY', 'Money In'],
    ['10/11/2025', 'Noir Ragu', 'LINE', 'Instagram', 'Order', 2, 400, 0, 400],
    ['', 'Tubetti', 'LINE', 'LINE', 'Order', 1, 100, 0, 100], // blank date carries the day above
    ['12/05/2026', 'Noir Ragu', 'Grab', '', 'Order', 3, 900, 0, 900]];
  const ledgerRow = (d, desc, ch, from, q, m, no) => ({ date: d, dmy: '', desc, channel: ch, orderFrom: from, type: 'Order', qty: q, moneyIn: m, net: m, customer: '', orderNo: no });
  const ledger = [ledgerRow(utc(2026, 9, 5), 'Noir Ragu', 'LINE', 'LINE', 2, 400, 'S1')];
  const sheet1 = [['Date'], ['05/09/2026', 'Noir Ragu', 'LINE', 'LINE', 'Order', 2, 400, 0, 400, 'x', 'S1']];
  const { events } = A.allEvents({ master, sheet1, ledger });
  assert.strictEqual(events.length, 4, 'three master rows plus one September row');
  const h = A.buildHistory({ events, today: utc(2026, 10, 20) });
  const nov = h.months.find((m) => m.key === '2025-11');
  assert.strictEqual(nov.ig, 400); assert.strictEqual(nov.line, 100);
  assert.strictEqual(h.months.find((m) => m.key === '2026-05').grab, 900);
  assert.ok(h.months.find((m) => m.key === '2026-01'), 'quiet months still appear');
  assert.strictEqual(h.months[0].key, '2025-11');
});

test('repeat customers and the weekday by hour map', () => {
  const o = (d, c, no, time) => ({ date: d, dmy: `${d.getUTCDate()}/10`, desc: 'Noir Ragu', channel: 'LINE', orderFrom: 'LINE', type: 'Order', qty: 1, moneyIn: 200, net: 200, customer: c, orderNo: no, time });
  const ledger = [o(utc(2026, 10, 6), 'Ann', '1', '5:10PM'), o(utc(2026, 10, 8), 'Ann', '2', '5:40PM'), o(utc(2026, 10, 8), 'Bo', '3', '12:05PM')];
  const r = A.repeatCustomers(ledger, 'month').get('2026-10');
  assert.deepStrictEqual(r, { newOrders: 2, repeatOrders: 1 });
  const hm = A.heatmap(ledger);
  assert.strictEqual(hm.total, 3);
  assert.strictEqual(hm.cells[1][hm.hours.indexOf('17')], 1); // Tuesday 06/10 at 17h
});
