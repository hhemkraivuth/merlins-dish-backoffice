const test = require('node:test');
const assert = require('node:assert');
const { LotBook } = require('../lib/ingredientLots');
const { costBatch } = require('../lib/costBatch');
const { processNote, processTypedReceipt } = require('../lib/cookService');
const { processLots } = require('../lib/lotService');
const { buildPriceBook } = require('../lib/priceBook');
const { defaultShorthand } = require('../lib/aliases');
const { parseDishTab } = require('../lib/sheetRecipe');
const { utc } = require('../lib/dates');
const { bologneseRows, priceLog } = require('./fixtures');

const TODAY = utc(2026, 10, 19);
const HEAD = ['Lot ID', 'Ingredient', 'Purchase Date', 'Source', 'Qty Purchased', 'Unit', 'Remaining', 'Total Price', 'Cost per Unit', 'Status', 'Last Updated', 'Note'];
const lot = (id, date, qty, remaining, total, name = 'Pork - minced') => [id, name, date, 'Receipt', qty, 'g', remaining, total, total / qty, 'Active', '', ''];
const book = (rows, untracked = ['Black pepper', 'Salt']) => new LotBook([HEAD, ...rows], untracked, TODAY);
const priceBook = buildPriceBook({ priceLogRows: priceLog, today: TODAY });
const recipe = () => parseDishTab(bologneseRows);
const cost = (lotBook, date, pork = 1000) => costBatch({
  batch: { date, yield: 21, lines: [{ token: 'Meat', qty: pork, unit: 'g' }], sizes: [] },
  recipe: recipe(), shorthand: defaultShorthand(), priceBook, lotBook,
});
const porkLine = (r) => r.lines.find((l) => l.name === 'Pork - minced');

test('FIFO: the old bag is finished before the promo lot starts', () => {
  // 3 bags at 110 each bought 13/10, two batches already used (2000g), then 5 promo bags at 90 on 18/10
  const b = book([lot('A', '13/10/2026', 3000, 1000, 330), lot('B', '18/10/2026', 5000, 5000, 450)]);
  const r1 = cost(b, utc(2026, 10, 19));
  assert.strictEqual(porkLine(r1).lineCost, 110);          // the last old bag, 1000g @ 0.11
  const r2 = cost(b, utc(2026, 10, 19));
  assert.strictEqual(porkLine(r2).lineCost, 90);           // now the promo lot, 1000g @ 0.09
  assert.strictEqual(b.totalRemaining('Pork - minced'), 3000 + 1000);
});

test('a batch spanning two lots is costed as a blend', () => {
  const b = book([lot('A', '13/10/2026', 3000, 600, 330), lot('B', '18/10/2026', 5000, 5000, 450)]);
  const r = cost(b, utc(2026, 10, 19));
  assert.strictEqual(Math.round(porkLine(r).lineCost * 100) / 100, 66 + 36); // 600g @ 0.11 plus 400g @ 0.09
  assert.match(porkLine(r).priceSource, /Stock lots/);
  assert.deepStrictEqual(r.lotUse.map((u) => [u.lotId, u.qty]), [['A', 600], ['B', 400]]);
});

test('a lot bought after the cook date is not used for an earlier batch', () => {
  const b = book([lot('B', '18/10/2026', 5000, 5000, 450)]);
  const r = cost(b, utc(2026, 10, 7));
  assert.strictEqual(r.lotUse.length, 0);
  assert.ok(porkLine(r).priceSource !== undefined && !/Stock lots/.test(porkLine(r).priceSource));
  assert.strictEqual(b.totalRemaining('Pork - minced'), 5000);
});

test('running short is flagged and the rest is costed at the latest price', () => {
  const b = book([lot('A', '13/10/2026', 3000, 400, 330)]);
  const r = cost(b, utc(2026, 10, 19));
  assert.ok(r.flags.some((f) => /only 400g was left/.test(f)));
  assert.strictEqual(r.lotUse[0].qty, 400);
});

test('all stock used up is flagged, then the latest price is used', () => {
  const b = book([lot('A', '13/10/2026', 3000, 0, 330)]);
  const r = cost(b, utc(2026, 10, 19));
  assert.ok(r.flags.some((f) => /no stock left in the lots/.test(f)));
  assert.strictEqual(r.lotUse.length, 0);
});

test('untracked condiments never use lots', () => {
  const b = book([lot('P', '13/10/2026', 500, 500, 100, 'Black pepper')]);
  const r = costBatch({ batch: { date: utc(2026, 10, 19), yield: 21, lines: [], sizes: [] }, recipe: recipe(), shorthand: defaultShorthand(), priceBook, lotBook: b });
  assert.strictEqual(r.lotUse.filter((u) => u.name === 'Black pepper').length, 0);
  assert.strictEqual(b.totalRemaining('Black pepper'), 500);
});

test('count: lower reduces the oldest lots, higher adds an adjustment lot', () => {
  const b = book([lot('A', '13/10/2026', 3000, 1000, 330), lot('B', '18/10/2026', 5000, 5000, 450)]);
  b.countTo('Pork - minced', 5500, TODAY);
  assert.deepStrictEqual([b.byId.get('A').remaining, b.byId.get('B').remaining], [500, 5000]);
  const c = book([lot('B', '18/10/2026', 5000, 2000, 450)]);
  c.countTo('Pork - minced', 2500, TODAY);
  assert.strictEqual(c.added.length, 1);
  assert.strictEqual(c.added[0].remaining, 500);
  assert.strictEqual(c.added[0].unitCost, 0.09);
});

function makeStore(initial = []) {
  const state = { rows: [HEAD, ...initial], usage: [], added: [] };
  const deps = {
    loadLotBook: async () => new LotBook(state.rows, ['Black pepper', 'Salt'], TODAY),
    saveLots: async (b, usage) => {
      for (const id of b.consumed.keys()) { const l = b.byId.get(id); state.rows[l.rowIndex - 1] = lot(l.id, '13/10/2026', l.qty, l.remaining, l.total, l.name); }
      for (const l of b.added) state.rows.push(lot(l.id, '19/10/2026', l.qty, l.remaining, l.total, l.name));
      state.usage.push(...usage);
    },
    addLots: async (items) => { for (const it of items) { state.added.push(it); state.rows.push(lot(`N${state.rows.length}`, '18/10/2026', it.qty, it.qty, it.price, it.name)); } },
    loadCatalogue: async () => ['Pork - minced', 'Onion', 'Black pepper'],
    loadUntracked: async () => ['Black pepper', 'Salt'],
  };
  return { state, deps };
}

test('typed receipt makes lots for countable items and skips condiments', async () => {
  const { state, deps } = makeStore();
  const replies = await processTypedReceipt('18/10\nminced pork 3000g 330thb\nblack pepper 100g 40thb', TODAY, {
    loadCatalogue: deps.loadCatalogue, appendExpenseRows: async () => {}, addLots: deps.addLots, loadUntracked: deps.loadUntracked,
  });
  assert.strictEqual(state.added.length, 1);
  assert.deepStrictEqual([state.added[0].name, state.added[0].qty, state.added[0].price], ['Pork - minced', 3000, 330]);
  assert.ok(replies.some((r) => /Added to stock lots: Pork - minced 3000g/.test(r) && /Black pepper/.test(r)));
});

test('opening stock: adds lots once, refuses a second opening for the same item, lists and counts', async () => {
  const { state, deps } = makeStore();
  const d = { ...deps };
  let out = await processLots('opening 19/10\nminced pork 2000g 220thb', TODAY, d);
  assert.match(out[0], /Opening stock added/);
  assert.strictEqual(state.added.length, 1);
  out = await processLots('opening 19/10\nminced pork 2000g 220thb', TODAY, d);
  assert.match(out[0], /already have stock lots/);
  assert.strictEqual(state.added.length, 1);
  out = await processLots('lots', TODAY, d);
  assert.match(out[0], /Pork - minced: 2,000g/);
  out = await processLots('count minced pork 1500g', TODAY, d);
  assert.match(out[0], /2,000g on the books, now 1,500g/);
  assert.strictEqual(await processLots('what time is dinner?', TODAY, d), null);
});

test('logging a batch takes the grams off the lots, once, and writes the usage trail', async () => {
  const { state, deps } = makeStore([lot('A', '13/10/2026', 3000, 1000, 330), lot('B', '18/10/2026', 5000, 5000, 450)]);
  const logged = new Set();
  const noteDeps = {
    today: TODAY,
    loadShorthand: async () => defaultShorthand(),
    loadRecipe: async () => recipe(),
    loadPriceBook: async () => priceBook,
    isLogged: async (k) => logged.has(k),
    batchKey: (t, d, y, l) => `${t}-${d.toISOString().slice(0, 10)}-${y}-${l.length}`,
    writeBatch: async (r, k) => logged.add(k),
    loadLotBook: deps.loadLotBook, saveLots: deps.saveLots,
  };
  const note = '19/10\nbolo\nmeat 1000\nyield 21';
  const first = await processNote(note, noteDeps);
  assert.match(first[0], /Stock left after this batch: Pork - minced 5,000g/);
  assert.deepStrictEqual(state.usage.map((u) => [u[3], u[5]]), [['A', 1000]]);
  const again = await processNote(note, noteDeps); // same note again is a duplicate, takes nothing
  assert.match(again[0], /already in the Cook Log/);
  assert.strictEqual(state.usage.length, 1);
  assert.strictEqual(state.rows[1][6], 0);
});

test('missing yield: nothing is logged and no stock is taken', async () => {
  const { state, deps } = makeStore([lot('A', '13/10/2026', 3000, 3000, 330)]);
  const noteDeps = {
    today: TODAY, loadShorthand: async () => defaultShorthand(), loadRecipe: async () => recipe(), loadPriceBook: async () => priceBook,
    isLogged: async () => false, batchKey: () => 'k', writeBatch: async () => { throw new Error('should not write'); },
    loadLotBook: deps.loadLotBook, saveLots: deps.saveLots,
  };
  const r = await processNote('19/10\nbolo\nmeat 1000', noteDeps);
  assert.match(r[0], /NOT logged/);
  assert.strictEqual(state.usage.length, 0);
  assert.strictEqual(state.rows[1][6], 3000);
});
