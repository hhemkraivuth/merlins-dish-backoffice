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
