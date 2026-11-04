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

test('where you shopped: a shop line applies until the next shop or date line', async () => {
  const text = '5/10\nat Makro\nminced pork 5kg, 610\ncelery 2kg, 138\nshop Tops\npelati, 2550g, 275\n6/10 at Villa\nonion 2kg, 90';
  const r = parseTypedReceipt(text, TODAY);
  assert.strictEqual(r.problems.length, 0);
  assert.deepStrictEqual(r.items.map((i) => [i.typedName, i.shop]), [['minced pork', 'Makro'], ['celery', 'Makro'], ['pelati', 'Tops'], ['onion', 'Villa']]);

  const rows = [];
  const replies = await processTypedReceipt('5/10\nat Makro\nminced pork 5kg, 610', TODAY, { loadCatalogue: async () => CATALOGUE, appendExpenseRows: async (x) => rows.push(...x) });
  assert.strictEqual(rows[0][5], 'Makro');
  assert.match(replies[0], /05\/10\/2026, Makro/);

  const noShop = parseTypedReceipt('5/10\natlantic salmon 1kg, 500', TODAY);
  assert.strictEqual(noShop.items[0].shop, '');
  assert.strictEqual(noShop.items[0].typedName, 'atlantic salmon');
});

test('kilo weights typed with a g: 0.478g is 478g, "0.60g 2pcs" is 0.6kg each, and the guess is said out loud', async () => {
  const r = parseTypedReceipt('9/10\nbroccoli 0.478g, 28.25\npecorino 0.60g 2pcs, 180\nknorr cube - beef 20g 48pcs, 280\nonion 450g, 20', TODAY);
  assert.deepStrictEqual(r.items.map((i) => i.purchaseUnit), ['0.478kg', '1200g', '960g', '450g']);
  assert.match(r.items[0].assumed, /478g/);
  assert.match(r.items[2].assumed, /20g x 48/);   // the caller turns this back into 48 pieces for items counted in pieces
  assert.strictEqual(r.items[3].assumed, '');
});

test('a doubled letter does not stop a name matching (peccorino finds Pecorino)', () => {
  assert.strictEqual(matchIngredient('peccorino', ['Pecorino', 'Onion']).name, 'Pecorino');
});

test('spelling slips are caught and said out loud, but short or different words are not guessed', async () => {
  const cat = ['Pecorino', 'Pork - minced', 'Onion', 'Parmesan', 'Milk'];
  assert.deepStrictEqual(matchIngredient('pecroino', cat), { name: 'Pecorino', fuzzy: true });    // swapped letters
  assert.deepStrictEqual(matchIngredient('pecorinno', cat), { name: 'Pecorino' });                 // doubled letters are ignored
  assert.deepStrictEqual(matchIngredient('parmasan', cat), { name: 'Parmesan', fuzzy: true });    // wrong vowel
  assert.deepStrictEqual(matchIngredient('minsed pork', cat), { name: 'Pork - minced', fuzzy: true });
  assert.deepStrictEqual(matchIngredient('mik', cat), {});                                         // too short to guess
  assert.deepStrictEqual(matchIngredient('salmon', cat), {});
  const rows = [];
  const replies = await processTypedReceipt('5/10\npecroino 500g, 90', TODAY, { loadCatalogue: async () => cat, appendExpenseRows: async (x) => rows.push(...x) });
  assert.strictEqual(rows[0][1], 'Pecorino');
  assert.ok(replies.some((r) => /corrected the spelling/.test(r) && /pecroino → Pecorino/.test(r)));
});

test('best prices: the cheapest per unit ever paid, written like the Price Tracker remark', () => {
  const { buildPriceBook } = require('../lib/priceBook');
  const { bestRows, remark } = require('../lib/bestPrices');
  const pb = buildPriceBook({
    today: TODAY,
    priceLogRows: [['Shopping Date', 'Ingredient', 'Purchase Price', 'Purchase Unit', 'Cost per Recipe Unit', 'Shopped at', 'Remarks'], ['05/09/2026', 'Anchovies', 1038, '680g', 1.526, '', '']],
    expenseRows: [['Date', 'Ingredient', 'Price', 'Unit', 'Cost', 'Shop', 'Remark'], ['09/10/2026', 'Pecorino', 105.25, '0.90kg', 0.11694, 'Makro', ''], ['12/10/2026', 'Pecorino', 150, '1000g', 0.15, 'Tops', ''], ['13/10/2026', 'Pecorino', 0, '500g', 0, '', 'free']],
  });
  const rows = bestRows(pb);
  const pec = rows.find((r) => r[0] === 'Pecorino');
  assert.strictEqual(pec[1], 'best price: 105.25/900g');
  assert.strictEqual(pec[4], 'Makro');
  assert.strictEqual(pec[5], 0.15);                   // the free line is ignored, the latest paid price is 150/1000g
  assert.strictEqual(rows.find((r) => r[0] === 'Anchovies')[1], 'best price: 1,038/680g');
  assert.strictEqual(remark({ price: 26, unitText: '1can', cost: 26 }), 'best price: 26/1can');
});

test('a kilo guess far from the last price is read as the dropped zero (0.90g is 90g, not 900g)', async () => {
  const { buildPriceBook } = require('../lib/priceBook');
  const pb = buildPriceBook({ today: TODAY, priceLogRows: [['Date', 'Ingredient', 'Price', 'Unit', 'Cost', 'Shop', 'Remark'], ['01/10/2026', 'Pecorino', 117, '100g', 1.17, '', '']] });
  const rows = [];
  const replies = await processTypedReceipt('9/10\npecorino 0.90g, 105.25\npecorino 0.108g, 126.25\npecorino 0.60g 2pcs, 180\nbroccoli 0.478g, 28.25', TODAY, {
    loadCatalogue: async () => ['Pecorino', 'Broccoli'], loadPriceBook: async () => pb, appendExpenseRows: async (x) => rows.push(...x),
  });
  assert.deepStrictEqual(rows.map((r) => r[3]), ['90g', '0.108kg', '120g', '0.478kg']);   // 0.108kg (108g) already fits the last price, so it stays
  assert.ok(replies.some((r) => /guess on the weights/.test(r) && /would be/.test(r)));
});

test('overhead lines go to the Overheads tab only, and ingredient lines in the same message still work', async () => {
  const oh = []; const expense = [];
  const deps = { loadCatalogue: async () => ['Onion'], appendExpenseRows: async (x) => expense.push(...x), appendOverheads: async (x) => oh.push(...x) };
  const out = await processTypedReceipt('13/10\nat paragon\noverhead equipment\npot 7lt, 2575thb\nknife 8 inch 450 baht\ningredients\nonion 2kg, 90\n14/10\noverhead\npaper bag 100pcs, 120', TODAY, deps);
  assert.deepStrictEqual(oh.map((r) => [r[0], r[1], r[2], r[3], r[4]]), [
    ['13/10/2026', 'pot 7lt', 'equipment', 2575, 'paragon'],
    ['13/10/2026', 'knife 8 inch', 'equipment', 450, 'paragon'],
    ['14/10/2026', 'paper bag 100pcs', '', 120, ''],
  ]);
  assert.deepStrictEqual(expense.map((r) => r[1]), ['Onion']);                 // only the ingredient reached the Expense Log
  assert.ok(out.some((r) => /Overheads logged: 3 items, ฿3,145.00/.test(r)));
});

test('overhead-only message and unreadable overhead lines', async () => {
  const oh = [];
  const deps = { loadCatalogue: async () => [], appendExpenseRows: async () => { throw new Error('should not be called'); }, appendOverheads: async (x) => oh.push(...x) };
  const out = await processTypedReceipt('13/10\noverhead\npot 7lt, 2575thb\nsomething with no price', TODAY, deps);
  assert.strictEqual(oh.length, 1);
  assert.ok(out.some((r) => /Couldn't use these lines/.test(r) && /something with no price/.test(r)));
});

test('reports keep overheads apart from ingredient purchases and take them off the margin', () => {
  const { summarise } = require('../lib/reports');
  const { utc } = require('../lib/dates');
  const d = utc(2026, 10, 13);
  const w = summarise([], [], [{ date: d, name: 'Onion', amount: 90 }, { date: d, name: 'pot', amount: 2575, kind: 'overhead' }], 'week')[0];
  assert.strictEqual(w.purchases, 90);
  assert.strictEqual(w.overheads, 2575);
  assert.strictEqual(w.marginBeforeOverheads, 0);
  assert.strictEqual(w.margin, -2575);          // the cash spent on overheads comes off that week's margin
});

test('her receipt style: prices only per block, "16thb ea" is per can, weight x count unless counted in pieces', async () => {
  const { buildPriceBook } = require('../lib/priceBook');
  const pb = buildPriceBook({ today: TODAY, priceLogRows: [['Date', 'Ing', 'P', 'U', 'C', 'S', 'R'], ['05/07/2026', 'Knorr cube - beef', 96, '48pcs', 2, '', ''], ['01/10/2026', 'Pecorino', 117, '100g', 1.17, '', '']] });
  const rows = []; const lots = [];
  const msg = '9/10\nat Makro\nprices only\nknorr cube - beef 20g 48pcs, 280\npeccorino 60g 2pcs, 180\n\n13/10\nat paragon\nmilk 5ltr, 225.5\neden zero 2 cans, 16thb ea';
  await processTypedReceipt(msg, TODAY, {
    loadCatalogue: async () => ['Knorr cube - beef', 'Pecorino', 'Milk', 'Eden Zero'], loadPriceBook: async () => pb,
    appendExpenseRows: async (x) => rows.push(...x), addLots: async (x) => lots.push(...x), loadUntracked: async () => [],
  });
  assert.deepStrictEqual(rows.map((r) => [r[1], r[2], r[3]]), [['Knorr cube - beef', 280, '48pcs'], ['Pecorino', 180, '120g'], ['Milk', 225.5, '5ltr'], ['Eden Zero', 32, '2cans']]);
  assert.deepStrictEqual(lots.map((l) => l.name), ['Milk', 'Eden Zero']);       // the Makro block was prices only, the 13/10 block was not
  assert.strictEqual(matchIngredient('eden ziero', ['Eden Zero', 'Milk']).name, 'Eden Zero');
});

test('brand in brackets: matches the ingredient, is kept in Remarks, and shows on the best price', async () => {
  const { buildPriceBook } = require('../lib/priceBook');
  const { bestRows } = require('../lib/bestPrices');
  const rows = [];
  const replies = await processTypedReceipt('17/10\nat foodland\nprices only\ntomato paste (Mica) 560g, 12pcs, 816thb', TODAY, {
    loadCatalogue: async () => ['Tomato Paste'], appendExpenseRows: async (x) => rows.push(...x),
  });
  assert.deepStrictEqual([rows[0][1], rows[0][3], rows[0][5]], ['Tomato Paste', '6720g', 'foodland']);
  assert.match(rows[0][6], /Brand: Mica/);
  assert.ok(replies[0].includes('Tomato Paste (Mica) 6720g'));
  const pb = buildPriceBook({ today: TODAY, expenseRows: [['Date', 'Ing', 'P', 'U', 'C', 'S', 'R'], rows[0]] });
  assert.strictEqual(bestRows(pb)[0][1], 'best price: 816/6720g, Mica');
});
