// Reads the sheets and builds the shopping plan. Cached for 5 minutes.
const { readTab } = require('./sheets');
const { readLiveRange } = require('./liveSheet');
const { bangkokToday } = require('./dates');
const { LEDGER_TAB } = require('./ledger');
const plan = require('./shoppingPlan');

const TTL = 5 * 60 * 1000;
let cache = { at: 0, data: null };

async function own(tab) {
  try { return await readTab(tab); } catch (err) {
    if (/unable to parse range|not found/i.test(String(err && err.message))) return [];
    throw new Error(`Could not read the "${tab}" tab: ${err.message}`);
  }
}
// The live Merlin's numbers sheet is read only. A failure is reported, not hidden.
async function live(tab, a1, warnings) {
  try { return await readLiveRange(tab, a1); } catch (err) {
    warnings.push(`Could not read "${tab}" from Merlin's numbers (${err.message}).`); return [];
  }
}

async function getPlan({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < TTL) return cache.data;
  const warnings = [];
  const [master, priceLog, shelf, ledger, expense, cookLog, sizes, lines] = await Promise.all([
    live('Master Log', 'A:K', warnings), live('Price Log', 'A:H', warnings), live('Shelf Life', 'A:B', []).catch(() => []),
    own(LEDGER_TAB), own('Expense Log'), own('Cook Log'), own('Cook Log Sizes'), own('Cook Log Lines'),
  ]);
  const shelfOwn = await own('Shelf Life');
  const stock = new Map();
  try {
    const lots = require('./ingredientLots'); const { normName } = require('./priceBook');
    const book = await lots.loadLotBook(bangkokToday());
    for (const name of book.names()) {
      const live = book.lotsFor(name).filter((l) => l.remaining > 1e-6);
      if (live.length) stock.set(normName(name), { left: book.totalRemaining(name), unit: live[0].unit });
    }
  } catch (err) { warnings.push(`Could not read the counted stock (${err.message}), so what is left is estimated from receipts.`); }
  const result = plan.buildShoppingPlan({
    today: bangkokToday(),
    sales: plan.combineSales({ master, ledger }),
    cookLogRows: cookLog, sizeRows: sizes, lineRows: lines,
    priceLogRows: priceLog, expenseRows: expense, shelfRows: [...shelf, ...shelfOwn], stock,
  });
  result.warnings = [...warnings, ...result.warnings];
  cache = { at: Date.now(), data: result };
  return result;
}

module.exports = { getPlan };
