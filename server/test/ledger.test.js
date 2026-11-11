const test = require('node:test');
const assert = require('node:assert');
const { utc } = require('../lib/dates');
const { parseCsv } = require('../lib/csv');
const { grabCsvToLedger, lineOrdersToLedger, ledgerObjects, COL } = require('../lib/ledger');
const { summarise, sellThrough, priceMoves, periodOf } = require('../lib/reports');
const { currentHandoffs, reconcile, openHandoffs } = require('../lib/handoffs');
const { buildHuddle, buildPeriodText } = require('../lib/huddle');
const { startHuddleTimer } = require('../lib/scheduler');
const { processReports } = require('../lib/reportCommands');
const { batchDishOf } = require('../lib/dishes');

const HEAD = 'Date,Description,Branch,Order from,Type,QTY (Portion),Money In,Cost,Net Income,Customer Name,Grab Order Number,Time';
// Real rows from the Claude Log (08/09/2026), plus an unpadded date and an XXXXXX name.
const GRAB = `﻿${HEAD}
08/09/2026,Red Wine Beef Stew (Large 525g),,Grab-N,Order,1,410.00,0.00,410.00,John Belmont,GF-989,17:14
08/09/2026,Rigatoni (paired with Red Wine Beef Stew),,,Order,1,50.00,0.00,50.00,,,
08/09/2026,Merchant funded discount (30%),,,Grab,1,0.00,66.00,-66.00,,,
08/09/2026,Order commission (30%),,,Grab,1,0.00,100.00,-100.00,,,
08/09/2026,Marketing success fee,,,Grab,1,0.00,20.00,-20.00,,,
08/09/2026,Rigatoni,,,Recipe,1,0.00,8.38,-8.38,,,
9/9/2026,Noir Ragu,,Grab-RT,Order,2,250.00,,500.00,XXXXXX,GF-100,12:22
9/9/2026,"Order commission, (30%)",,,Grab,,,150.00,-150.00,,,
9/9/2026,Radiatori,,,Recipe,2,,7.04,,,,`;

test('csv reader handles BOM, quotes and CRLF', () => {
  const t = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n');
  assert.deepStrictEqual(t, [['a', 'b'], ['x, y', 'he said "hi"']]);
});

test('Grab CSV: blocks carry forward, nets are kept or rebuilt, flags raised', () => {
  const { rows, dates, problems } = grabCsvToLedger(GRAB);
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual([...dates].sort(), ['08/09/2026', '09/09/2026']);
  assert.strictEqual(rows.length, 9);
  // pasta row inherits the block's order number, order from, customer and time
  assert.deepStrictEqual([rows[1][COL.orderNo], rows[1][COL.orderFrom], rows[1][COL.customer], rows[1][COL.time]], ['GF-989', 'Grab-N', 'John Belmont', '17:14']);
  assert.strictEqual(rows[2][COL.net], -66);
  assert.strictEqual(rows[6][COL.date], '09/09/2026');            // 9/9/2026 normalised
  assert.strictEqual(rows[7][COL.net], -150);                      // quoted comma in description, net kept
  assert.strictEqual(rows[8][COL.net], -14.08);                    // Recipe net rebuilt: -(2 x 7.04)
  assert.match(rows[6][COL.flags], /XXXXXX/);
  assert.ok(rows.every((r) => r[COL.channel] === 'Grab' && r[COL.key]));
  assert.strictEqual(new Set(rows.map((r) => r[COL.key])).size, rows.length);
});

test('Grab CSV: wrong file is refused with a clear reason', () => {
  const out = grabCsvToLedger('Name,Amount\nx,1');
  assert.strictEqual(out.rows.length, 0);
  assert.match(out.problems[0], /Missing columns/);
});

const ORDERS = [
  ['Date', 'Time', 'Items', 'Order From', 'Type', 'Qty (Portions)', 'Total (THB)', 'Customer Name', 'Address', 'Phone', 'Slip Ref', 'Slip URL', 'Order No'],
  ['02/11/2026', '14:28:05', '2x Noir Ragu + Pasta (Radiatori) (฿225), 1x Bacon Steak (฿95), 1x Coke Zero Zero (฿38)', 'LINE Bot', 'Order', 4, '583', 'Anna', '12 Soi Asok', "'0815656587", 'REF1', 'http://slip', "'001"],
  ['02/11/2026', '14:28:05', 'Promo discount (WELCOME)', 'LINE Bot', 'Discount', '', -45, 'Anna', '', '', 'REF1', '', "'001"],
  ['02/11/2026', '15:00:00', '1x Tuscan Pork Braise (฿245)', 'LINE Bot', 'Order', 1, 245, 'Ben', 'x', "'0811111111", 'REF2', '', "'002"],
  ['02/11/2026', '15:10:00', '1x Mystery', 'Grab', 'Order', 1, 1, 'x', '', '', '', '', ''],
];

test('LINE orders: one row per item, discount kept, header skipped, no address or phone copied', () => {
  const { rows, problems } = lineOrdersToLedger(ORDERS);
  assert.deepStrictEqual(problems, []);
  assert.strictEqual(rows.length, 5);                              // 3 items + discount + 1 item
  assert.deepStrictEqual(rows[0].slice(0, 9), ['02/11/2026', 'Noir Ragu + Pasta (Radiatori)', 'LINE', 'LINE', 'Order', 2, 225, '', 450]);
  assert.strictEqual(rows[0][COL.orderNo], '#001');
  assert.strictEqual(rows[3][COL.type], 'Discount');
  assert.strictEqual(rows[3][COL.net], -45);
  assert.ok(!JSON.stringify(rows).includes('Soi Asok') && !JSON.stringify(rows).includes('0815656587'));
  // re-reading gives identical keys, so a second sync adds nothing
  assert.deepStrictEqual(lineOrdersToLedger(ORDERS).rows.map((r) => r[COL.key]), rows.map((r) => r[COL.key]));
});

test('LINE orders: an order whose items do not add to its total is flagged', () => {
  const bad = [ORDERS[1].slice()]; bad[0][6] = '999';
  const { rows } = lineOrdersToLedger(bad);
  assert.match(rows[0][COL.flags], /add to/);
});

// ---- reports ------------------------------------------------------------------------------
function ledgerFrom(...parts) { return ledgerObjects(parts.flat()); }
const grab = grabCsvToLedger(GRAB).rows;
const line = lineOrdersToLedger(ORDERS).rows;

test('weekly numbers: Grab net, LINE estimated cost, batch cost on the cook date', () => {
  const ledger = ledgerFrom(grab, line);
  const cook = [{ key: 'k1', date: utc(2026, 9, 8), dish: 'Noir Ragu', portions: 20, cost: 900 }];
  const weeks = summarise(ledger, cook, [{ date: utc(2026, 9, 9), amount: 1200 }], 'week');
  const w = weeks.find((p) => p.key === '2026-09-06');
  assert.strictEqual(w.label, '06/09/2026 to 12/09/2026');
  assert.strictEqual(w.grab.orders, 2);
  assert.strictEqual(w.grab.gross, 410 + 50 + 500);
  assert.strictEqual(w.grab.discount, 66);
  assert.strictEqual(w.grab.commission, 250);
  assert.strictEqual(w.grab.marketing, 20);
  assert.strictEqual(w.grab.net, 960 - 66 - 250 - 20);
  assert.strictEqual(w.cookCost, 900);
  assert.strictEqual(w.purchases, 1200);                           // memo only
  assert.strictEqual(w.recipeCost, 8.38 + 14.08);
  assert.ok(Math.abs(w.margin - (w.revenue - w.foodCost)) < 0.011);
  assert.ok(Math.abs(w.foodCost - (w.recipeCost + 900)) < 0.011);
});

test('LINE cost is estimated from the latest Grab recipe cost; unknown items are listed, not guessed', () => {
  const ledger = ledgerFrom(grab, line);
  const wk = summarise(ledger, [], [], 'week').find((p) => p.key === '2026-11-01');
  // Radiatori recipe cost 7.04 x 2 portions of Noir Ragu + Pasta (Radiatori). Bacon Steak and Coke Zero have no Grab recipe row.
  assert.strictEqual(wk.lineEstCost, 14.08);
  assert.deepStrictEqual(wk.missingCosts.sort(), ['Bacon Steak x1', 'Coke Zero Zero x1']);
  assert.strictEqual(wk.line.orders, 2);
  assert.strictEqual(wk.line.discount, 45);
  assert.strictEqual(wk.line.net, 450 + 95 + 38 + 245 - 45);
});

test('a stew with a pasta choice in brackets carries the pasta cost; a size in brackets does not', () => {
  const { buildCostTable, lineItemCost } = require('../lib/reports');
  const table = buildCostTable(ledgerFrom(grab));
  const d = utc(2026, 11, 2);
  assert.strictEqual(lineItemCost({ desc: 'Red Wine Beef Stew (Tubetti)', qty: 2, date: d }, table).cost, 0);       // no Tubetti in this small fixture
  assert.strictEqual(lineItemCost({ desc: 'Red Wine Beef Stew (Tubetti)', qty: 2, date: d }, table).missing, 'Tubetti (pasta)');
  assert.deepStrictEqual(lineItemCost({ desc: 'Red Wine Beef Stew (Large)', qty: 1, date: d }, table), { cost: 0 });
  assert.strictEqual(lineItemCost({ desc: 'Noir Ragu + Pasta (Radiatori)', qty: 2, date: d }, table).cost, 14.08);
});

test('monthly periods', () => {
  const ledger = ledgerFrom(grab, line);
  const months = summarise(ledger, [], [], 'month');
  assert.deepStrictEqual(months.map((m) => m.label), ['09/2026', '10/2026', '11/2026']);   // October has no data but is no longer skipped
  assert.strictEqual(periodOf(utc(2026, 2, 10), 'month').to.getUTCDate(), 28);
  // a week that straddles two months (Sun 01/11 to Sat 07/11) and the first day of a month
  assert.strictEqual(periodOf(utc(2026, 11, 1), 'week').label, '01/11/2026 to 07/11/2026');
  assert.strictEqual(periodOf(utc(2026, 1, 1), 'week').label, '28/12/2025 to 03/01/2026');
});

// ---- sell-through ---------------------------------------------------------------------------
const sale = (d, desc, qty, channel = 'Grab') => ['d', desc, channel, '', 'Order', qty, 100, '', qty * 100, '', 'n', '', `k${Math.random()}`, ''].map((v, i) => (i === 0 ? d : v));

test('dish matching ignores pasta rows and size upgrades', () => {
  assert.strictEqual(batchDishOf('Noir Ragu'), 'Noir Ragu');
  assert.strictEqual(batchDishOf('Noir Ragu + Pasta (Radiatori)'), 'Noir Ragu');
  assert.strictEqual(batchDishOf('Dark Beer Stew (Large 525g)'), 'Dark beer Stew');
  assert.strictEqual(batchDishOf('Rigatoni (paired with Noir Ragu)'), null);
  assert.strictEqual(batchDishOf('Red Wine Beef Stew (Large upgrade)'), null);
  assert.strictEqual(batchDishOf('Serving size - Large'), null);
});

test('sell-through is first in, first out, and ages stock', () => {
  const ledger = ledgerFrom([
    sale('01/11/2026', 'Noir Ragu', 5), sale('02/11/2026', 'Noir Ragu + Pasta (Rigatoni)', 4, 'LINE'),
    sale('02/11/2026', 'Rigatoni (paired with Noir Ragu)', 4), sale('02/11/2026', 'Red Wine Beef Stew (Large upgrade)', 3),
  ]);
  const cook = [
    { key: 'a', date: utc(2026, 10, 20), dish: 'Noir Ragu', portions: 6, cost: 300 },
    { key: 'b', date: utc(2026, 10, 30), dish: 'Noir Ragu', portions: 6, cost: 300 },
  ];
  const [s] = sellThrough(ledger, cook, utc(2026, 11, 3));
  assert.strictEqual(s.cooked, 12);
  assert.strictEqual(s.sold, 9);
  assert.strictEqual(s.remaining, 3);
  // batch a (6) is used up first: 5 sold on 01/11 + 1 of the 4 sold on 02/11; the other 3 come off batch b
  assert.deepStrictEqual(s.live.map((b) => [b.key, b.remaining, b.ageDays]), [['b', 3, 4]]);
});

test('selling more than was cooked is reported as oversold, and sales before the first cook note are ignored', () => {
  const ledger = ledgerFrom([sale('01/10/2026', 'Noir Ragu', 50), sale('05/11/2026', 'Noir Ragu', 5)]);
  const cook = [{ key: 'a', date: utc(2026, 11, 4), dish: 'Noir Ragu', portions: 3, cost: 100 }];
  const [s] = sellThrough(ledger, cook, utc(2026, 11, 6));
  assert.strictEqual(s.oversold, 2);
  assert.strictEqual(s.remaining, 0);
});

// ---- handoffs -------------------------------------------------------------------------------
test('handoffs: aged stock, low stock and price moves are raised once, and clear themselves', () => {
  const today = utc(2026, 11, 3);
  const ledger = ledgerFrom([sale('28/10/2026', 'Noir Ragu', 4)]);
  const cook = [{ key: 'a', date: utc(2026, 10, 27), dish: 'Noir Ragu', portions: 6, cost: 300 }];
  const stock = sellThrough(ledger, cook, today);
  const moves = priceMoves([
    { date: utc(2026, 10, 20), name: 'Pork - minced', unitCost: 0.11 }, { date: utc(2026, 11, 1), name: 'Pork - minced', unitCost: 0.13 },
  ]);
  const cur = currentHandoffs({ stock, moves, today });
  const kinds = cur.map((c) => c.key.split('|')[0]).sort();
  assert.deepStrictEqual(kinds, ['age', 'low', 'price']);
  assert.match(cur.find((c) => c.key.startsWith('age')).message, /7 days old/);

  const first = reconcile([['Raised', 'From', 'To', 'Message', 'Status', 'Reply', 'Key']], cur, today);
  assert.strictEqual(first.add.length, 3);
  const sheet = [['h'], ...first.add];
  assert.strictEqual(reconcile(sheet, cur, today).add.length, 0);                    // not raised twice

  const closed = reconcile(sheet, cur.filter((c) => !c.key.startsWith('price')), today); // price situation gone
  assert.strictEqual(closed.update.length, 1);
  assert.strictEqual(closed.update[0].row[4], 'Done (cleared)');

  sheet[1][4] = 'Done'; // you closed it by hand: it is not raised again while the situation lasts
  assert.strictEqual(reconcile(sheet, cur, today).add.length, 0);
  assert.strictEqual(openHandoffs(sheet).length, 2);
});

test('huddle text states how far each channel runs', () => {
  const ledger = ledgerFrom(grab, line);
  const text = buildHuddle({ today: utc(2026, 11, 3), ledger, cookBatches: [], purchases: [], stock: [], open: [{ from: 'Operations', to: 'App sales', message: 'x' }] });
  assert.match(text, /Daily huddle, 03\/11\/2026/);
  assert.match(text, /Yesterday \(02\/11\/2026\): .*LINE 2 orders/);
  assert.match(text, /Grab data runs to 09\/09\/2026 \(import the latest CSV\)/);
  assert.match(text, /Open handoffs \(1\)/);
  assert.match(buildPeriodText(summarise(ledger, [], [], 'week'), 'week', utc(2026, 11, 3)), /Margin after overheads and ads/);
});

test('huddle timer runs once per Bangkok day after the set time, and only when switched on', async () => {
  let n = 0; let now = Date.UTC(2026, 10, 3, 14, 29); // 21:29 Bangkok
  process.env.HUDDLE_AUTO = 'off';
  assert.strictEqual(startHuddleTimer(async () => { n++; }, { now: () => now }), null);
  process.env.HUDDLE_AUTO = 'on'; process.env.HUDDLE_TIME = '21:30';
  const quiet = { log() {}, error() {} };
  const timer = startHuddleTimer(async () => { n++; }, { now: () => now, every: 5, log: quiet });
  await new Promise((r) => setTimeout(r, 30)); assert.strictEqual(n, 0);
  now = Date.UTC(2026, 10, 3, 14, 31);
  await new Promise((r) => setTimeout(r, 30)); assert.strictEqual(n, 1);
  await new Promise((r) => setTimeout(r, 30)); assert.strictEqual(n, 1);
  clearInterval(timer); delete process.env.HUDDLE_AUTO; delete process.env.HUDDLE_TIME;
});

test('LINE group report commands', async () => {
  const deps = { huddle: async () => ({ text: 'H' }), period: async (t) => `P-${t}`, sync: async () => ({ added: 3, read: 9, problems: [] }) };
  assert.deepStrictEqual(await processReports('huddle', deps), ['H']);
  assert.deepStrictEqual(await processReports('This week', deps), ['P-week']);
  assert.deepStrictEqual(await processReports('month', deps), ['P-month']);
  assert.match((await processReports('sync', deps))[0], /3 new ledger rows/);
  assert.strictEqual(await processReports('bolo 7/10 yield 21', deps), null);
});

// ---- delivery and rider fees -----------------------------------------------------------------
const { processRider, splitEvenly } = require('../lib/riderCommand');
const { riderRow } = require('../lib/ledger');
const { riderGaps } = require('../lib/reports');

const WITH_DELIVERY = [
  ...ORDERS.slice(0, 4),
  ['02/11/2026', '14:28:05', 'Delivery fee', 'LINE Bot', 'Delivery', '', 60, 'Anna', '', '', 'REF1', '', "'001"],
  ['02/11/2026', '15:00:00', 'Delivery fee', 'LINE Bot', 'Delivery', '', 0, 'Ben', '', '', 'REF2', '', "'002"],
];

test('bot Delivery rows become income rows in the Ledger', () => {
  const { rows, problems } = lineOrdersToLedger(WITH_DELIVERY);
  assert.deepStrictEqual(problems, []);
  const d = rows.filter((r) => r[COL.type] === 'Delivery');
  assert.strictEqual(d.length, 2);
  assert.deepStrictEqual([d[0][COL.desc], d[0][COL.moneyIn], d[0][COL.net], d[0][COL.orderNo]], ['Delivery fee charged', 60, 60, '#001']);
});

test('delivery charged is income and the rider fee paid is a cost', () => {
  const rider = [riderRow({ dmy: '02/11/2026', orderNo: '#001', customer: 'Anna', fee: 55 })];
  const ledger = ledgerFrom(lineOrdersToLedger(WITH_DELIVERY).rows, rider);
  const wk = summarise(ledger, [], [], 'week').find((p) => p.key === '2026-11-01');
  assert.strictEqual(wk.line.delivery, 60);
  assert.strictEqual(wk.line.rider, 55);
  const withoutDelivery = summarise(ledgerFrom(lineOrdersToLedger(ORDERS).rows), [], [], 'week').find((p) => p.key === '2026-11-01');
  assert.strictEqual(wk.revenue, withoutDelivery.revenue + 60);
  assert.ok(Math.abs(wk.margin - (wk.revenue - wk.foodCost - 55)) < 0.011);
  assert.strictEqual(rider[0][COL.net], -55);
});

test('rider command: logs a fee for an order that exists, corrects a repeat, splits a shared trip', async () => {
  const saved = [];
  const deps = {
    findOrders: async (dmy) => (dmy === '03/11/2026' ? [{ orderNo: '#001', customer: 'Anna' }, { orderNo: '#002', customer: 'Ben' }] : []),
    saveRider: async (rows) => { saved.push(...rows); return { replaced: saved.length > 1 ? 1 : 0 }; },
  };
  const today = utc(2026, 11, 3);
  const one = await processRider('rider 001 55', today, deps);
  assert.match(one[0], /Rider fee logged for 03\/11\/2026/);
  assert.match(one[0], /#001 Anna: ฿55/);
  assert.strictEqual(saved[0][COL.key], 'R|03/11/2026|#001');
  assert.strictEqual(saved[0][COL.cost], 55);

  const shared = await processRider('Rider 1,2 80 baht', today, deps);
  assert.match(shared[0], /#001 Anna: ฿40/);
  assert.match(shared[0], /#002 Ben: ฿40/);
  assert.match(shared[0], /replaced 1 earlier entry/);

  assert.match((await processRider('rider 009 50', today, deps))[0], /can't find LINE order #009 on 03\/11\/2026.*#001, #002/s);
  assert.match((await processRider('rider 001 50 2/11', today, deps))[0], /no LINE orders for that day yet/);
  assert.match((await processRider('rider fast', today, deps))[0], /Send the rider fee like this/);
  assert.strictEqual(await processRider('rice 001 5', today, deps), null);
  assert.deepStrictEqual(splitEvenly(100, 3), [33.33, 33.33, 33.34]);
});

test('missing rider fees are flagged only after the first one is logged, for finished days', () => {
  const today = utc(2026, 11, 4);
  const orders = lineOrdersToLedger([
    ['Date', 'Time', 'Items', 'Order From', 'Type', 'Qty', 'Total', 'Name', 'A', 'P', 'S', 'U', 'N'],
    ['01/11/2026', '12:00:00', '1x Tuscan Pork Braise (฿245)', 'LINE Bot', 'Order', 1, 245, 'Old', '', '', 'S0', '', "'005"],
    ['02/11/2026', '12:00:00', '1x Tuscan Pork Braise (฿245)', 'LINE Bot', 'Order', 1, 245, 'Anna', '', '', 'S1', '', "'001"],
    ['03/11/2026', '12:00:00', '1x Tuscan Pork Braise (฿245)', 'LINE Bot', 'Order', 1, 245, 'Ben', '', '', 'S2', '', "'001"],
    ['04/11/2026', '12:00:00', '1x Tuscan Pork Braise (฿245)', 'LINE Bot', 'Order', 1, 245, 'Today', '', '', 'S3', '', "'001"],
  ]).rows;
  assert.deepStrictEqual(riderGaps(ledgerFrom(orders), today), []);                       // feature not started yet
  const rider = riderRow({ dmy: '02/11/2026', orderNo: '#001', customer: 'Anna', fee: 50 });
  const gaps = riderGaps(ledgerFrom(orders, [rider]), today);
  assert.deepStrictEqual(gaps.map((g) => `${g.dmy} ${g.orderNo}`), ['03/11/2026 #001']);  // not 01/11 (before start), not today
  const h = currentHandoffs({ stock: [], moves: [], today, gaps });
  assert.strictEqual(h.length, 1);
  assert.match(h[0].message, /no rider fee yet\. Send: rider 001 <fee>/);
});

test('daily view: one row per day, and the day detail lists rows in order plus cooking and buying', () => {
  const { dayDetail, summarise } = require('../lib/reports');
  const { ledgerObjects } = require('../lib/ledger');
  const { utc } = require('../lib/dates');
  const row = (dmy, desc, ch, type, qty, money, cost, net, no, time) => [dmy, desc, ch, 'Grab-RT', type, qty, money, cost, net, 'Ann', no, time, `k|${dmy}|${desc}|${no}`, ''];
  const ledger = ledgerObjects([
    row('02/11/2026', 'Noir Ragu', 'LINE', 'Order', 2, 400, '', 400, '#001', '12:00'),
    row('02/11/2026', 'Delivery', 'LINE', 'Delivery', 1, 50, '', 50, '#001', '12:00'),
    row('03/11/2026', 'Noir Ragu', 'LINE', 'Order', 1, 200, '', 200, '#002', '13:00'),
  ]);
  const d2 = utc(2026, 11, 2);
  const cook = [{ key: 'c1', date: d2, dish: 'Noir Ragu', portions: 20, cost: 1000 }];
  const buys = [{ date: d2, name: 'Minced pork', amount: 330 }, { date: utc(2026, 11, 3), name: 'Onion', amount: 90 }];
  const days = summarise(ledger, cook, buys, 'day');
  assert.deepStrictEqual(days.map((d) => d.label), ['02/11/2026', '03/11/2026']);
  const det = dayDetail(ledger, cook, buys, d2);
  assert.deepStrictEqual(det.rows.map((r) => r.type), ['Order', 'Delivery']);
  assert.strictEqual(det.cooked[0].perPortion, 50);
  assert.deepStrictEqual(det.bought, [{ date: '02/11/2026', name: 'Minced pork', amount: 330, kind: 'Ingredient' }]);
  const span = dayDetail(ledger, cook, buys, d2, utc(2026, 11, 3));
  assert.strictEqual(span.rows.length, 3);
  assert.strictEqual(span.bought.length, 2);
  assert.strictEqual(span.date, '02/11/2026 to 03/11/2026');
  assert.strictEqual(span.summary, null);
  assert.strictEqual(det.summary.cookCost, 1000);
  assert.deepStrictEqual(det.orders.map((o) => [o.time, o.status]), [['12:00', 'RT']]);
  assert.deepStrictEqual(det.byHour, { '12': 1 });
  assert.strictEqual(det.people.rt, 1);
});

test('Meta ads are counted separately and come off the margin', () => {
  const { summarise } = require('../lib/reports');
  const { ledgerObjects } = require('../lib/ledger');
  const { utc } = require('../lib/dates');
  const ledger = ledgerObjects([['02/11/2026', 'Noir Ragu', 'LINE', 'Order', 'Order', 1, 1000, '', 1000, 'Ann', '#1', '12:00', 'k1', '']]);
  const buys = [{ date: utc(2026, 11, 2), name: 'meta ads', amount: 300, kind: 'ads' }, { date: utc(2026, 11, 2), name: 'pot', amount: 100, kind: 'overhead' }];
  const m = summarise(ledger, [], buys, 'month')[0];
  assert.strictEqual(m.ads, 300);
  assert.strictEqual(m.overheads, 100);
  assert.strictEqual(m.margin, 600);
});

// ---- the huddle is sent once a day, even when the app restarts ------------------------------------
test('huddle: a restart later the same day does not send it again', async () => {
  process.env.HUDDLE_AUTO = 'on'; process.env.HUDDLE_TIME = '05:00';
  const quiet = { log() {}, error() {} };
  let saved = '';
  const store = { get: async () => saved, set: async (key, v) => { saved = v; } };
  let sent = 0;
  let now = Date.UTC(2026, 10, 4, 22, 1); // 05:01 Bangkok, 05/11
  const first = startHuddleTimer(async () => { sent++; }, { now: () => now, every: 5, log: quiet, store });
  await new Promise((r) => setTimeout(r, 40)); assert.strictEqual(sent, 1);
  clearInterval(first);
  // deploy at 07:30 Bangkok: a brand new timer with the same store
  now = Date.UTC(2026, 10, 5, 0, 30);
  const second = startHuddleTimer(async () => { sent++; }, { now: () => now, every: 5, log: quiet, store });
  await new Promise((r) => setTimeout(r, 40)); assert.strictEqual(sent, 1);
  clearInterval(second);
  // next morning it sends again
  now = Date.UTC(2026, 10, 5, 22, 5);
  const third = startHuddleTimer(async () => { sent++; }, { now: () => now, every: 5, log: quiet, store });
  await new Promise((r) => setTimeout(r, 40)); assert.strictEqual(sent, 2);
  clearInterval(third); delete process.env.HUDDLE_AUTO; delete process.env.HUDDLE_TIME;
});

test('huddle: a late restart does not send a missed one, and an unreadable store sends nothing', async () => {
  process.env.HUDDLE_AUTO = 'on'; process.env.HUDDLE_TIME = '05:00';
  const quiet = { log() {}, error() {} };
  let sent = 0;
  const empty = { get: async () => '', set: async () => {} };
  const late = startHuddleTimer(async () => { sent++; }, { now: () => Date.UTC(2026, 10, 5, 7, 0), every: 5, log: quiet, store: empty }); // 14:00 Bangkok
  await new Promise((r) => setTimeout(r, 30)); assert.strictEqual(sent, 0);
  clearInterval(late);
  const broken = { get: async () => { throw new Error('sheet down'); }, set: async () => {} };
  const t = startHuddleTimer(async () => { sent++; }, { now: () => Date.UTC(2026, 10, 4, 22, 5), every: 5, log: quiet, store: broken });
  await new Promise((r) => setTimeout(r, 30)); assert.strictEqual(sent, 0);
  clearInterval(t); delete process.env.HUDDLE_AUTO; delete process.env.HUDDLE_TIME;
});

// ---- counted stock beats cooked minus sold ---------------------------------------------------
test('a count overrides cooked minus sold, ignores capital letters in the dish name, and Analysis uses it', () => {
  const { buildReadyStock } = require('../lib/logViews');
  const { buildAnalysis } = require('../lib/analysis');
  const cook = [{ key: 'a', date: utc(2026, 10, 20), dish: 'Dark Beer Stew', portions: 11, cost: 1062 }];
  const today = utc(2026, 11, 12);
  const counts = [['Dish', 'Count', 'Counted on', 'Logged at'], ['Dark beer Stew', 0, '11/11/2026', 'x']];
  // a Grab sale dated on the count day arrives later and is already inside the count, so it is not taken off again
  const ledger = ledgerFrom([sale('11/11/2026', 'Dark Beer Stew (Large 525g)', 1)]);
  const ready = buildReadyStock({ today, ledger, cookBatches: cook, countRows: counts });
  const dbs = ready.items.filter((i) => i.dish.toLowerCase() === 'dark beer stew');
  assert.strictEqual(dbs.length, 1);
  assert.strictEqual(dbs[0].left, 0);
  assert.strictEqual(dbs[0].basis, 'counted');
  const a = buildAnalysis({ today, ledger, cookBatches: cook, countRows: counts });
  assert.strictEqual(a.dishes.sitting.find((s) => s.dish === 'Dark Beer Stew').remaining, 0);
});
