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
const { startHuddleTimer } = require('./lib/scheduler');

const app = express();
const PORT = process.env.PORT || 3001;

const upload = multer({ storage: multer.memoryStorage() });

// rawBody is kept so the LINE webhook can verify LINE's signature
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mode 1: Daily Orders (Grab screenshots)
app.post('/api/orders/batch', upload.array('screenshots', 60), ordersRoute.handleBatch);

// Mode 2: Weekly Receipts
app.post('/api/receipts/typed', receiptsRoute.handleTyped);
// Photo reading is off unless RECEIPT_PHOTOS=on (it needs an Anthropic key and credit).
if (String(process.env.RECEIPT_PHOTOS || '').toLowerCase() === 'on') {
  app.post('/api/receipts/batch', upload.array('receipts', 60), receiptsRoute.handleBatch);
}

// Mode 3: Batch Cook
app.get('/api/batch-cook/dishes', batchCookRoute.listDishes);
app.get('/api/batch-cook/template/:dish', batchCookRoute.getTemplate);
app.get('/api/batch-cook/latest-prices', batchCookRoute.getLatestPrices);
app.post('/api/batch-cook/submit', batchCookRoute.submitBatch);

// Editable Batch Cook (prefilled from the recipe, same costing as the LINE group)
app.get('/api/cook/dishes', cookRoute.dishes);
app.get('/api/cook/recipe', cookRoute.recipe);
app.post('/api/cook/submit', cookRoute.submit);
app.post('/api/cook/note', cookRoute.note);

// Mode 4: Stock Counts
app.get('/api/stock', stockCountsRoute.listStock);
app.get('/api/stock/ingredients', stockCountsRoute.listIngredientStock);
app.post('/api/stock/update', stockCountsRoute.updateStock);
app.post('/api/stock/seed-packaging', stockCountsRoute.seedPackagingRoute);

// Team numbers: Ledger (Grab CSV + LINE orders), weekly and monthly reports, daily huddle
app.post('/api/ledger/grab-csv', upload.single('csv'), ledgerRoute.importGrab);
app.post('/api/ledger/sync-line', ledgerRoute.syncLine);
app.post('/api/reports/refresh', ledgerRoute.refresh);
app.get('/api/reports/summary', ledgerRoute.summary);
app.get('/api/reports/day', ledgerRoute.day);
app.post('/api/ledger/delete-range', ledgerRoute.deleteRange);
app.post('/api/ledger/row/delete', ledgerRoute.deleteRow);
app.post('/api/ledger/row/update', ledgerRoute.updateRow);
app.post('/api/huddle/run', ledgerRoute.runHuddle);

// Back of house LINE group (own LINE channel, separate from the customer bot)
app.post('/webhook/line', lineRoute.webhook);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Merlin's Dish back-office app running on port ${PORT}`);
  startHuddleTimer(ledgerRoute.sendHuddle);
});
