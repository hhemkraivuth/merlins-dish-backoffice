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
