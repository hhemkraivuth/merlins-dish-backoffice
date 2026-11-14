const test = require('node:test');
const assert = require('node:assert');
const { processNote } = require('../lib/cookService');
const { parseNote } = require('../lib/noteParser');
const { defaultShorthand } = require('../lib/aliases');
const { buildPriceBook } = require('../lib/priceBook');
const { parseDishTab } = require('../lib/sheetRecipe');
const { utc } = require('../lib/dates');
const { summarise } = require('../lib/reports');
const { rdFrom, rdPurchases } = require('../lib/rdBatches');
const { bologneseRows, priceLog } = require('./fixtures');

const TODAY = utc(2026, 10, 15);
const sh = defaultShorthand();

function makeDeps() {
  const written = []; const logged = new Set();
  const book = buildPriceBook({ priceLogRows: priceLog, today: TODAY });
  return {
    written, today: TODAY,
    loadShorthand: async () => sh,
    loadRecipe: async () => parseDishTab(bologneseRows),
    loadPriceBook: async () => book,
    isLogged: async (k) => logged.has(k),
    batchKey: (tab, d, y, lines) => `${tab}-${d.toISOString().slice(0, 10)}-${y}-${lines.map((l) => l.token).join('')}`,
    writeBatch: async (r, k) => { logged.add(k); written.push({ r, k }); },
  };
}

test('rd before the dish marks the batch, in every spelling and with the date either side', () => {
  for (const note of ['7/10\nrd bolo\nMeat 1000\nyield 6', '7/10 rd bolo\nMeat 1000\nyield 6', 'rd 7/10 bolo\nMeat 1000\nyield 6', '7/10\nR&D bolo\nMeat 1000\nyield 6', '7/10\nr&d Bolo\nMeat 1000\nyield 6']) {
    const { batches, problems } = parseNote(note, sh, TODAY);
    assert.strictEqual(batches.length, 1, note);
    assert.strictEqual(batches[0].rd, true, note);
    assert.strictEqual(batches[0].yield, 6, note);
    assert.deepStrictEqual(problems, [], note);
  }
  assert.ok(!parseNote('7/10\nbolo\nMeat 1000\nyield 6', sh, TODAY).batches[0].rd);
});

test('an rd batch is costed, flagged rd, and logged with its portions', async () => {
  const deps = makeDeps();
  const r = await processNote('7/10\nrd bolo\nMeat 1000\nyield 6', deps);
  assert.strictEqual(deps.written.length, 1);
  assert.strictEqual(deps.written[0].r.rd, true);
  assert.strictEqual(deps.written[0].r.yield, 6);
  assert.match(r[0], /R&D batch/);
  assert.match(r[0], /6 portions are not added to sellable stock/);
});

test('an rd batch and a normal batch with the same lines are two different batches', async () => {
  const deps = makeDeps();
  await processNote('7/10\nbolo\nMeat 1000\nyield 6', deps);
  const r = await processNote('7/10\nrd bolo\nMeat 1000\nyield 6', deps);
  assert.strictEqual(deps.written.length, 2);
  assert.doesNotMatch(r[0], /already in the Cook Log/);
});

test('an rd batch without portions is not parked as an open batch', async () => {
  const deps = makeDeps();
  const r = await processNote('7/10\nrd bolo\nMeat 1000', deps);
  assert.strictEqual(deps.written.length, 0);
  assert.match(r[0], /R&D batch needs its portions/);
});

test('R&D cost shows on its own line, comes off the margin, and never touches food cost', () => {
  const rows = [['Batch Key', 'Date Cooked', 'Dish', 'Portions', 'I', 'P', 'U', 'Total Batch Cost', 'Per'], ['k1', '10/11/2026', 'Bolo', '6', '', '', '', '240', '40']];
  assert.strictEqual(rdFrom(rows)[0].portions, 6);
  const p = rdPurchases(rows);
  const [wk] = summarise([], [], p, 'week', {});
  assert.strictEqual(wk.rdCost, 240);
  assert.strictEqual(wk.rdPortions, 6);
  assert.strictEqual(wk.rdBatches, 1);
  assert.strictEqual(wk.foodCost, 0);
  assert.strictEqual(wk.margin, -240);
  assert.strictEqual(wk.moneyToTakeOut, 0);
});
