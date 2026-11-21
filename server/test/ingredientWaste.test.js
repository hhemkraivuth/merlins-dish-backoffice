const test = require('node:test');
const assert = require('node:assert');
const { processLots, wasteIngredient } = require('../lib/lotService');
const { processWaste } = require('../lib/wasteLog');
const { LotBook, LOT_HEADERS } = require('../lib/ingredientLots');

const day = (s) => { const [d, m, y] = s.split('/').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const today = day('21/11/2026');
const rows = [LOT_HEADERS, ['L1', 'Button mushrooms', '15/11/2026', 'Receipt', 1000, 'g', 1000, 150, 0.15, 'Active', '', 'Makro r1']];
const mk = () => {
  const book = new LotBook(rows.map((r) => r.slice()), [], today);
  const out = { book, usage: null, saved: [], appended: [] };
  out.deps = { loadLotBook: async () => book, saveLots: async (b, u) => { out.usage = u; }, loadCatalogue: async () => [], ensureTab: async () => {}, appendRows: async (t, r) => out.appended.push([t, ...r]) };
  return out;
};

test('waste of an ingredient costs the lot price and takes it off stock', async () => {
  const m = mk();
  const r = await processLots('waste mushroom 500g mould', today, m.deps);
  assert.match(r[0], /Logged 500g Button mushrooms \(mould\).*฿75\.00.*Makro/);
  assert.strictEqual(m.book.totalRemaining('Button mushrooms'), 500);
  assert.strictEqual(m.appended[0][0], 'Ingredient Waste');
  assert.strictEqual(m.appended[0][1][5], 75);
  assert.strictEqual(m.usage[0][0], 'WASTE');
});

test('dish waste is left alone and the ingredient form skips the dish handler', async () => {
  assert.strictEqual(await processWaste('waste mushroom 500g mould', today, {}), null);
  assert.strictEqual(await processWaste('waste 8/11 mushroom 0.5kg rotten', today, {}), null);
});

test('more than the books hold is costed at the latest price and said so', () => {
  const m = mk();
  const r = wasteIngredient(m.book, 'Button mushrooms', 1200, 'g', today, 'rot');
  assert.strictEqual(Math.round(r.cost), 180);
  assert.ok(r.short > 199);
});

test('an unknown ingredient logs nothing', async () => {
  const m = mk();
  const r = await processLots('waste unicorn 500g', today, m.deps);
  assert.match(r[0], /Nothing was logged/);
  assert.strictEqual(m.appended.length, 0);
});
