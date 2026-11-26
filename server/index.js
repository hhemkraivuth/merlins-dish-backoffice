require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');

const ordersRoute = require('./routes/orders');
const receiptsRoute = require('./routes/receipts');
const batchCookRoute = require('./routes/batchCook');
const stockCountsRoute = require('./routes/stockCounts');
const lineRoute = require('./routes/line');
const cookRoute = require('./routes/cook');
const ledgerRoute = require('./routes/ledger');
const logsRoute = require('./routes/logs');
const shoppingRoute = require('./routes/shopping');
const analysisRoute = require('./routes/analysis');
const marketingReportsRoute = require('./routes/marketingReports');
const { startTodoReminderTimer, startIndexExpiryTimer, startHuddleTimer, startCloudInboxTimer, startDriveImportTimer, startWeeklyExportTimer, startStockSnapshotTimer, startMonthlyOverheadsTimer, startAuditTimer } = require('./lib/scheduler');
const monthlyRoute = require('./routes/monthlyOverheads');
const appState = require('./lib/appState');

const app = express();
const PORT = process.env.PORT || 3001;

const upload = multer({ storage: multer.memoryStorage() });

// rawBody is kept so the LINE webhook can verify LINE's signature
app.use(express.json({ limit: '6mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
// Phones (and the LINE in-app browser) keep old pages and styles after a deploy, so make them re-check every time.
app.use(express.static(path.join(__dirname, '..', 'public'), { etag: true, lastModified: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

// Mode 1: Daily Orders (Grab screenshots)
app.post('/api/orders/batch', upload.array('screenshots', 60), ordersRoute.handleBatch);

// Mode 2: Weekly Receipts
app.post('/api/receipts/typed', receiptsRoute.handleTyped);
const receiptItemsRoute = require('./routes/receiptItems');
app.post('/api/receipts/item/delete', receiptItemsRoute.del);
app.post('/api/receipts/item/edit', receiptItemsRoute.edit);
// Photo reading is off unless RECEIPT_PHOTOS=on (it needs an Anthropic key and credit).
if (String(process.env.RECEIPT_PHOTOS || '').toLowerCase() === 'on') {
  app.post('/api/receipts/batch', upload.array('receipts', 60), receiptsRoute.handleBatch);
}

// Monthly logs with CSV downloads, and the ready to eat stock box
app.get('/api/overheads/monthly', monthlyRoute.listJson);
app.post('/api/overheads/monthly', monthlyRoute.add);
app.post('/api/overheads/monthly/stop', monthlyRoute.stop);
app.get('/api/receipts/log', logsRoute.receiptsJson);
app.get('/api/receipts/log.csv', logsRoute.receiptsCsv);
app.get('/api/cook/log', logsRoute.cookJson);
app.get('/api/cook/log.csv', logsRoute.cookCsv);
app.post('/api/export/weekly', logsRoute.weeklyExportRoute);
app.get('/api/shopping/plan', shoppingRoute.planJson);
app.post('/api/shopping/retire', shoppingRoute.retire);
app.post('/api/shopping/link', shoppingRoute.linkStockItem);
app.get('/api/analysis', analysisRoute.analysisJson);
app.get('/api/customers', require('./routes/customers').customersJson);
app.post('/api/customers/save', require('./routes/customers').customerSave);
app.post('/api/customers/merge', require('./routes/customers').customerMerge);
app.get('/api/stock/ready', logsRoute.readyJson);
app.post('/api/stock/ready-count', logsRoute.readyCount);

// Mode 3: Batch Cook
app.get('/api/batch-cook/dishes', batchCookRoute.listDishes);
app.get('/api/batch-cook/template/:dish', batchCookRoute.getTemplate);
app.get('/api/batch-cook/latest-prices', batchCookRoute.getLatestPrices);
app.post('/api/batch-cook/submit', batchCookRoute.submitBatch);

// Editable Batch Cook (prefilled from the recipe, same costing as the LINE group)
app.get('/api/cook/dishes', cookRoute.dishes);
app.get('/api/cook/recipe', cookRoute.recipe);
app.post('/api/cook/submit', cookRoute.submit);
app.get('/api/cook/open', cookRoute.openList);
app.post('/api/cook/open/complete', cookRoute.openComplete);
app.post('/api/cook/open/drop', cookRoute.openDrop);
app.post('/api/cook/log/delete', cookRoute.deleteBatch);
app.post('/api/cook/note', cookRoute.note);

// Mode 4: Stock Counts
app.get('/api/stock', stockCountsRoute.listStock);
app.get('/api/stock/ingredients', stockCountsRoute.listIngredientStock);
app.get('/api/stock/hidden', stockCountsRoute.hiddenList);
app.post('/api/stock/hidden', stockCountsRoute.hiddenChange);
app.post('/api/stock/update', stockCountsRoute.updateStock);
app.post('/api/stock/edit', stockCountsRoute.editStockRoute);
app.post('/api/stock/ingredient-category', stockCountsRoute.setIngredientCategory);
app.post('/api/stock/ingredient-brand', stockCountsRoute.setIngredientBrand);
app.get('/api/stock/lots', stockCountsRoute.ingredientLots);
app.post('/api/stock/purchase', stockCountsRoute.addPurchase);
app.post('/api/stock/waste', require('./routes/stockWaste').wasteIngredientRoute);
app.post('/api/stock/lot-edit', stockCountsRoute.editLot);
app.post('/api/stock/lot-delete', stockCountsRoute.deleteLot);
app.post('/api/stock/item-meta', stockCountsRoute.setItemMeta);
app.post('/api/stock/bags', stockCountsRoute.saveBags);
app.post('/api/stock/bags/suggest', stockCountsRoute.suggestBags);
app.post('/api/stock/category', stockCountsRoute.addCategoryRoute);
app.post('/api/stock/seed-meat', stockCountsRoute.seedMeat);
// Meat cards: batches that never took their bags off (preview, then apply), and the check before cooking a dish.
app.get('/api/stock/meat-catch-up', async (req, res) => { try { const bd = require('./lib/bagDeduct'); const { formatDMY } = require('./lib/dates'); const rows = await bd.catchUpPreview(); res.json({ batches: rows.map((r) => ({ key: r.key, dish: r.dish, date: formatDMY(r.date), lines: require('./lib/bagDeduct').reportLines(r.plan) })) }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/stock/meat-catch-up/apply', async (req, res) => { try { res.json({ done: await require('./lib/bagDeduct').catchUpApply() }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/stock/meat-check', async (req, res) => { try { const live = require('./lib/liveData'); const r = await live.loadRecipe(String(req.query.dish || '')); res.json({ meats: await require('./lib/bagDeduct').precheck(r.ingredients) }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/blends', stockCountsRoute.listBlends);
app.post('/api/blends', stockCountsRoute.saveBlendRoute);
app.post('/api/blends/delete', stockCountsRoute.deleteBlendRoute);
app.post('/api/stock/ingredient-count', stockCountsRoute.countIngredientPacks);
app.post('/api/stock/seed-packaging', stockCountsRoute.seedPackagingRoute);

// Team numbers: Ledger (Grab CSV + LINE orders), weekly and monthly reports, daily huddle
app.post('/api/ledger/grab-csv', upload.single('csv'), ledgerRoute.importGrab);
app.post('/api/ledger/sync-line', ledgerRoute.syncLine);
app.post('/api/ledger/drive-import', ledgerRoute.driveImport);
app.post('/api/reports/refresh', ledgerRoute.refresh);
app.get('/api/reports/summary', ledgerRoute.summary);
app.get('/api/reports/day', ledgerRoute.day);
app.get('/api/pit', ledgerRoute.pit);
app.get('/api/rider-fees', ledgerRoute.riderFeesList);
app.post('/api/rider-fees', ledgerRoute.riderFeesSave);
const pitLayout = require('./lib/pitLayout');
app.get('/api/pit/layout', async (req, res) => { try { res.json(await pitLayout.load()); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/pit/layout', async (req, res) => { try { res.json(await pitLayout.save(req.body)); } catch (err) { res.status(500).json({ error: err.message }); } });
const briefingRoute = require('./routes/briefing');
app.get('/api/briefing', briefingRoute.get);
app.post('/api/briefing/seen', briefingRoute.seen);
app.post('/api/todos', briefingRoute.add);
app.post('/api/todos/done', briefingRoute.done);
app.post('/api/todos/delete', briefingRoute.remove);
app.post('/api/todos/remind', briefingRoute.remind);
app.get('/api/link-clicks', async (req, res) => {
  try {
    const { readMenuTaps, readOrdersWithLink } = require('./lib/ordersSheet');
    const [taps, orders] = await Promise.all([readMenuTaps(), readOrdersWithLink().catch(() => [])]);
    res.json(require('./lib/linkClicks').summarise(taps, new Date(), orders));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/visual-merch', (req, res) => {
  const vm = require('./lib/visualMerch');
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const w = vm.windowNow(today);
  res.json({ today, now: w.now, next: w.next, seasons: vm.SEASONS, planned: vm.PLANNED, maybe: vm.MAYBE, endNote: vm.END_NOTE, orderWeb: 'https://merlins-dish-bot-production.up.railway.app/' });
});
app.get('/api/marketing', ledgerRoute.marketing);
app.post('/api/marketing/note', ledgerRoute.addMarketingNote);
app.get('/api/marketing/reports', marketingReportsRoute.list);
app.get('/api/marketing/report/:slug', marketingReportsRoute.one);
app.post('/api/marketing/report', marketingReportsRoute.save);
const contentPlanRoute = require('./routes/contentPlan');
app.get('/api/content-plan', contentPlanRoute.get);
app.post('/api/content-plan/status', contentPlanRoute.status);
app.post('/api/content-plan/caption', contentPlanRoute.caption);
app.post('/api/content-plan/schedule', contentPlanRoute.schedule);
app.get('/api/content-plan/media/:id', contentPlanRoute.media);
app.post('/api/content-plan/footer', contentPlanRoute.footer);
app.post('/api/content-plan/brief', contentPlanRoute.brief);
app.post('/api/content-plan/brief/update', contentPlanRoute.briefUpdate);
app.post('/api/content-plan/week', contentPlanRoute.week);
app.post('/api/content-plan', contentPlanRoute.save);
app.post('/api/handoffs', ledgerRoute.addHandoff);
app.get('/api/summary/spend', ledgerRoute.spendSummary);
app.get('/api/summary/cooking', ledgerRoute.cookingSummary);
app.post('/api/ledger/delete-range', ledgerRoute.deleteRange);
app.post('/api/borrowed', ledgerRoute.saveBorrowed);
app.post('/api/bank', ledgerRoute.saveBank);
const swapLib = require('./lib/ingredientSwap');
const swapDeps = () => {
  const cookLog = require('./lib/cookLog'); const sheets = require('./lib/sheets'); const live = require('./lib/liveData');
  return { readRows: () => cookLog.readShorthandRows(), loadCatalogue: live.loadCatalogue, saveSwap: async (row) => { await cookLog.readShorthandRows(); await sheets.appendRows(cookLog.SHORTHAND, [row], { raw: true }); }, deleteSwaps: (pred) => sheets.deleteRowsWhere(cookLog.SHORTHAND, pred) };
};
app.get('/api/ingredient-swaps', async (req, res) => { try { res.json({ swaps: swapLib.listSwaps(await swapDeps().readRows()) }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/ingredient-swaps', async (req, res) => { try { res.json(await swapLib.addSwap(req.body || {}, swapDeps())); } catch (err) { res.status(/must look|Say which|already the same/.test(String(err.message)) ? 400 : 500).json({ error: err.message }); } });
app.post('/api/ingredient-swaps/delete', async (req, res) => { try { res.json(await swapLib.removeSwap(req.body || {}, swapDeps())); } catch (err) { res.status(500).json({ error: err.message }); } });
const botAdmin = require('./lib/botAdmin');
app.get('/api/index/state', async (req, res) => { try { res.json(await botAdmin.loadState()); } catch (err) { res.status(502).json({ error: err.message }); } });
// A dish was renamed in Menu and prices and Lily typed the shorthand she will use. The order app learns it (and checks it is not
// taken), and for a cooked batch dish BOH's own Shorthand tab learns it too, so the stock box and cook notes understand it.
app.post('/api/index/aliases/add', async (req, res) => {
  try {
    const b = req.body || {};
    const { batchDishOf } = require('./lib/dishes');
    const tab = batchDishOf(b.oldName) || batchDishOf(b.name);
    const word = String(b.word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (tab) {
      const cookLog = require('./lib/cookLog'); const sheets = require('./lib/sheets'); const aliases = require('./lib/aliases');
      const rows = await cookLog.readShorthandRows();
      const sh = aliases.applyShorthandRows(aliases.defaultShorthand(), rows);
      const taken = sh.dishes.get(word);
      if (taken && taken !== tab) return res.status(400).json({ error: `"${word}" already means ${taken}. Pick a different shorthand.` });
      const out = await botAdmin.act('aliases/add', { id: b.id, word });
      if (!taken) await sheets.appendRows(cookLog.SHORTHAND, [['Dish', word, tab]], { raw: true });
      return res.json({ ...out, boh: true });
    }
    res.json(await botAdmin.act('aliases/add', { id: b.id, word }));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
app.post(/^\/api\/index\/(.+)$/, async (req, res) => { try { res.json(await botAdmin.act(req.params[0], req.body)); } catch (err) { res.status(err.status || 500).json({ error: err.message }); } });
app.post('/api/ledger/manual-orders', ledgerRoute.manualOrders);
app.post('/api/ledger/row/delete', ledgerRoute.deleteRow);
app.post('/api/ledger/row/update', ledgerRoute.updateRow);
const recipeStore = require('./lib/recipeStore');
const menuBible = require('./lib/menuBible');
const bibleSeed = () => require('./data/menuBible.json');
app.get('/api/menu-bible', async (req, res) => { try { res.json(await menuBible.load(bibleSeed())); } catch (err) { res.json({ ...menuBible.merge(bibleSeed()), warning: `Showing the starting set, the edits could not be read (${err.message}).` }); } });
app.post('/api/menu-bible/save', async (req, res) => { try { res.json(await menuBible.save(bibleSeed(), req.body || {})); } catch (err) { res.status(/needs a name|already an item/.test(String(err.message)) ? 400 : 500).json({ error: err.message }); } });
app.post('/api/menu-bible/delete', async (req, res) => { try { res.json(await menuBible.remove(bibleSeed(), req.body || {})); } catch (err) { res.status(/Say which/.test(String(err.message)) ? 400 : 500).json({ error: err.message }); } });
app.get('/api/recipes', async (req, res) => { try { res.json(await recipeStore.load(require('./data/recipes.json'))); } catch (err) { res.json({ ...recipeStore.merge(require('./data/recipes.json'), []), warning: `Edits could not be loaded (${err.message}). Showing the starting recipes.` }); } });
app.post('/api/recipes/save', async (req, res) => { try { res.json(await recipeStore.save(require('./data/recipes.json'), req.body || {})); } catch (err) { res.status(/empty|needs a name/.test(String(err.message)) ? 400 : 500).json({ error: err.message }); } });
app.post('/api/recipes/sync-doc', async (req, res) => { try { res.json(await require('./lib/recipeDoc').syncFromDoc()); } catch (err) { console.error('Recipe sync failed:', err.message); res.status(err.status || 500).json({ error: err.message }); } });
// Pasta cost cards: cost per cooked to order pasta portion, priced live from the price book.
const pastaCosts = require('./lib/pastaCosts');
async function pastaView() {
  const cards = await pastaCosts.loadCards(require('./data/pastaSeed.json'));
  const pb = await require('./lib/liveData').loadPriceBook();
  const today = require('./lib/dates').bangkokToday();
  return { today: today.toISOString().slice(0, 10), cards: cards.map((c) => ({ ...c, cost: pastaCosts.costCard(c.card, pb, today) })) };
}
app.get('/api/pasta', async (req, res) => { try { res.json(await pastaView()); } catch (err) { res.status(500).json({ error: `Could not load the pasta costs: ${err.message}` }); } });
app.post('/api/pasta/save', async (req, res) => {
  try {
    await pastaCosts.save(require('./data/pastaSeed.json'), req.body || {});
    // A brand new pasta also gets its recipe page, so it shows in the Recipes list.
    const name = String((req.body || {}).name || '').replace(/^pasta\s*-\s*/i, '').trim();
    try {
      const doc = await recipeStore.load(require('./data/recipes.json'));
      if (!doc.dishes.some((d) => pastaCosts.key(d.dish) === pastaCosts.key(name) && /^pasta\s*-/i.test(d.dish))) {
        await recipeStore.save(require('./data/recipes.json'), { dish: `Pasta - ${name}`, category: 'Noodles', title: `Pasta - ${name}`, text: '**I. How we sell it**\n* Cooked to order. Costs are on this page.' });
      }
    } catch (err) { /* the cost card is saved either way */ }
    res.json(await pastaView());
  } catch (err) { res.status(/must be|needs a name/.test(String(err.message)) ? 400 : 500).json({ error: err.message }); }
});
// The Audit desk: stored result of the nightly check, run now, and ignore.
const audit = require('./lib/audit');
const itemCosts = require('./lib/itemCosts');
app.post('/api/audit/split', async (req, res) => {
  try {
    const out = await require('./lib/ledgerService').splitOrderRows((req.body || {}).keys, (req.body || {}).text);
    res.json({ ...out, audit: await audit.run() });
  } catch (err) { res.status(/I don't know|Type the items|add up to|more than one dish|no longer in the Ledger/.test(String(err.message)) ? 400 : 500).json({ error: err.message }); }
});
app.post('/api/audit/customer', async (req, res) => {
  try {
    const out = await require('./lib/ledgerService').setOrderCustomer((req.body || {}).keys, (req.body || {}).name);
    res.json({ ...out, audit: await audit.run() });
  } catch (err) { res.status(/Type the|no longer in the Ledger/.test(String(err.message)) ? 400 : 500).json({ error: err.message }); }
});
app.post('/api/item-cost/save', async (req, res) => {
  try { const out = await itemCosts.save((req.body || {}).name, (req.body || {}).cost); res.json({ ...out, audit: await audit.run() }); }
  catch (err) { res.status(/must be|Which item|could not be read/.test(String(err.message)) ? 400 : 500).json({ error: err.message }); }
});
app.post('/api/audit/gap', async (req, res) => { try { const b = req.body || {}; const message = await require('./lib/stockGaps').closeGap(b.at, b.item, b.reason); res.json({ message, audit: await audit.run() }); } catch (err) { res.status(400).json({ error: err.message }); } });
app.post('/api/audit/drinkmap', async (req, res) => { try { const b = req.body || {}; await require('./lib/drinkSales').saveLink(b.sale, b.stock); res.json({ audit: await audit.run() }); } catch (err) { res.status(400).json({ error: err.message }); } });
app.post('/api/audit/noorders', async (req, res) => { try { const b = req.body || {}; await audit.noOrders(b.channel, b.days, { reason: b.reason }); res.json({ audit: await audit.run() }); } catch (err) { res.status(400).json({ error: err.message }); } });
app.get('/api/audit', async (req, res) => { try { res.json(await audit.view()); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/audit/run', async (req, res) => { try { res.json(await audit.run()); } catch (err) { res.status(500).json({ error: `The check could not run: ${err.message}` }); } });
app.post('/api/audit/ignore', async (req, res) => { try { res.json(await audit.ignore((req.body || {}).id)); } catch (err) { res.status(400).json({ error: err.message }); } });
const attention = require('./lib/needsAttention');
app.get('/api/attention', async (req, res) => { try { res.json({ items: await attention.loadAttention() }); } catch (err) { res.status(500).json({ error: `Could not check: ${err.message}` }); } });
app.post('/api/attention/ignore', async (req, res) => { try { await attention.ignoreItem((req.body || {}).name); res.json({ ok: true }); } catch (err) { res.status(400).json({ error: err.message }); } });
app.post('/api/attention/add-stock', async (req, res) => { try { await attention.addToStock(req.body || {}); res.json({ ok: true }); } catch (err) { res.status(/Needs/.test(err.message) ? 400 : 500).json({ error: err.message }); } });
app.get('/api/stock-left', require('./routes/stockLeft').stockLeftJson);
app.post('/api/stock-left/set', require('./routes/stockLeft').stockLeftSet);
app.post('/api/huddle/run', ledgerRoute.runHuddle);

// Back of house LINE group (own LINE channel, separate from the customer bot)
app.post('/webhook/line', lineRoute.webhook);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Merlin's Dish back-office app running on port ${PORT}`);
  startHuddleTimer(ledgerRoute.sendHuddle, { store: { get: appState.getState, set: appState.setState } });
  startDriveImportTimer(ledgerRoute.sendDriveImport);
  const cloudInbox = require('./lib/cloudInbox');
  cloudInbox.setup().catch((err) => console.error('cloud inbox tab', err.message));
  startCloudInboxTimer(() => cloudInbox.run());
  startWeeklyExportTimer(logsRoute.sendWeeklyExport, { store: { get: appState.getState, set: appState.setState } });
  startMonthlyOverheadsTimer(monthlyRoute.runMonthly);
  startTodoReminderTimer(briefingRoute.sendReminder, { store: { get: appState.getState, set: appState.setState } });
  startIndexExpiryTimer(() => botAdmin.expireStale());
  startAuditTimer(() => audit.run(), async (v) => {
    const to = process.env.BOH_GROUP_ID; const access = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (to && access) await require('./lib/lineApi').push(to, audit.sundayLine(v), access);
  }, { store: { get: appState.getState, set: appState.setState } });
  require('./lib/bagDeduct').migratePieceCards().catch((err) => console.error('piece card migration', err.message));
  startStockSnapshotTimer(require('./routes/stockLeft').runSnapshot, { store: { get: appState.getState, set: appState.setState } });
});
