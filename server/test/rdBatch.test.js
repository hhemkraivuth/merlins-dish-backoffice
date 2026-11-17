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

test('forceRd marks every batch in a web note as R&D', async () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../lib/cookService.js'), 'utf8');
  assert.ok(/if \(deps\.forceRd\) batch\.rd = true/.test(src));
});

test('What I cooked lists R&D batches with a tag, but keeps them out of the totals', () => {
  const { buildCookLog } = require('../lib/logViews');
  const head = ['Batch Key', 'Date Cooked', 'Dish', 'Yield', 'Ingredient Cost', 'Packaging Cost', 'Utility Cost', 'Total Batch Cost', 'Cost per Portion', 'Flags', 'Logged At', 'Source'];
  const logRows = [head, ['A', '14/11/2026', 'Noir Ragu', 10, 400, 50, 10, 460, 46, '', '', 'Web']];
  const rdRows = [head, ['R1', '17/11/2026', 'Braised Lamb shank', 6, 400, 30, 10, 440, 73.3, '', '', 'Web']];
  const log = buildCookLog({ logRows, sizeRows: [], rdRows, rdSizeRows: [], month: '11/2026', today: new Date(Date.UTC(2026, 10, 17)) });
  assert.strictEqual(log.rows.length, 2);
  assert.deepStrictEqual(log.rows.map((r) => !!r.rd), [false, true]);
  assert.strictEqual(log.totals.batches, 1);
  assert.strictEqual(log.totals.portions, 10);
  assert.strictEqual(log.totals.cost, 460);
  assert.strictEqual(log.byDish.length, 1);
});

test('Delete finds an R&D batch by its key and clears its R&D rows', async () => {
  const { undoByKey } = require('../lib/batchUndo');
  const tabs = { 'Cook Log': [['Batch Key']], 'R&D Log': [['Batch Key'], ['R1', '17/11/2026', 'Braised Lamb shank', 6]], 'R&D Log Lines': [['k'], ['R1', '', '', 'Ingredient', 'Lamb - shank', 794, 'g']] };
  const deleted = [];
  const io = { readTab: async (t) => tabs[t] || [], updateRow: async () => {}, deleteRowsWhere: async (t, fn) => { if ((tabs[t] || []).slice(1).some(fn)) deleted.push(t); } };
  const out = await undoByKey('R1', io);
  assert.strictEqual(out.status, 'undone');
  assert.deepStrictEqual(deleted.sort(), ['R&D Log', 'R&D Log Lines']);
});
