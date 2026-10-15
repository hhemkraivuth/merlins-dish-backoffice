// Shared, read-only loaders for the live Merlin's numbers sheet (with a short cache),
// used by both the LINE group and the Batch Cook web page.

const { readLiveRange } = require('./liveSheet');
const { readTab } = require('./sheets');
const { buildPriceBook } = require('./priceBook');
const { parseDishTab } = require('./sheetRecipe');
const { bangkokToday } = require('./dates');

let cache = { at: 0, priceBook: null, catalogue: null };

async function fresh() {
  if (Date.now() - cache.at < 30000 && cache.priceBook) return cache;
  const [priceLogRows, expenseRows, tracker] = await Promise.all([
    readLiveRange('Price Log', 'A:H'),
    readTab('Expense Log').catch(() => []),
    readLiveRange('Price Tracker', 'B:B').catch(() => []),
  ]);
  cache = {
    at: Date.now(),
    priceBook: buildPriceBook({ priceLogRows, expenseRows, today: bangkokToday() }),
    catalogue: tracker.map((r) => String(r[0] || '').trim()).filter((n) => n && n.toLowerCase() !== 'ingredient'),
  };
  return cache;
}

module.exports = {
  loadPriceBook: async () => (await fresh()).priceBook,
  loadCatalogue: async () => (await fresh()).catalogue,
  loadRecipe: async (tab) => parseDishTab(await readLiveRange(tab, 'A1:E80')),
};
