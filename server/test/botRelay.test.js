const test = require('node:test');
const assert = require('node:assert');
const { classify, relay } = require('../lib/botRelay');
const { runCommands } = require('../lib/textCommands');

test('order app commands are recognised, BOH words are not', () => {
  for (const t of ['close', 'open now', 'normal hours', 'status', 'hours', 'block 13/11 11:00-14:00', 'unblock 13/11', 'promo 10% weekend', 'promo off', 'itempromo rws 10', 'announce Closed Friday', 'soldout rws', 'instock rws', 'in stock dbs 9r 4l', 'remove tpb', 'restore tpb', 'removed', 'keywords', 'additem x 100']) assert.strictEqual(classify(t), 'bot', t);
  for (const t of ['left tpb 3, bolo 8', 'setstock rws 2', 'close 12/11', 'close 12/11-14/11 holiday', 'close today rain']) assert.strictEqual(classify(t), 'both', t);
  for (const t of ['stock', 'stock tpb', 'open', 'open batches', 'waiting', 'count tpb 3', 'free 001', 'low', 'undo', 'swap a b', 'rider 55', 'waste bolo 2', 'bolo 8 portions', 'closing count', '12/11', '']) assert.strictEqual(classify(t), null, t);
});
test('the order app reply is passed back with a label, and failures say nothing changed', async () => {
  assert.deepStrictEqual(await relay('close', async () => ({ handled: true, replies: ['Shop marked CLOSED.'] })), ['Order app: Shop marked CLOSED.']);
  assert.match((await relay('close', async () => ({ handled: false, replies: [] })))[0], /did not recognise/);
  assert.match((await relay('close', async () => ({ handled: true, replies: [] })))[0], /done/);
  assert.match((await relay('close', async () => { throw new Error('Editing needs BOT_URL'); }))[0], /not reached \(Editing needs BOT_URL\)\. Nothing changed there/);
});
test('a bot only command skips BOH and only the order app answers', async () => {
  const calls = [];
  const r = await runCommands('soldout rws', { botAct: async (a, b) => { calls.push([a, b]); return { handled: true, replies: ['rws is sold out.'] }; } });
  assert.deepStrictEqual(calls, [['command', { text: 'soldout rws' }]]);
  assert.deepStrictEqual(r, ['Order app: rws is sold out.']);
});
test('left and a dated close are handled by BOH and also sent on', async () => {
  const rows = [];
  const waste = { ensureTab: async () => {}, appendRows: async (tab, r) => rows.push(...r), loadShorthand: async () => ({ dishes: new Map() }) };
  const calls = [];
  const botAct = async (a, b) => { calls.push(b.text); return { handled: true, replies: ['ok'] }; };
  const r = await runCommands('close 12/11 rain', { waste, botAct }, Date.UTC(2026, 10, 14, 5));
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(calls, ['close 12/11 rain']);
  assert.match(r[0], /Closed 12\/11\/2026 noted: rain/);
  assert.strictEqual(r[1], 'Order app: ok');
});
test('without the order app link nothing is relayed', async () => {
  const waste = { ensureTab: async () => {}, appendRows: async () => {}, loadShorthand: async () => ({ dishes: new Map() }) };
  const r = await runCommands('close 12/11', { waste }, Date.UTC(2026, 10, 14, 5));
  assert.strictEqual(r.length, 1);
});
