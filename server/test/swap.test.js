const test = require('node:test');
const assert = require('node:assert');
const { processNote } = require('../lib/cookService');
const { processSwap } = require('../lib/swapCommand');
const { defaultShorthand, applyShorthandRows } = require('../lib/aliases');
const { buildPriceBook } = require('../lib/priceBook');
const { parseDishTab } = require('../lib/sheetRecipe');
const { utc } = require('../lib/dates');
const { bologneseRows, priceLog } = require('./fixtures');

const TODAY = utc(2026, 10, 15);
const CAT = ['Polpa', 'Pelati (Rosso)', 'Onion'];

function makeSwapDeps(rows) {
  return {
    loadShorthand: async () => applyShorthandRows(defaultShorthand(), rows),
    loadRecipe: async () => parseDishTab(bologneseRows),
    loadCatalogue: async () => CAT,
    readRows: async () => rows,
    saveSwap: async (r) => { rows.push(r); },
    deleteSwaps: async (pred) => { const keep = rows.filter((r) => !pred(r)); const n = rows.length - keep.length; rows.length = 0; rows.push(...keep); return n; },
  };
}

function noteDeps(rows) {
  const book = buildPriceBook({ priceLogRows: [...priceLog, ['20/09/2026', 'Pelati (Rosso)', 400, '2500g', 0.16]], today: TODAY });
  return {
    today: TODAY,
    loadShorthand: async () => applyShorthandRows(defaultShorthand(), rows),
    loadRecipe: async () => parseDishTab(bologneseRows),
    loadPriceBook: async () => book,
    isLogged: async () => false,
    batchKey: (t, d, y, l) => `${t}-${d.toISOString().slice(0, 10)}-${y}-${l.length}`,
    writeBatch: async () => {},
  };
}

test('swap saves a row in the Shorthand tab and the recipe tab is untouched', async () => {
  const rows = [];
  const out = await processSwap('swap bolo polpa > pelati from 5/10', TODAY, makeSwapDeps(rows));
  assert.match(out[0], /Saved\. Polished Pork Bolognese will use Pelati \(Rosso\) in place of Polpa for batches cooked on or after 05\/10\/2026/);
  assert.deepStrictEqual(rows[0], ['Swap', 'Polished Pork Bolognese | Polpa', 'Pelati (Rosso)', '2026-10-05']);
});

test('swapped line is costed as the new brand, and only from the date given', async () => {
  const rows = [['Swap', 'Polished Pork Bolognese | Polpa', 'Pelati (Rosso)', '2026-10-05']];
  const on = await processNote('7/10\nBolo\nMeat 1000\npelati 1300\nyield 21', noteDeps(rows));
  assert.match(on[0], /Polpa swapped to Pelati \(Rosso\)/);
  const before = await processNote('3/10\nBolo\nMeat 1000\nyield 21', noteDeps(rows));
  assert.ok(!/swapped to/.test(before[0]));
});

test('swaps lists them and unswap takes one back', async () => {
  const rows = [];
  const deps = makeSwapDeps(rows);
  await processSwap('swap bolo polpa > pelati', TODAY, deps);
  assert.match((await processSwap('swaps', TODAY, deps))[0], /Polished Pork Bolognese: Polpa > Pelati \(Rosso\)/);
  assert.match((await processSwap('unswap bolo polpa', TODAY, deps))[0], /Swap removed/);
  assert.strictEqual(rows.length, 0);
});

test('swap refuses unknown dish, unknown recipe line and ambiguous new names', async () => {
  const deps = makeSwapDeps([]);
  assert.match((await processSwap('swap pizza polpa > pelati', TODAY, deps))[0], /don't know which dish/);
  assert.match((await processSwap('swap bolo kale > pelati', TODAY, deps))[0], /isn't a line in the Polished Pork Bolognese recipe/);
  deps.loadCatalogue = async () => ['Pelati (Rosso)', 'Pelati (Mutti)'];
  assert.match((await processSwap('swap bolo polpa > pelati', TODAY, deps))[0], /could be/);
  assert.strictEqual(await processSwap('hello', TODAY, deps), null);
});
