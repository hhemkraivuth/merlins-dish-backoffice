const test = require('node:test');
const assert = require('node:assert');
const { costBatch } = require('../lib/costBatch');
const { normName } = require('../lib/priceBook');

// An old bulk buy is the right price while the bagged stock lasts. The warning only shows once that stock is gone.
const recipe = { dish: 'Stew', ingredients: [{ name: 'Beef - chuck roll', qty: 1000, unit: 'g', sheetCost: null }], utility: [], packaging: [], usualYield: null };
const priceBook = { lookup: () => ({ cost: 0.38, date: new Date('2026-09-11T00:00:00Z'), source: 'Price Log', stale: true, staleDays: 61 }) };
const batch = { date: new Date('2026-11-11T00:00:00Z'), dishTab: 'Stew', lines: [], yield: 10 };
const stale = (r) => r.flags.some((f) => /latest price is/.test(f));

test('old price warns when no stock is known to be in hand', () => {
  assert.ok(stale(costBatch({ batch, recipe, shorthand: {}, priceBook })));
});
test('old price does not warn while bagged stock is in hand', () => {
  assert.ok(!stale(costBatch({ batch, recipe, shorthand: {}, priceBook, inHand: new Set([normName('Beef - chuck roll')]) })));
});
test('old price warns again once the stock is used up', () => {
  assert.ok(stale(costBatch({ batch, recipe, shorthand: {}, priceBook, inHand: new Set() })));
});
