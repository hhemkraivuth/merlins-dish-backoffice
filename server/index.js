require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');

const ordersRoute = require('./routes/orders');
const receiptsRoute = require('./routes/receipts');
const batchCookRoute = require('./routes/batchCook');
const stockCountsRoute = require('./routes/stockCounts');
const lineRoute = require('./routes/line');

const app = express();
const PORT = process.env.PORT || 3001;

const upload = multer({ storage: multer.memoryStorage() });

// rawBody is kept so the LINE webhook can verify LINE's signature
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mode 1: Daily Orders (Grab screenshots)
app.post('/api/orders/batch', upload.array('screenshots', 60), ordersRoute.handleBatch);

// Mode 2: Weekly Receipts
app.post('/api/receipts/batch', upload.array('receipts', 60), receiptsRoute.handleBatch);

// Mode 3: Batch Cook
app.get('/api/batch-cook/dishes', batchCookRoute.listDishes);
app.get('/api/batch-cook/template/:dish', batchCookRoute.getTemplate);
app.get('/api/batch-cook/latest-prices', batchCookRoute.getLatestPrices);
app.post('/api/batch-cook/submit', batchCookRoute.submitBatch);

// Mode 4: Stock Counts
app.get('/api/stock', stockCountsRoute.listStock);
app.post('/api/stock/update', stockCountsRoute.updateStock);

// Back of house LINE group (own LINE channel, separate from the customer bot)
app.post('/webhook/line', lineRoute.webhook);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Merlin's Dish back-office app running on port ${PORT}`);
});
