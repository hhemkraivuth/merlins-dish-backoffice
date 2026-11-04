// Shared, read-only loaders for the live Merlin's numbers sheet (with a short cache),
// used by both the LINE group and the Batch Cook web page.

const { readLiveRange } = require('./liveSheet');
const { readTab } = require('./sheets');
const { buildPriceBook, normName, unitKind } = require('./priceBook');
const { parseDishTab } = require('./sheetRecipe');
const { bangkokToday } = require('./dates');

let cache = { at: 0, priceBook: null, catalogue: null, units: null };

async function fresh() {
  if (Date.now() - cache.at < 30000 && cache.priceBook) return cache;
  const [priceLogRows, expenseRows, tracker] = await Promise.all([
    readLiveRange('Price Log', 'A:H'),
    readTab('Expense Log').catch(() => []),
    readLiveRange('Price Tracker', 'B:D').catch(() => []),
  ]);
  cache = {
    at: Date.now(),
    priceBook: buildPriceBook({ priceLogRows, expenseRows, today: bangkokToday() }),
    units: new Map(tracker.filter((r) => r[0] && r[2]).map((r) => [normName(String(r[0])), unitKind(r[2])])),
    catalogue: tracker.map((r) => String(r[0] || '').trim()).filter((n) => n && n.toLowerCase() !== 'ingredient'),
  };
  return cache;
}

// Called after a receipt is logged so the next cook note sees the new price straight away.
function invalidate() { cache = { at: 0, priceBook: null, catalogue: null, units: null }; }

module.exports = {
  invalidate,
  loadPriceBook: async () => (await fresh()).priceBook,
  loadCatalogue: async () => (await fresh()).catalogue,
  loadUnits: async () => (await fresh()).units,
  loadRecipe: async (tab) => parseDishTab(await readLiveRange(tab, 'A1:I80')),
};
