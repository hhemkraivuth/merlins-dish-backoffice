const test = require('node:test');
const assert = require('node:assert');
const { processNote } = require('../lib/cookService');
const { tidyCookLogs } = require('../lib/cookLog');
const { defaultShorthand } = require('../lib/aliases');
const { buildPriceBook } = require('../lib/priceBook');
const { parseDishTab } = require('../lib/sheetRecipe');
const { utc } = require('../lib/dates');
const { bologneseRows, priceLog } = require('./fixtures');

test('tidyCookLogs sorts the three cook tabs by date, dish, then key, without touching the header', async () => {
  const calls = [];
  await tidyCookLogs(async (tab, n, keys) => { calls.push([tab, n, keys.map((k) => k.col)]); });
  assert.deepStrictEqual(calls.map((c) => c[0]), ['Cook Log', 'Cook Log Lines', 'Cook Log Sizes']);
  assert.deepStrictEqual(calls.map((c) => c[1]), [12, 12, 9]);
  assert.ok(calls.every((c) => c[2].join() === '1,2,0'));
});

test('a failed sort is swallowed, so a logged batch is never lost', async () => {
  await tidyCookLogs(async () => { throw new Error('quota'); });
});

test('a note sorts once at the end, and not at all when nothing was logged', async () => {
  const TODAY = utc(2026, 10, 15);
  const book = buildPriceBook({ priceLogRows: priceLog, today: TODAY });
  let tidied = 0; const logged = new Set();
  const deps = {
    today: TODAY, loadShorthand: async () => defaultShorthand(),
    loadRecipe: async () => parseDishTab(bologneseRows), loadPriceBook: async () => book,
    isLogged: async (k) => logged.has(k), batchKey: (t, d, y, l) => `${t}-${d.toISOString().slice(0, 10)}-${y}-${l.length}`,
    writeBatch: async (r, k) => { logged.add(k); }, tidy: async () => { tidied++; },
  };
  const note = '7/10\nBolo\nMeat 1000\nyield 21\n\n8/10\nBolo\nMeat 1000\nyield 20';
  await processNote(note, deps);
  assert.strictEqual(tidied, 1);
  await processNote(note, deps);   // both already logged
  assert.strictEqual(tidied, 1);
});
