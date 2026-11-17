const test = require('node:test');
const assert = require('node:assert');
const v = require('../lib/logViews');
const { utc } = require('../lib/dates');

const today = utc(2026, 11, 5);
const expense = [
  ['Shopping Date', 'Ingredient', 'Purchase Price', 'Purchase Unit', 'Cost per Recipe Unit', 'Shopped at', 'Remarks'],
  ['18/10/2026', 'Onion', 90, '2000g', 0.045, 'Makro', ''],
  ['04/11/2026', 'Pork - minced', '1,100', '10000g', 0.11, 'Makro', 'Typed in LINE'],
  ['04/11/2026', 'Milk', 99.75, '2000ml', 0.05, '', ''],
];
const overheads = [
  ['Date', 'Item', 'Category', 'Price', 'Shopped at', 'Remarks'],
  ['03/11/2026', 'pot 7lt', 'equipment', 2575, 'Paragon', ''],
  ['02/11/2026', 'Meta ads', 'Ads Meta', 500, '', ''],
];

test('receipt log filters by month and totals by type', () => {
  const log = v.buildReceiptLog({ expenseRows: expense, overheadRows: overheads, month: '11/2026', today });
  assert.equal(log.rows.length, 4);
  assert.equal(log.totals.ingredients, 1199.75);
  assert.equal(log.totals.overheads, 2575);
  assert.equal(log.totals.ads, 500);
  assert.deepEqual(log.rows.map((r) => r.date), ['02/11/2026', '03/11/2026', '04/11/2026', '04/11/2026']);
  assert.equal(log.byShop[0].shop, 'Paragon');
  assert.deepEqual(log.months.map((m) => m.key), ['2026-11', '2026-10']);
});

test('receipt log defaults to this month, "all" spans every month, junk month is refused', () => {
  assert.equal(v.buildReceiptLog({ expenseRows: expense, overheadRows: overheads, today }).month, '2026-11');
  assert.equal(v.buildReceiptLog({ expenseRows: expense, overheadRows: overheads, month: 'all', today }).rows.length, 5);
  assert.throws(() => v.buildReceiptLog({ expenseRows: expense, overheadRows: overheads, month: 'abc', today }), /Month must look like/);
});

test('Price Log csv has the Price Log columns and ingredients only', () => {
  const log = v.buildReceiptLog({ expenseRows: expense, overheadRows: overheads, month: '2026-11', today });
  const csv = v.toCsv(v.PRICE_LOG_HEADERS, v.priceLogCsvRows(log));
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  assert.equal(lines[0], 'Shopping Date,Ingredient,Purchase Price,Purchase Unit,Cost per Recipe Unit,Shopped at,Remarks');
  assert.equal(lines.length, 3);
  assert.ok(csv.startsWith('﻿'));
});

test('csv quotes commas, quotes and newlines', () => {
  assert.equal(v.toCsv(['a'], [['x, y'], ['say "hi"']]), '﻿a\r\n"x, y"\r\n"say ""hi"""\r\n');
});

const cookLog = [
  ['Batch Key', 'Date Cooked', 'Dish', 'Yield', 'Ingredient Cost', 'Packaging Cost', 'Utility Cost', 'Total Batch Cost', 'Cost per Portion', 'Flags', 'Logged At', 'Source'],
  ['B1', '03/11/2026', 'Noir Ragu', 10, 800, 100, 20, 920, 92, '', '', 'LINE'],
  ['B2', '04/11/2026', 'Red Wine Beef Stew', 3, 600, 30, 10, 640, 213.33, '', '', 'Web'],
  ['B3', '20/10/2026', 'Noir Ragu', 8, 700, 80, 20, 800, 100, '', '', 'LINE'],
];
const sizes = [
  ['Batch Key', 'Date Cooked', 'Dish', 'Size', 'Portion Weight (g)', 'Count Packed'],
  ['B1', '03/11/2026', 'Noir Ragu', 'Regular', 250, 6],
  ['B1', '03/11/2026', 'Noir Ragu', 'Large', 350, 4],
];
test('cook log lists batches for the month with sizes and flags low yield', () => {
  const log = v.buildCookLog({ logRows: cookLog, sizeRows: sizes, month: '11/2026', today });
  assert.equal(log.totals.batches, 2);
  assert.equal(log.totals.portions, 13);
  assert.equal(log.rows[0].sizes, 'Regular x6, Large x4');
  assert.equal(log.rows[1].lowYield, true);
  assert.equal(log.totals.cost, 1560);
});

const batch = (key, d, dish, portions) => ({ key, date: d, dish, portions, cost: 0 });
const sale = (d, desc, qty) => ({ type: 'Order', date: d, desc, qty });
test('ready stock: estimated from cooked minus sold, and flags stock older than 5 days', () => {
  const r = v.buildReadyStock({ today, cookBatches: [batch('a', utc(2026, 10, 28), 'Noir Ragu', 10)], ledger: [sale(utc(2026, 10, 29), 'Noir Ragu', 4)] });
  const n = r.items.find((i) => i.dish === 'Noir Ragu');
  assert.equal(n.left, 6); assert.equal(n.basis, 'estimated'); assert.equal(n.ageDays, 8); assert.equal(n.stale, true);
  assert.equal(r.items.find((i) => i.dish === 'Creamy Chicken Soup').left, 0);
});
test('ready stock: a count wins, then later cooks and sales move it', () => {
  const r = v.buildReadyStock({
    today,
    cookBatches: [batch('a', utc(2026, 10, 28), 'Noir Ragu', 10), batch('b', utc(2026, 11, 4), 'Noir Ragu', 5)],
    ledger: [sale(utc(2026, 10, 29), 'Noir Ragu', 4), sale(utc(2026, 11, 4), 'Noir Ragu', 2), sale(utc(2026, 11, 3), 'Noir Ragu', 9)],
    countRows: [['Dish', 'Count', 'Counted on'], ['Noir Ragu', 3, '03/11/2026']],
  });
  const n = r.items.find((i) => i.dish === 'Noir Ragu');
  assert.equal(n.basis, 'counted'); assert.equal(n.left, 3 + 5 - 2); assert.equal(n.countedOn, '03/11/2026'); assert.equal(n.stale, false);
});
test('ready stock never shows a negative number', () => {
  const r = v.buildReadyStock({ today, cookBatches: [], ledger: [sale(utc(2026, 11, 4), 'Noir Ragu', 3)], countRows: [['Noir Ragu', 1, '03/11/2026']] });
  const n = r.items.find((i) => i.dish === 'Noir Ragu');
  assert.equal(n.left, 0); assert.equal(n.negative, true);
});

test('receipt log rows carry a ref, and an R&D overhead shows as type R&D', () => {
  const { buildReceiptLog } = require('../lib/logViews');
  const out = buildReceiptLog({
    expenseRows: [['Date'], ['13/11/2026', 'Milk', 99.75, '2000ml', 0.05, 'makro', 'Receipt R261117-1']],
    overheadRows: [['Date'], ['13/11/2026', 'blender', '', 297, '', ''], ['13/11/2026', 'lamb shank 794g', 'R&D', 277, 'makro', '']],
    month: '11/2026', today: new Date(Date.UTC(2026, 10, 17)),
  });
  assert.deepStrictEqual(out.rows.map((r) => r.type), ['Ingredient', 'Overhead', 'R&D']);
  assert.strictEqual(out.totals.rd, 277);
  assert.deepStrictEqual(out.rows[2].ref, { t: 'O', i: 2, d: '13/11/2026', n: 'lamb shank 794g', p: '277' });
});

test('R&D buys show a How many: from the Qty note, or read off the end of an older name', () => {
  const { receiptItems } = require('../lib/logViews');
  const { splitOverheads, overheadRows } = require('../lib/overheads');
  const today = new Date(Date.UTC(2026, 10, 17));
  const oh = splitOverheads('13/11\nat makro\nr&d\nlamb shank 794g 277', today);
  assert.equal(oh.items[0].name, 'lamb shank');
  assert.equal(oh.items[0].qty, '794g');
  const rows = [['Date', 'Item', 'Category', 'Price', 'Shopped at', 'Remarks'], ...overheadRows(oh.items, 'R000001-000001'), ['13/11/2026', 'lamb shank 794g', 'R&D', 277, 'makro', 'Typed']];
  const out = receiptItems([], rows);
  assert.deepEqual(out.map((x) => [x.item, x.qty, x.type]), [['lamb shank', '794g', 'R&D'], ['lamb shank', '794g', 'R&D']]);
  assert.equal(out[1].ref.n, 'lamb shank 794g'); // the old row is still found by what is really in the sheet
});
