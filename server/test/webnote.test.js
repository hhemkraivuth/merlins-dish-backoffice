const test = require('node:test');
const assert = require('node:assert');
const { createCook } = require('../routes/cook');
const { defaultShorthand } = require('../lib/aliases');
const { buildPriceBook } = require('../lib/priceBook');
const { parseDishTab } = require('../lib/sheetRecipe');
const { utc } = require('../lib/dates');
const { bologneseRows, priceLog } = require('./fixtures');

function call(handler, body) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } };
    handler({ body }, res);
  });
}

function deps(written) {
  const TODAY = utc(2026, 10, 15);
  const book = buildPriceBook({ priceLogRows: priceLog, today: TODAY });
  const logged = new Set();
  return {
    today: TODAY, loadShorthand: async () => defaultShorthand(), loadRecipe: async () => parseDishTab(bologneseRows), loadPriceBook: async () => book,
    isLogged: async (k) => logged.has(k), batchKey: (t, d, y, l) => `${t}-${d.toISOString().slice(0, 10)}-${y}-${l.length}`,
    writeBatch: async (r, k) => { logged.add(k); written.push(k); },
  };
}

test('web cook note: a pasted note is logged like the LINE group, an empty or unreadable one is refused', async () => {
  const written = [];
  const { note } = createCook(() => ({}), () => ({ note: deps(written) }));
  const ok = await call(note, { text: '7/10\nBolo\nMeat 1000\nO 446\nyield 21' });
  assert.strictEqual(ok.code, 200);
  assert.match(ok.body.replies[0], /Polished Pork Bolognese, 07\/10\/2026, 21 serves/);
  assert.strictEqual(written.length, 1);
  assert.strictEqual((await call(note, { text: '   ' })).code, 400);
  assert.strictEqual((await call(note, { text: 'hello there' })).code, 400);
  const help = await call(note, { text: 'help' });
  assert.match(help.body.replies[0], /Send a cook note like this/);
});
