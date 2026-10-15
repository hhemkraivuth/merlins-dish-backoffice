const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const express = require('express');
const { createHandler } = require('../routes/line');
const { verifySignature, chunk } = require('../lib/lineApi');
const { processNote, processReceipt } = require('../lib/cookService');
const { defaultShorthand } = require('../lib/aliases');
const { buildPriceBook } = require('../lib/priceBook');
const { parseDishTab } = require('../lib/sheetRecipe');
const { utc } = require('../lib/dates');
const { bologneseRows, priceLog } = require('./fixtures');

const TODAY = utc(2026, 10, 15);
const SECRET = 'test-secret';
const GROUP = 'Cgroup123';
const NOTE = '7/10\nBolo\nMeat 1000\nO 446\nG 60\nCl 234\nC 230\nyield 21';

function makeNoteDeps() {
  const logged = new Set();
  const written = [];
  const book = buildPriceBook({ priceLogRows: priceLog, today: TODAY });
  return {
    written,
    today: TODAY,
    loadShorthand: async () => defaultShorthand(),
    loadRecipe: async (tab) => { if (tab !== 'Polished Pork Bolognese') throw new Error('tab not found'); return parseDishTab(bologneseRows); },
    loadPriceBook: async () => book,
    isLogged: async (k) => logged.has(k),
    batchKey: (tab, d, y, lines) => `${tab}-${d.toISOString().slice(0, 10)}-${y}-${lines.length}`,
    writeBatch: async (r, k) => { logged.add(k); written.push({ r, k }); },
  };
}

test('signature check', () => {
  const body = Buffer.from('{"events":[]}');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  assert.ok(verifySignature(body, sig, SECRET));
  assert.ok(!verifySignature(body, sig, 'other'));
  assert.ok(!verifySignature(body, 'x', SECRET));
  assert.ok(!verifySignature(body, undefined, SECRET));
});

test('long replies are split under LINE limits', () => {
  const parts = chunk('x\n'.repeat(5000));
  assert.ok(parts.every((p) => p.length <= 4800));
});

test('note -> costed, logged once, duplicate refused', async () => {
  const deps = makeNoteDeps();
  const first = await processNote(NOTE, deps);
  assert.strictEqual(deps.written.length, 1);
  assert.match(first[0], /Polished Pork Bolognese, 07\/10\/2026, 21 serves/);
  assert.match(first[0], /฿614\.69, ฿29\.27 per portion, food cost 17\.7%/);
  assert.match(first[0], /Logged to the Cook Log/);
  const second = await processNote(NOTE, deps);
  assert.strictEqual(deps.written.length, 1);
  assert.match(second[0], /already in the Cook Log/);
});

test('missing yield is shown but NOT logged', async () => {
  const deps = makeNoteDeps();
  const r = await processNote('7/10\nbolo\nmeat 1000', deps);
  assert.strictEqual(deps.written.length, 0);
  assert.match(r[0], /NOT logged/);
});

test('chat in the group is ignored; a typo\'d dish gets a hint', async () => {
  const deps = makeNoteDeps();
  assert.strictEqual(await processNote('what time is dinner?', deps), null);
  assert.strictEqual(await processNote('ok see you 7/10', deps), null);
  const r = await processNote('7/10\nbolgnese\nmeat 1000', deps);
  assert.match(r[0], /couldn't tell which dish/);
  assert.strictEqual(deps.written.length, 0);
});

test('unreadable tab is reported, nothing logged', async () => {
  const deps = makeNoteDeps();
  const r = await processNote('7/10\nragu\nmeat 900\nyield 14', deps);
  assert.match(r[0], /Couldn't read the "Noir Ragu" tab/);
  assert.strictEqual(deps.written.length, 0);
});

test('receipt: names mapped, units normalised, rows appended', async () => {
  const rows = [];
  const out = await processReceipt(
    { buffer: Buffer.from('img'), mime: 'image/jpeg' },
    utc(2026, 10, 13),
    {
      loadCatalogue: async () => ['Pork - minced', 'Onion'],
      extractReceipt: async () => ({
        shopping_date: '13/10/2026', shopped_at: 'Makro', receipt_total: 330, uncertain_fields: [],
        line_items: [
          { item_name: 'MINCED PORK', ingredient: 'Pork - minced', purchase_price: 260, purchase_qty: 2, purchase_unit: 'kg' },
          { item_name: 'MYSTERY SAUCE', ingredient: null, purchase_price: 70, purchase_qty: 1, purchase_unit: 'piece' },
        ],
      }),
      appendExpenseRows: async (r) => rows.push(...r),
    },
  );
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0].slice(0, 5), ['13/10/2026', 'Pork - minced', 260, '2kg', 0.13]);
  assert.match(rows[1][6], /not matched/);
  assert.match(out, /2 items, ฿330\.00, Makro, 13\/10\/2026/);
  assert.match(out, /MYSTERY SAUCE/);
});

// ---- full HTTP path with a real signature ----
async function withServer(deps, fn) {
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.post('/webhook/line', createHandler(() => deps));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}/webhook/line`); } finally { server.close(); }
}
const signed = (obj) => {
  const body = JSON.stringify(obj);
  return { body, sig: crypto.createHmac('sha256', SECRET).update(body).digest('base64') };
};
const msg = (id, groupId, text) => ({ events: [{ type: 'message', webhookEventId: id, replyToken: 'rt', timestamp: Date.now(), source: { type: 'group', groupId }, message: { type: 'text', id: 'm1', text } }] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('webhook: bad signature rejected, right group answered, other groups and redeliveries ignored', async () => {
  const replies = [];
  const deps = {
    secret: SECRET, token: 'tok', groupId: GROUP,
    reply: async (rt, text) => replies.push(text), push: async () => {},
    note: makeNoteDeps(), receipt: {},
  };
  await withServer(deps, async (url) => {
    const bad = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': 'nope' }, body: JSON.stringify(msg('e0', GROUP, NOTE)) });
    assert.strictEqual(bad.status, 401);

    const p1 = signed(msg('e1', GROUP, NOTE));
    const ok = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': p1.sig }, body: p1.body });
    assert.strictEqual(ok.status, 200);
    await wait(100);
    assert.strictEqual(replies.length, 1);
    assert.match(replies[0], /฿29\.27 per portion/);

    const again = signed(msg('e1', GROUP, NOTE)); // LINE redelivery of the same event
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': again.sig }, body: again.body });
    const other = signed(msg('e2', 'Cother', NOTE)); // some other group
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': other.sig }, body: other.body });
    const help = signed(msg('e3', GROUP, 'help'));
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': help.sig }, body: help.body });
    await wait(100);
    assert.strictEqual(replies.length, 2); // only the help reply was added
    assert.match(replies[1], /Send a cook note like this/);
  });
});

test('webhook: before BOH_GROUP_ID is set, only "groupid" is answered', async () => {
  const replies = [];
  const deps = { secret: SECRET, token: 'tok', groupId: undefined, reply: async (rt, t) => replies.push(t), push: async () => {}, note: makeNoteDeps(), receipt: {} };
  await withServer(deps, async (url) => {
    for (const [id, text] of [['s1', NOTE], ['s2', 'groupid']]) {
      const p = signed(msg(id, 'CnewGroup', text));
      await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': p.sig }, body: p.body });
    }
    await wait(100);
    assert.strictEqual(replies.length, 1);
    assert.match(replies[0], /CnewGroup/);
  });
});

test('webhook: reply failure falls back to push', async () => {
  const pushed = [];
  const deps = { secret: SECRET, token: 'tok', groupId: GROUP, reply: async () => { throw new Error('token expired'); }, push: async (to, t) => pushed.push([to, t]), note: makeNoteDeps(), receipt: {} };
  await withServer(deps, async (url) => {
    const p = signed(msg('f1', GROUP, NOTE));
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': p.sig }, body: p.body });
    await wait(100);
    assert.strictEqual(pushed.length, 1);
    assert.strictEqual(pushed[0][0], GROUP);
  });
});

test('webhook: not configured -> 503', async () => {
  await withServer({ secret: undefined, token: undefined }, async (url) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.strictEqual(r.status, 503);
  });
});

test('webhook: a failure while processing a note is reported in the group, not swallowed', async () => {
  const replies = [];
  const note = makeNoteDeps();
  note.loadPriceBook = async () => { throw new Error('The caller does not have permission'); };
  const deps = { secret: SECRET, token: 'tok', groupId: GROUP, reply: async (rt, t) => replies.push(t), push: async () => {}, note, receipt: {} };
  await withServer(deps, async (url) => {
    const p = signed(msg('g1', GROUP, NOTE));
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': p.sig }, body: p.body });
    await wait(100);
    assert.strictEqual(replies.length, 1);
    assert.match(replies[0], /Nothing was changed/);
    assert.match(replies[0], /does not have permission/);
    assert.match(replies[0], /service account/);
  });
});

// ---- stock from LINE ----
const { processStock } = require('../lib/stockService');
function stockDeps() {
  const items = [
    { itemName: 'coke zero zero', unit: 'can', currentCount: 5, lastUpdated: '2026-10-15T15:26:02.325Z', lastUpdatedBy: 'Manual' },
    { itemName: 'Packaging Cup (12oz)', unit: 'Set', currentCount: 40, lastUpdated: '2026-10-10T03:00:00.000Z', lastUpdatedBy: 'Auto' },
    { itemName: 'Packaging Cup (16oz)', unit: 'Set', currentCount: 12, lastUpdated: '2026-10-10T03:00:00.000Z', lastUpdatedBy: 'Auto' },
  ];
  const calls = [];
  return { calls, getAll: async () => items, setCount: async (...a) => calls.push(a) };
}

test('stock: list shows counts with Bangkok date and who updated', async () => {
  const [out] = await processStock('stock', stockDeps());
  assert.match(out, /coke zero zero: 5 can \(updated 15\/10\/2026 22:26, Manual\)/);
  assert.match(out, /Packaging Cup \(12oz\): 40 Set/);
});

test('stock: full name sets the count; a short name is NOT applied, it is offered', async () => {
  const d = stockDeps();
  const [out] = await processStock('stock coke zero zero 3', d);
  assert.deepStrictEqual(d.calls[0], ['coke zero zero', 3, 'can', 'LINE']);
  assert.match(out, /coke zero zero: 5 → 3 can/);
  const [short] = await processStock('stock coke 3', d);
  assert.strictEqual(d.calls.length, 1);
  assert.match(short, /Nothing changed/);
  assert.match(short, /Did you mean/);
  assert.match(short, /coke zero zero/);
});

test('stock: unknown names change nothing and say so', async () => {
  const d = stockDeps();
  const [unk] = await processStock('stock sprite 4', d);
  assert.match(unk, /Nothing changed/);
  assert.match(unk, /isn't a tracked item/);
  const [bad] = await processStock('stock sprite', d);
  assert.match(bad, /couldn't read that/);
  assert.strictEqual(d.calls.length, 0);
});

test('stock: add a new item; ordinary words starting with "stock" are not commands', async () => {
  const d = stockDeps();
  const [out] = await processStock('stock add Bag small, pack, 30', d);
  assert.deepStrictEqual(d.calls[0], ['Bag small', 30, 'pack', 'LINE']);
  assert.match(out, /Added Bag small: 30 pack/);
  assert.strictEqual(await processStock('stocks are low today', d), null);
  assert.strictEqual(await processStock('7/10\nBolo', d), null);
});

// ---- web receipts page stores grams, not kilograms ----
test('web receipts route: a 2kg line is stored per gram', async () => {
  const path = require.resolve('../routes/receipts');
  const visionPath = require.resolve('../lib/vision');
  const sheetsPath = require.resolve('../lib/sheets');
  const saved = {};
  const rows = [];
  for (const p of [path, visionPath, sheetsPath]) saved[p] = require.cache[p];
  delete require.cache[path];
  require.cache[visionPath] = { id: visionPath, filename: visionPath, loaded: true, exports: { extractReceipt: async () => ({ shopping_date: '2026-10-13', shopped_at: 'Makro', line_items: [{ item_name: 'Pork - minced', purchase_price: 260, purchase_qty: 2, purchase_unit: 'kg' }, { item_name: 'Milk', purchase_price: 80, purchase_qty: 2, purchase_unit: 'l' }] }) } };
  require.cache[sheetsPath] = { id: sheetsPath, filename: sheetsPath, loaded: true, exports: { appendRows: async (tab, r) => rows.push(...r) } };
  try {
    const { handleBatch } = require('../routes/receipts');
    const res = { json: () => {}, status() { return this; } };
    await handleBatch({ files: [{ buffer: Buffer.from('x'), mimetype: 'image/jpeg', originalname: 'r.jpg' }] }, res);
    assert.strictEqual(rows[0][4], 0.13);   // 260 / 2000g
    assert.strictEqual(rows[1][4], 0.04);   // 80 / 2000ml
  } finally {
    delete require.cache[path];
    for (const p of [visionPath, sheetsPath]) { if (saved[p]) require.cache[p] = saved[p]; else delete require.cache[p]; }
  }
});

// ---- stew pack-out, packaging stock, editable web batch cook, never go quiet ----
const { parseNote } = require('../lib/noteParser');
const { costBatch } = require('../lib/costBatch');
const { runBatch } = require('../lib/cookService');
const { createCook } = require('../routes/cook');

test('note parser reads stew pack-out lines', () => {
  const { batches } = parseNote('7/10\nrws\nregular 12 @ 380g\nlarge 8 x 525\ncooked 9000', defaultShorthand(), TODAY);
  assert.deepStrictEqual(batches[0].sizes, [{ name: 'Regular', count: 12, weight: 380 }, { name: 'Large', count: 8, weight: 525 }]);
  assert.strictEqual(batches[0].cookedWeight, 9000);
});

const stewRecipe = {
  dish: 'Red Wine Beef Stew', sellingPrice: null, usualYield: 20,
  ingredients: [{ name: 'Beef', qty: 2000, unit: 'g', sheetCost: 0.3 }],
  packaging: [{ name: 'Cup', qty: 20, unit: 'pc', sheetCost: 2 }],
  utility: [],
};
const emptyBook = { lookup: () => null };

test('costBatch: stew cost per gram and per size; packaging override wins', () => {
  const batch = { date: TODAY, yield: null, lines: [], sizes: [{ name: 'Regular', count: 10, weight: 400 }, { name: 'Large', count: 5, weight: 600 }], cookedWeight: null, packagingQty: { cup: 15 } };
  const r = costBatch({ batch, recipe: stewRecipe, shorthand: defaultShorthand(), priceBook: emptyBook });
  assert.strictEqual(r.yield, 15);
  assert.strictEqual(r.total, 630); // 2000x0.3 + 15x2
  assert.strictEqual(r.cookedWeight, 7000);
  assert.strictEqual(r.costPerGram, 0.09);
  assert.deepStrictEqual(r.sizes.map((z) => z.costPerPortion), [36, 54]);
});

test('runBatch: logs once, deducts packaging stock and reports untracked items', async () => {
  const deps = makeNoteDeps();
  const used = [];
  deps.deductStock = async (n, q) => { used.push([n, q]); return n === 'Packaging Cup (12oz)' ? { deducted: true, newCount: 10, wentNegative: false } : { deducted: false }; };
  const out = await processNote(NOTE, deps);
  assert.ok(used.length > 0);
  assert.match(out[0], /Logged to the Cook Log/);
  assert.match(out[0], /Not taken off Stock Counts|Stock used/);
});

function cookDeps() {
  const base = makeNoteDeps();
  const logged = [];
  return { logged, ...base, loadCatalogue: async () => [], deductStock: async () => ({ deducted: false }), writeBatch: async (r, k, src) => { logged.push({ r, k, src }); } };
}
function fakeRes() { return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; }

test('web cook: prefill from recipe, edit only what changed, logged as Web', async () => {
  const h = createCook(() => cookDeps());
  const res = fakeRes();
  await h.recipe({ query: { dish: 'Polished Pork Bolognese', date: '07/10/2026' } }, res);
  assert.strictEqual(res.code, 200);
  assert.ok(res.body.ingredients.length > 3);

  const d = cookDeps();
  const h2 = createCook(() => d);
  const sub = fakeRes();
  await h2.submit({ body: { dish: 'Polished Pork Bolognese', date: '07/10/2026', yield: 21, lines: [{ name: res.body.ingredients[0].name, qty: 1000 }, { name: 'Onion', qty: 446 }], packaging: [] } }, sub);
  assert.strictEqual(sub.code, 200);
  assert.strictEqual(sub.body.status, 'logged');
  assert.strictEqual(d.logged[0].src, 'Web');
  assert.match(sub.body.text, /Logged to the Cook Log/);
});

test('web cook: bad input is refused with a reason, nothing logged', async () => {
  const d = cookDeps();
  const h = createCook(() => d);
  let r = fakeRes();
  await h.submit({ body: { dish: 'Nope' } }, r);
  assert.strictEqual(r.code, 400);
  r = fakeRes();
  await h.submit({ body: { dish: 'Polished Pork Bolognese', date: '07/10/2026', yield: 21, lines: [{ name: 'Onion', qty: 'abc' }] } }, r);
  assert.strictEqual(r.code, 400);
  assert.match(r.body.error, /Nothing was logged/);
  r = fakeRes();
  await h.submit({ body: { dish: 'Polished Pork Bolognese', date: '07/10/2026', lines: [] } }, r);
  assert.strictEqual(r.body.status, 'nolog');
  assert.strictEqual(d.logged.length, 0);
});

test('webhook: unrecognised group text gets a reply instead of silence', async () => {
  const replies = [];
  const deps = { secret: SECRET, token: 'tok', groupId: GROUP, reply: async (rt, t) => replies.push(t), push: async () => {}, note: makeNoteDeps(), stock: stockDeps(), receipt: {} };
  await withServer(deps, async (url) => {
    const p = signed(msg('q1', GROUP, 'lunch at 12?'));
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': p.sig }, body: p.body });
    await wait(100);
    assert.strictEqual(replies.length, 1);
    assert.match(replies[0], /didn't recognise/);
  });
});
