const test = require('node:test');
const assert = require('node:assert');
const { parseTypedReceipt, looksLikeTypedReceipt, matchIngredient } = require('../lib/typedReceipt');
const { processTypedReceipt, processNote } = require('../lib/cookService');
const { buildPriceBook } = require('../lib/priceBook');
const { defaultShorthand } = require('../lib/aliases');
const { parseDishTab } = require('../lib/sheetRecipe');
const { utc } = require('../lib/dates');
const { bologneseRows, priceLog } = require('./fixtures');

const TODAY = utc(2026, 10, 19);
const CATALOGUE = ['Pork - minced', 'Onion', 'Polpa', 'Tomato Paste'];

test('the example receipt is read', () => {
  const r = parseTypedReceipt('18/10\nminced pork 1000g 110thb', TODAY);
  assert.strictEqual(r.problems.length, 0);
  assert.strictEqual(r.items.length, 1);
  assert.deepStrictEqual(
    [r.items[0].typedName, r.items[0].purchaseUnit, r.items[0].price, r.items[0].costPerUnit],
    ['minced pork', '1000g', 110, 0.11],
  );
  assert.strictEqual(r.items[0].date.toISOString().slice(0, 10), '2026-10-18');
});

test('several dates, kg, baht word, ฿ prefix, date and item on one line', () => {
  const r = parseTypedReceipt('17/10\nonion 2kg 90 baht\n18/10 polpa 1600g ฿208\ntomato paste 160g 48.5thb', TODAY);
  assert.strictEqual(r.problems.length, 0);
  assert.deepStrictEqual(r.items.map((i) => [i.typedName, i.date.toISOString().slice(0, 10), i.price, i.costPerUnit]), [
    ['onion', '2026-10-17', 90, 0.045],
    ['polpa', '2026-10-18', 208, 0.13],
    ['tomato paste', '2026-10-18', 48.5, 0.30312],
  ]);
});

test('cook notes, stock commands and chat are not receipts', () => {
  assert.ok(!looksLikeTypedReceipt('7/10\nBolo\nMeat 1000\nO 446\nyield 21'));
  assert.ok(!looksLikeTypedReceipt('stock coke zero zero 5'));
  assert.ok(!looksLikeTypedReceipt('what time is dinner?'));
  assert.ok(looksLikeTypedReceipt('18/10\nminced pork 1000g 110thb'));
});

test('typed names map to the Price Tracker name regardless of word order', () => {
  assert.strictEqual(matchIngredient('minced pork', CATALOGUE).name, 'Pork - minced');
  assert.strictEqual(matchIngredient('Mutti polpa', CATALOGUE).name, 'Polpa');
  assert.strictEqual(matchIngredient('dragonfruit', CATALOGUE).name, undefined);
  assert.ok(matchIngredient('pork', ['Pork - minced', 'Pork - belly']).ambiguous);
});

test('rows are appended with the typed date and a dated lookup', async () => {
  const rows = [];
  const replies = await processTypedReceipt('18/10\nminced pork 1000g 110thb\nmystery sauce 1pc 70thb', TODAY, {
    loadCatalogue: async () => CATALOGUE,
    appendExpenseRows: async (r) => rows.push(...r),
  });
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0].slice(0, 5), ['18/10/2026', 'Pork - minced', 110, '1000g', 0.11]);
  assert.match(rows[1][6], /not matched/);
  assert.match(replies[0], /Logged to the Expense Log: 2 items, ฿180\.00/);
  assert.match(replies[1], /mystery sauce/);
});

test('no date line uses the day sent and says so', async () => {
  const rows = [];
  const replies = await processTypedReceipt('minced pork 1000g 110thb', TODAY, { loadCatalogue: async () => CATALOGUE, appendExpenseRows: async (r) => rows.push(...r) });
  assert.strictEqual(rows[0][0], '19/10/2026');
  assert.ok(replies.some((r) => /used the day you sent it/.test(r)));
});

test('non receipt text returns null and writes nothing', async () => {
  const rows = [];
  const out = await processTypedReceipt('7/10\nbolo\nmeat 1000\nyield 21', TODAY, { loadCatalogue: async () => CATALOGUE, appendExpenseRows: async (r) => rows.push(...r) });
  assert.strictEqual(out, null);
  assert.strictEqual(rows.length, 0);
});

test('end to end: a batch cooked on or after the receipt date uses it, an earlier one does not', async () => {
  const rows = [];
  await processTypedReceipt('18/10\nminced pork 1000g 150thb', TODAY, { loadCatalogue: async () => CATALOGUE, appendExpenseRows: async (r) => rows.push(...r) });
  const header = ['Date', 'Ingredient', 'Purchase Price', 'Purchase Unit', 'Cost per Recipe Unit', 'Shopped at', 'Remarks'];
  const book = buildPriceBook({ priceLogRows: priceLog, expenseRows: [header, ...rows], today: TODAY });

  const pork = (d) => book.lookup('Pork - minced', d);
  assert.strictEqual(pork(utc(2026, 10, 18)).cost, 0.15);
  assert.strictEqual(pork(utc(2026, 10, 19)).source, 'Expense Log');
  assert.notStrictEqual(pork(utc(2026, 10, 7)).source, 'Expense Log');

  const logged = [];
  const deps = (date) => ({
    today: TODAY,
    loadShorthand: async () => defaultShorthand(),
    loadRecipe: async () => parseDishTab(bologneseRows),
    loadPriceBook: async () => book,
    isLogged: async () => false,
    batchKey: (t, d, y) => `${t}-${d.toISOString().slice(0, 10)}-${y}`,
    writeBatch: async (r) => logged.push(r),
  });
  await processNote('19/10\nbolo\nyield 21', deps());
  await processNote('7/10\nbolo\nyield 21', deps());
  assert.ok(logged[0].total > logged[1].total, 'the 19/10 batch uses the dearer new pork price');
});

test('LINE group: typed receipt is logged, a photo gets the typing hint and no vision call', async () => {
  const crypto = require('crypto');
  const { createHandler } = require('../routes/line');
  const SECRET = 's';
  const replies = [];
  const rows = [];
  let visionCalls = 0;
  const deps = {
    secret: SECRET, token: 't', groupId: 'G', receiptPhotos: false,
    reply: async (rt, t) => replies.push(t), push: async () => {}, getContent: async () => { visionCalls++; return { buffer: Buffer.from('x'), mime: 'image/jpeg' }; },
    note: {}, stock: { getAll: async () => [], setCount: async () => {} },
    receipt: { loadCatalogue: async () => CATALOGUE, appendExpenseRows: async (r) => rows.push(...r), extractReceipt: async () => { visionCalls++; return {}; } },
  };
  const handler = createHandler(() => deps);
  const send = async (id, message) => {
    const body = Buffer.from(JSON.stringify({ events: [{ type: 'message', webhookEventId: id, replyToken: 'rt', timestamp: Date.now(), source: { type: 'group', groupId: 'G' }, message }] }));
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
    await handler({ rawBody: body, body: JSON.parse(body), get: () => sig }, { sendStatus() {}, status() { return { json() {} }; } });
    await new Promise((r) => setTimeout(r, 30));
  };
  await send('typed-1', { type: 'text', id: '1', text: '18/10\nminced pork 1000g 110thb' });
  assert.strictEqual(rows.length, 1);
  assert.match(replies[0], /Logged to the Expense Log/);
  await send('photo-1', { type: 'image', id: '2' });
  assert.match(replies[1], /Receipt photos are switched off/);
  assert.strictEqual(visionCalls, 0);
});

const HER_RECEIPT = '5/10\ncelery 2kg, 138thb\nmushroom - white 1000g, 218thb\nminced pork 5kg, 610thb\ncampbells - mushroom 4 cans, 520thb\ncampbells - chicken mushroom, 2 cans, 142thb\npelati, 2550g, 275thb\nworcestershire sauce, 2bottles, 363thb';

test('commas around quantity and price, counted units, and the price without thb all read', () => {
  for (const text of [HER_RECEIPT, HER_RECEIPT.replace(/thb/g, '')]) {
    assert.ok(looksLikeTypedReceipt(text));
    const r = parseTypedReceipt(text, TODAY);
    assert.strictEqual(r.problems.length, 0);
    assert.deepStrictEqual(r.items.map((i) => [i.typedName, i.purchaseUnit, i.price]), [
      ['celery', '2kg', 138],
      ['mushroom - white', '1000g', 218],
      ['minced pork', '5kg', 610],
      ['campbells - mushroom', '4cans', 520],
      ['campbells - chicken mushroom', '2cans', 142],
      ['pelati', '2550g', 275],
      ['worcestershire sauce', '2bottles', 363],
    ]);
    assert.ok(r.items.every((i) => i.date.toISOString().slice(0, 10) === '2026-10-05'));
  }
});

test('a cook note with commas-free lines is still not a receipt', () => {
  assert.ok(!looksLikeTypedReceipt('5/10\nbolo\nmeat 1000\nO 446\nCl 234\nyield 21'));
});

test('cans and bottles are stored as pieces, apostrophes do not block a match', () => {
  const { parsePurchaseUnit } = require('../lib/priceBook');
  assert.deepStrictEqual(parsePurchaseUnit('4cans'), { qty: 4, unit: 'piece' });
  assert.deepStrictEqual(parsePurchaseUnit('2bottles'), { qty: 2, unit: 'piece' });
  assert.strictEqual(matchIngredient('campbells - mushroom', ["Campbell's - Mushroom", "Campbell's - Chicken Mushroom"]).name, "Campbell's - Mushroom");
  assert.strictEqual(matchIngredient('pelati', ['Mutti Pelati', 'Polpa']).name, 'Mutti Pelati');
});

test('her whole receipt is logged: 7 rows, per piece cost for cans', async () => {
  const rows = [];
  const replies = await processTypedReceipt(HER_RECEIPT, TODAY, {
    loadCatalogue: async () => ['Celery', 'Mushroom - white', 'Pork - minced', "Campbell's - Mushroom", "Campbell's - Chicken Mushroom", 'Pelati', 'Worcestershire sauce'],
    appendExpenseRows: async (r) => rows.push(...r),
  });
  assert.strictEqual(rows.length, 7);
  assert.deepStrictEqual(rows[3].slice(0, 5), ['05/10/2026', "Campbell's - Mushroom", 520, '4cans', 130]);
  assert.match(replies[0], /7 items, ฿2,266\.00/);
  assert.ok(!replies.some((r) => /Not matched/.test(r)));
});

test('a "prices only" line logs prices but adds no stock lots', async () => {
  const rows = []; const lots = [];
  const replies = await processTypedReceipt('5/10\nprices only\nminced pork 5kg, 610', TODAY, {
    loadCatalogue: async () => CATALOGUE, appendExpenseRows: async (r) => rows.push(...r),
    addLots: async (l) => lots.push(...l), loadUntracked: async () => [],
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(lots.length, 0);
  assert.ok(replies.some((r) => /Prices only/.test(r)));
  assert.ok(!replies.some((r) => /Couldn't use/.test(r)));
});
