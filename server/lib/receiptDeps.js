// The one set of dependencies for typed receipts, shared by the LINE group and the Weekly Receipts page,
// so both do exactly the same thing (overheads, brands, undo IDs, best prices, stock lots).
function buildReceiptDeps() {
  const live = require('./liveData');
  const { appendRows, readTab, deleteRowsWhere } = require('./sheets');
  const { getAllStock, setStockCount } = require('./stockCounts');
  const { extractReceiptWithCatalogue } = require('./receiptVision');
  const lots = require('./ingredientLots');
  const packs = require('./packSizes');
  const cookLog = require('./cookLog');
  const { receiptAliases } = require('./ingredientAlias');
  const appState = require('./appState');
  const appStore = { get: appState.getState, set: appState.setState };
  const refreshBestPrices = async () => require('./bestPrices').writeBestPrices(await live.loadPriceBook());
  return {
    loadCatalogue: live.loadCatalogue,
    loadUnits: live.loadUnits,
    loadAliases: async () => receiptAliases(await cookLog.readShorthandRows()),
    adjustPacks: async (name, delta) => {
      const all = await getAllStock();
      const norm = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const item = all.find((i) => norm(i.itemName) === norm(name));
      if (!item) return { found: false };
      const now = (Number(item.currentCount) || 0) + delta;
      await setStockCount(item.itemName, now, item.unit, 'Receipt');
      return { found: true, now };
    },
    extractReceipt: extractReceiptWithCatalogue,
    appendExpenseRows: async (rows) => { await appendRows('Expense Log', rows); live.invalidate(); },
    appendOverheads: async (rows) => { const o = require('./overheads'); await cookLog.ensureTab(o.TAB, o.HEADERS); await appendRows(o.TAB, rows); },
    usdRate: () => require('./usdRate').getUsdRate({ store: appStore }),
    addRecurring: async (item, from) => {
      const r = require('./recurringOverheads');
      const out = r.addItem(r.parse(await appStore.get(r.KEY)), item, from);
      if (out.error) throw new Error(out.error);
      await appStore.set(r.KEY, JSON.stringify(out.list));
    },
    refreshBestPrices,
    addLots: lots.addLots,
    loadUntracked: lots.loadUntracked,
    loadPackSizes: packs.loadPackSizes,
    loadPriceBook: live.loadPriceBook,
    // used by "undo receipt"
    undo: {
      readRows: (tab) => readTab(tab),
      deleteWhere: (tab, pred) => deleteRowsWhere(tab, pred),
      after: async () => { live.invalidate(); await refreshBestPrices(); },
    },
    // used by "alias ..."
    alias: {
      readRows: () => cookLog.readShorthandRows(),
      loadCatalogue: live.loadCatalogue,
      save: async (short, full) => {
        const k = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
        await cookLog.readShorthandRows();   // makes sure the tab exists
        await deleteRowsWhere(cookLog.SHORTHAND, (r) => String(r[0] || '').toLowerCase() === 'ingredient' && k(r[1]) === k(short));
        await appendRows(cookLog.SHORTHAND, [['Ingredient', short.toLowerCase(), full]]);
      },
    },
  };
}

module.exports = { buildReceiptDeps };
