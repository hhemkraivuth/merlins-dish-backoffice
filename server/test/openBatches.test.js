const test = require('node:test');
const assert = require('node:assert');
const { processNote } = require('../lib/cookService');
const { runCommands } = require('../lib/textCommands');
const ob = require('../lib/openBatches');
const { defaultShorthand } = require('../lib/aliases');
const { buildPriceBook } = require('../lib/priceBook');
const { parseDishTab } = require('../lib/sheetRecipe');
const { utc } = require('../lib/dates');
const { bologneseRows, priceLog } = require('./fixtures');

const TODAY = utc(2026, 10, 15);

function fakeIo() {
  const rows = [ob.HEADERS];
  return {
    rows,
    ensure: async () => {},
    readTab: async () => rows.map((r) => r.slice()),
    appendRows: async (tab, add) => { rows.push(...add); },
    deleteRowsWhere: async (tab, fn) => { let n = 0; for (let i = rows.length - 1; i > 0; i--) if (fn(rows[i])) { rows.splice(i, 1); n++; } return n; },
  };
}
function makeDeps() {
  const io = fakeIo(); const written = []; const logged = new Set();
  const book = buildPriceBook({ priceLogRows: priceLog, today: TODAY });
  const api = { find: (d, dt) => ob.findOpen(d, dt, io), park: (b, o) => ob.parkBatch(b, o, io), remove: (k) => ob.removeOpen(k, io), list: () => ob.listOpen(io), toBatch: ob.toBatch };
  return {
    io, written, today: TODAY, openBatches: api,
    loadShorthand: async () => defaultShorthand(),
    loadRecipe: async () => parseDishTab(bologneseRows),
    loadPriceBook: async () => book,
    isLogged: async (k) => logged.has(k),
    batchKey: (tab, d, y, lines) => `${tab}-${d.toISOString().slice(0, 10)}-${y}-${lines.length}`,
    writeBatch: async (r, k) => { logged.add(k); written.push({ r, k }); },
  };
}

test('a note without portions is saved as an open batch, not refused, nothing is logged', async () => {
  const deps = makeDeps();
  const r = await processNote('7/10\nBolo\nMeat 1000\nO 446', deps);
  assert.match(r[0], /Saved as an open batch/);
  assert.strictEqual(deps.written.length, 0);
  assert.strictEqual((await deps.openBatches.list()).length, 1);
});

test('sending the same note twice saves one open batch', async () => {
  const deps = makeDeps();
  await processNote('7/10\nBolo\nMeat 1000', deps);
  const again = await processNote('7/10\nBolo\nMeat 1000', deps);
  assert.match(again[0], /already saved as an open batch/);
  assert.strictEqual((await deps.openBatches.list()).length, 1);
});

test('"bolo yield 21" completes the open batch with the saved ingredients and its cooked date', async () => {
  const deps = makeDeps();
  await processNote('7/10\nBolo\nMeat 1000\nO 446\nG 60\nCl 234\nC 230', deps);
  const r = await processNote('bolo yield 21', deps);
  assert.strictEqual(deps.written.length, 1);
  assert.match(r[0], /Completed the batch cooked on 07\/10\/2026/);
  assert.match(r[0], /฿614\.69, ฿29\.27 per portion/); // the same cost as sending it all in one note
  assert.strictEqual((await deps.openBatches.list()).length, 0, 'removed once logged');
});

test('a date picks the right open batch, and "open" and "drop" work', async () => {
  const deps = makeDeps();
  await processNote('7/10\nBolo\nMeat 1000', deps);
  await processNote('9/10\nBolo\nMeat 900', deps);
  const list = await runCommands('open', { note: deps });
  assert.match(list[0], /Waiting for portions \(2\)/);
  const r = await processNote('bolo 7/10 yield 20', deps);
  assert.match(r[0], /cooked on 07\/10\/2026/);
  assert.strictEqual((await deps.openBatches.list()).length, 1);
  const dropped = await runCommands('drop bolo 9/10', { note: deps });
  assert.match(dropped[0], /Dropped/);
  assert.strictEqual((await deps.openBatches.list()).length, 0);
});

test('a note with a yield still logs straight away, and yield only with nothing open keeps the old behaviour', async () => {
  const deps = makeDeps();
  const r = await processNote('7/10\nBolo\nMeat 1000\nyield 21', deps);
  assert.match(r[0], /Logged to the Cook Log/);
  const solo = await processNote('8/10\nBolo\nyield 21', deps); // recipe quantities, no open batch
  assert.match(solo[0], /Logged to the Cook Log/);
  assert.strictEqual(deps.written.length, 2);
});

test('completion does not log twice when sent again', async () => {
  const deps = makeDeps();
  await processNote('7/10\nBolo\nMeat 1000', deps);
  await processNote('bolo yield 21', deps);
  const again = await processNote('7/10\nBolo\nMeat 1000\nyield 21', deps);
  assert.match(again[0], /already in the Cook Log/);
  assert.strictEqual(deps.written.length, 1);
});

const { parseNote } = require('../lib/noteParser');
test('portion only lines are read: dish yield, dish date yield, date dish portions, stew sizes', () => {
  const p = (t) => parseNote(t, defaultShorthand(), TODAY).batches[0];
  assert.strictEqual(p('bolo yield 21').yield, 21);
  const b = p('bolo 7/10 yield 21');
  assert.strictEqual(b.yield, 21); assert.strictEqual(b.date.getUTCDate(), 7);
  assert.strictEqual(p('7/10 bolo 21 portions').yield, 21);
  assert.deepStrictEqual(p('dbs 20/10 7r 4l portions').sizeCounts.map((z) => z.count), [7, 4]);
  assert.strictEqual(p('bolo yield 21').lines.length, 0);
});
