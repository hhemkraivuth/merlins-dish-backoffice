// Shared, read-only loaders for the live Merlin's numbers sheet (with a short cache),
// used by both the LINE group and the Batch Cook web page.

const { readLiveRange } = require('./liveSheet');
const { readTab } = require('./sheets');
const { buildPriceBook, normName, unitKind } = require('./priceBook');
const { parseDishTab } = require('./sheetRecipe');
const { bangkokToday } = require('./dates');
const pastaSeed = require('../data/pastaSeed.json');

// Pasta names the pasta cards already price by ("Risoni", "Pasta - Risoni"), so a receipt line for them matches even when the
// Price Tracker has no row yet. Orzo is the old name of Risoni and is left out so it stays flagged for renaming.
const PASTA_NAMES = (pastaSeed.cards || []).flatMap((c) => c.priceNames || []).filter((n) => n && !/^orzo$/i.test(n));

let cache = { at: 0, priceBook: null, catalogue: null, units: null };

// Adds the pasta names that are not in the list yet (compared ignoring capitals, so no look-alike duplicates are created).
function withPasta(names) {
  const seen = new Set(names.map((n) => n.toLowerCase()));
  return [...names, ...PASTA_NAMES.filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))];
}

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
    // Price Tracker names first, then any other ingredient already in the Price Log, so an item missing from the tracker still matches.
    catalogue: withPasta([...new Set([
      ...tracker.map((r) => String(r[0] || '').trim()),
      ...priceLogRows.slice(1).map((r) => String(r[1] || '').trim()),
    ].filter((n) => n && !/^(ingredient|item)$/i.test(n) && !/^\d/.test(n)))]),
  };
  return cache;
}

// Called after a receipt is logged so the next cook note sees the new price straight away.
function invalidate() { cache = { at: 0, priceBook: null, catalogue: null, units: null }; }

module.exports = {
  withPasta,
  invalidate,
  loadPriceBook: async () => (await fresh()).priceBook,
  loadCatalogue: async () => (await fresh()).catalogue,
  loadUnits: async () => (await fresh()).units,
  loadRecipe: async (tab) => parseDishTab(await readLiveRange(tab, 'A1:I80')),
};
