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
  // What is running out is never cached: a recount shows on the list straight away.
  if (!force && cache.data && Date.now() - cache.at < TTL) {
    try { cache.data.urgent = await require('./lowStock').loadUrgent(); } catch (err) { /* keep the last one */ }
    return cache.data;
  }
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
  // Hand counted stock (cans, bottles, tins, packets) joins the receipts based stock, converted to ml, g or pieces.
  let loose = new Map(); let stockNames = new Map(); const bagKeys = new Set(); const ignoreKeys = new Set();
  try {
    const { getAllStock } = require('./stockCounts'); const { normName } = require('./priceBook'); const st = require('./appState');
    const cs = require('./countedStock');
    let sizes = {}; try { sizes = JSON.parse((await st.getState('stock_item_sizes')) || '{}'); } catch (err) { sizes = {}; }
    // Bagged meat is counted in grams by hand, so its bag total replaces whatever the receipts say is left.
    try { for (const k of Object.keys(await require('./stockBags').load())) { const bk = cs.baseNameOf(k, normName); stock.delete(bk); bagKeys.add(bk); } } catch (err) { /* no bags yet */ }
    const all = await getAllStock();
    for (const it of all) if ((it.category || it.guess) === 'Drinks') ignoreKeys.add(cs.baseNameOf(it.itemName, normName)); // drinks for sale are not recipe ingredients
    const counted = cs.countedToStock(all, sizes, normName, stock);
    for (const [k, v] of counted.stock) stock.set(k, v);
    loose = counted.loose; stockNames = counted.names;
  } catch (err) { warnings.push(`Could not read the Stock Counts tab (${err.message}).`); }
  // Brand changes, blends, the links Lily set by hand and the ingredients she stopped buying.
  let swaps = []; let blends = new Map(); let links = {}; let retired = [];
  try { swaps = require('./ingredientSwap').listSwaps(await require('./cookLog').readShorthandRows()); } catch (err) { warnings.push(`Could not read the brand changes (${err.message}).`); }
  try { blends = await require('./blends').loadBlends(); } catch (err) { warnings.push(`Could not read the blends (${err.message}).`); }
  try { links = JSON.parse((await require('./appState').getState('stock_links')) || '{}'); } catch (err) { links = {}; }
  try { retired = JSON.parse((await require('./appState').getState('plan_retired')) || '[]'); } catch (err) { retired = []; }
  const result = plan.buildShoppingPlan({
    today: bangkokToday(),
    sales: plan.combineSales({ master, ledger }),
    cookLogRows: cookLog, sizeRows: sizes, lineRows: lines,
    priceLogRows: priceLog, expenseRows: expense, shelfRows: [...shelf, ...shelfOwn], stock,
    loose, stockNames, links, swaps, blends, retired, bagKeys, ignoreKeys,
  });
  try { result.urgent = await require('./lowStock').loadUrgent(); } catch (err) { result.urgent = []; warnings.push(`Could not work out what is running out (${err.message}).`); }
  result.warnings = [...warnings, ...result.warnings];
  cache = { at: Date.now(), data: result };
  return result;
}

// Called whenever stock changes, so the next look at the plan is rebuilt with the new counts.
function invalidate() { cache = { at: 0, data: null }; }

module.exports = { getPlan, invalidate };
