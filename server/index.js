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
const { startHuddleTimer, startDriveImportTimer, startWeeklyExportTimer, startStockSnapshotTimer } = require('./lib/scheduler');
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
// Photo reading is off unless RECEIPT_PHOTOS=on (it needs an Anthropic key and credit).
if (String(process.env.RECEIPT_PHOTOS || '').toLowerCase() === 'on') {
  app.post('/api/receipts/batch', upload.array('receipts', 60), receiptsRoute.handleBatch);
}

// Monthly logs with CSV downloads, and the ready to eat stock box
app.get('/api/receipts/log', logsRoute.receiptsJson);
app.get('/api/receipts/log.csv', logsRoute.receiptsCsv);
app.get('/api/cook/log', logsRoute.cookJson);
app.get('/api/cook/log.csv', logsRoute.cookCsv);
app.post('/api/export/weekly', logsRoute.weeklyExportRoute);
app.get('/api/shopping/plan', shoppingRoute.planJson);
app.post('/api/shopping/retire', shoppingRoute.retire);
app.post('/api/shopping/link', shoppingRoute.linkStockItem);
app.get('/api/analysis', analysisRoute.analysisJson);
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
app.post('/api/cook/note', cookRoute.note);

// Mode 4: Stock Counts
app.get('/api/stock', stockCountsRoute.listStock);
app.get('/api/stock/ingredients', stockCountsRoute.listIngredientStock);
app.post('/api/stock/update', stockCountsRoute.updateStock);
app.post('/api/stock/edit', stockCountsRoute.editStockRoute);
app.post('/api/stock/ingredient-category', stockCountsRoute.setIngredientCategory);
app.post('/api/stock/ingredient-brand', stockCountsRoute.setIngredientBrand);
app.post('/api/stock/item-meta', stockCountsRoute.setItemMeta);
app.post('/api/stock/bags', stockCountsRoute.saveBags);
app.post('/api/stock/bags/suggest', stockCountsRoute.suggestBags);
app.post('/api/stock/category', stockCountsRoute.addCategoryRoute);
app.post('/api/stock/seed-meat', stockCountsRoute.seedMeat);
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
const pitLayout = require('./lib/pitLayout');
app.get('/api/pit/layout', async (req, res) => { try { res.json(await pitLayout.load()); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/pit/layout', async (req, res) => { try { res.json(await pitLayout.save(req.body)); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/marketing', ledgerRoute.marketing);
app.post('/api/marketing/note', ledgerRoute.addMarketingNote);
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
app.post(/^\/api\/index\/(.+)$/, async (req, res) => { try { res.json(await botAdmin.act(req.params[0], req.body)); } catch (err) { res.status(err.status || 500).json({ error: err.message }); } });
app.post('/api/ledger/manual-orders', ledgerRoute.manualOrders);
app.post('/api/ledger/row/delete', ledgerRoute.deleteRow);
app.post('/api/ledger/row/update', ledgerRoute.updateRow);
const recipeStore = require('./lib/recipeStore');
const menuBible = require('./lib/menuBible');
const bibleSeed = () => require('./data/menuBible.json');
app.get('/api/menu-bible', async (req, res) => { try { res.json(await menuBible.load(bibleSeed())); } catch (err) { res.json({ ...menuBible.merge(bibleSeed()), warning: `Showing the starting set, the edits could not be read (${err.message}).` }); } });
app.post('/api/menu-bible/save', async (req, res) => { try { res.json(await menuBible.save(bibleSeed(), req.body || {})); } catch (err) { res.status(/needs a name/.test(String(err.message)) ? 400 : 500).json({ error: err.message }); } });
app.post('/api/menu-bible/delete', async (req, res) => { try { res.json(await menuBible.remove(bibleSeed(), req.body || {})); } catch (err) { res.status(/Say which/.test(String(err.message)) ? 400 : 500).json({ error: err.message }); } });
app.get('/api/recipes', async (req, res) => { try { res.json(await recipeStore.load(require('./data/recipes.json'))); } catch (err) { res.json({ ...recipeStore.merge(require('./data/recipes.json'), []), warning: `Edits could not be loaded (${err.message}). Showing the starting recipes.` }); } });
app.post('/api/recipes/save', async (req, res) => { try { res.json(await recipeStore.save(require('./data/recipes.json'), req.body || {})); } catch (err) { res.status(/empty|needs a name/.test(String(err.message)) ? 400 : 500).json({ error: err.message }); } });
app.get('/api/stock-left', require('./routes/stockLeft').stockLeftJson);
app.post('/api/huddle/run', ledgerRoute.runHuddle);

// Back of house LINE group (own LINE channel, separate from the customer bot)
app.post('/webhook/line', lineRoute.webhook);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Merlin's Dish back-office app running on port ${PORT}`);
  startHuddleTimer(ledgerRoute.sendHuddle, { store: { get: appState.getState, set: appState.setState } });
  startDriveImportTimer(ledgerRoute.sendDriveImport);
  startWeeklyExportTimer(logsRoute.sendWeeklyExport, { store: { get: appState.getState, set: appState.setState } });
  startStockSnapshotTimer(require('./routes/stockLeft').runSnapshot, { store: { get: appState.getState, set: appState.setState } });
});
