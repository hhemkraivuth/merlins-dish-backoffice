const test = require('node:test');
const assert = require('node:assert');
const { processTypedReceipt } = require('../lib/cookService');
const { withPasta } = require('../lib/liveData');
const { matchIngredient } = require('../lib/typedReceipt');
const { buildPriceBook } = require('../lib/priceBook');
const { utc } = require('../lib/dates');

const TODAY = utc(2026, 10, 25);
// The Price Tracker and Price Log have no risoni row, only the old "Pasta - riso".
const TRACKER_ONLY = ['Milk', 'Onion', 'Pasta - Tubetti', 'Pasta - riso'];

function deps(catalogue) {
  const state = { rows: [], lots: [] };
  return {
    state,
    deps: {
      loadCatalogue: async () => catalogue,
      appendExpenseRows: async (r) => state.rows.push(...r),
      addLots: async (l) => state.lots.push(...l),
      loadUntracked: async () => [],
      loadPackSizes: async () => new Map(),
      loadPriceBook: async () => buildPriceBook({ expenseRows: [['Date', 'Ingredient', 'Price', 'Unit', 'Cost']], today: TODAY }),
    },
  };
}

test('risoni matches once the pasta names are added to the list', () => {
  assert.deepStrictEqual(matchIngredient('risoni', TRACKER_ONLY), {});
  const list = withPasta(TRACKER_ONLY);
  assert.strictEqual(matchIngredient('risoni', list).name, 'Risoni');
  assert.strictEqual(matchIngredient('pasta risoni', list).name, 'Pasta - Risoni');
});

test('adding pasta names never creates a look-alike duplicate', () => {
  const list = withPasta(['Pasta - Tubetti', 'Pasta - tubetti']);
  assert.strictEqual(list.filter((n) => n.toLowerCase() === 'pasta - tubetti').length, 2);
  assert.ok(!list.some((n) => /^orzo$/i.test(n)), 'the old Orzo name stays out so it is flagged for renaming');
});

test('a risoni receipt line is logged as Risoni and is not reported as unmatched', async () => {
  const { state, deps: d } = deps(withPasta(TRACKER_ONLY));
  const out = await processTypedReceipt('22/11\nrisoni 500g x 4, 75 each', TODAY, d);
  assert.strictEqual(state.rows[0][1], 'Risoni');
  assert.ok(!out.join('\n').match(/Not matched to a known ingredient/));
  assert.ok(!/not matched/i.test(state.rows[0][6]));
});

test('price and weights typed plainly are reported as a reading, not a guess', async () => {
  const { state, deps: d } = deps(withPasta(TRACKER_ONLY));
  const out = await processTypedReceipt('22/11\nrisoni 500g x 4, 75 each', TODAY, d).then((r) => r.join('\n'));
  assert.match(out, /How I read these lines/);
  assert.ok(!/made a guess/.test(out));
  assert.match(state.rows[0][6], /Typed: "risoni 500g x 4, 75 each"/);
});

test('a kilo guess is still reported as a guess to check', async () => {
  const { deps: d } = deps(withPasta(TRACKER_ONLY));
  const out = await processTypedReceipt('22/11\nonion 0.9g 40thb', TODAY, d).then((r) => r.join('\n'));
  assert.match(out, /I made a guess on the weights/);
});
