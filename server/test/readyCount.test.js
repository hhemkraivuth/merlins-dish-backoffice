const test = require('node:test');
const assert = require('node:assert');
const { processReadyCount } = require('../lib/readyCount');
const { defaultShorthand } = require('../lib/aliases');
const { utc } = require('../lib/dates');

const mk = () => { const rows = []; return { rows, deps: { loadShorthand: async () => defaultShorthand(), ensureTab: async () => {}, appendRows: async (t, r) => rows.push(...r) } }; };
const TODAY = utc(2026, 11, 12);
const NOTE = "heres the stock after close today (11/11):\n-rsw 2r 2l\n-dbs 4l 9r\n-tpb 4\n- ragu 0\n-bolog 9\n-sr 6\n-broc s 4\n-chic s 0";

test('a closing count is read as she types it and dated 11/11', async () => {
  const { rows, deps } = mk();
  const out = await processReadyCount(NOTE, TODAY, deps);
  assert.match(out[0], /11\/11\/2026/);
  assert.deepStrictEqual(rows.map((r) => [r[0], r[1], r[2]]), [
    ['Red Wine Beef Stew', 4, '11/11/2026'], ['Dark beer Stew', 13, '11/11/2026'], ['Tuscan Pork Braise', 4, '11/11/2026'],
    ['Noir Ragu', 0, '11/11/2026'], ['Polished Pork Bolognese', 9, '11/11/2026'], ['Spicy Rosso', 6, '11/11/2026'],
    ['Pecorino & Broccoli Cream Soup', 4, '11/11/2026'], ['Creamy Chicken Soup', 0, '11/11/2026'],
  ]);
});

test('one unknown dish word saves nothing', async () => {
  const { rows, deps } = mk();
  const out = await processReadyCount('stock after close 11/11\ndbs 13\nzzz 4', TODAY, deps);
  assert.match(out[0], /Nothing was saved/);
  assert.strictEqual(rows.length, 0);
});

test('an ordinary cook note is not mistaken for a count', async () => {
  const { deps } = mk();
  assert.strictEqual(await processReadyCount('11/11\nDBS\nMeat 1608\n13 portions', TODAY, deps), null);
});

test('the date on its own line above "stock after close" works (the way it arrived in LINE)', async () => {
  const { rows, deps } = mk();
  const out = await processReadyCount('11/11\nstock after close\nrsw 2r 2l\ndbs 4l 9r\ntpb 4\nragu 0\nbolog 9\nsr 6\nbroc s 4\nchic s 0', TODAY, deps);
  assert.match(out[0], /11\/11\/2026/);
  assert.strictEqual(rows.length, 8);
  assert.deepStrictEqual(rows.find((r) => r[0] === 'Dark beer Stew').slice(1, 3), [13, '11/11/2026']);
});

test('"left" quick message: several dishes on one line, sizes added up', async () => {
  const { rows, deps } = mk();
  const out = await processReadyCount('left tpb 3, noir 0, bolo 8, brocs 1, rws 2l, 2r, dbs 1', TODAY, deps);
  assert.match(out[0], /BOH counts saved for 12\/11\/2026/);
  assert.deepStrictEqual(rows.map((r) => [r[0], r[1], r[2]]), [
    ['Tuscan Pork Braise', 3, '12/11/2026'], ['Noir Ragu', 0, '12/11/2026'], ['Polished Pork Bolognese', 8, '12/11/2026'],
    ['Pecorino & Broccoli Cream Soup', 1, '12/11/2026'], ['Red Wine Beef Stew', 4, '12/11/2026'], ['Dark beer Stew', 1, '12/11/2026'],
  ]);
});

test('"left" with one dish per line', async () => {
  const { rows, deps } = mk();
  await processReadyCount('left\ntpb 3\nbolo 8', TODAY, deps);
  assert.deepStrictEqual(rows.map((r) => [r[0], r[1]]), [['Tuscan Pork Braise', 3], ['Polished Pork Bolognese', 8]]);
});

test('"left" skips order-app-only words and still saves the batch dishes', async () => {
  const { rows, deps } = mk();
  const out = await processReadyCount('left tpb 3, bacon 13, coke 5, bolo 8', TODAY, deps);
  assert.strictEqual(rows.length, 2);
  assert.match(out[0], /left to the order app: bacon, coke/);
});

test('"left" with only order-app words saves nothing and says so', async () => {
  const { rows, deps } = mk();
  const out = await processReadyCount('left bacon 13, coke 5', TODAY, deps);
  assert.strictEqual(rows.length, 0);
  assert.match(out[0], /saved nothing/);
});

test('plain "left" with no dish and other words are not claimed', async () => {
  const { deps } = mk();
  assert.strictEqual(await processReadyCount('left', TODAY, deps), null);
  assert.strictEqual(await processReadyCount('leftover noodles 3', TODAY, deps), null);
});

test('"left" numbers typed straight after the dish word, and a size letter before its number', async () => {
  const { rows, deps } = mk();
  const out = await processReadyCount('left sr6, tpb3, ragu17, bolog8, brocs1, chics0, dbs5r3l, rws r1 l2', TODAY, deps);
  assert.deepStrictEqual(rows.map((r) => [r[0], r[1]]), [
    ['Spicy Rosso', 6], ['Tuscan Pork Braise', 3], ['Noir Ragu', 17], ['Polished Pork Bolognese', 8],
    ['Pecorino & Broccoli Cream Soup', 1], ['Creamy Chicken Soup', 0], ['Dark beer Stew', 8], ['Red Wine Beef Stew', 3],
  ]);
  assert.ok(!/left to the order app/.test(out[0]));
});

test('sizes are shown as typed, never merged: dbs 5r 3l', async () => {
  const { rows, deps } = mk();
  const out = await processReadyCount('left dbs5r3l, rws r1 l2, tpb3', TODAY, deps);
  assert.match(out[0], /Dark beer Stew 5r 3l \(8 in total\)/);
  assert.match(out[0], /Red Wine Beef Stew 1r 2l \(3 in total\)/);
  assert.match(out[0], /Tuscan Pork Braise 3\n?/);
  assert.ok(!/Tuscan Pork Braise 3 \(/.test(out[0]));
  // the total stays the number the stock maths uses, the typed sizes sit beside it
  assert.deepStrictEqual(rows.map((r) => [r[0], r[1], r[4]]), [['Dark beer Stew', 8, '5r 3l'], ['Red Wine Beef Stew', 3, '1r 2l'], ['Tuscan Pork Braise', 3, '']]);
});

test('closing count also shows sizes as typed', async () => {
  const { rows, deps } = mk();
  const out = await processReadyCount('stock after close 11/11\ndbs 4l 9r\ntpb 4', TODAY, deps);
  assert.match(out[0], /Dark beer Stew 4l 9r \(13 in total\)/);
  assert.strictEqual(rows.find((r) => r[0] === 'Dark beer Stew')[1], 13);
});
