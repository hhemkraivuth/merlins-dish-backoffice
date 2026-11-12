const test = require('node:test');
const assert = require('node:assert');

// The Stock left box on Home: one typed line updates the order app and saves BOH counts; each side reports for itself.
function run(patch) {
  const line = require('../routes/line');
  const botAdmin = require('../lib/botAdmin');
  const bot = require('../lib/botStock');
  const rows = [];
  const saved = { line: line.getDefaultDeps, act: botAdmin.act, fetch: bot.fetchSnapshot, save: bot.saveSnapshot };
  line.getDefaultDeps = () => ({ waste: { loadShorthand: async () => require('../lib/aliases').defaultShorthand(), ensureTab: async () => {}, appendRows: async (t, r) => rows.push(...r) } });
  botAdmin.act = patch.act;
  bot.fetchSnapshot = async () => ({ takenAt: new Date().toISOString(), items: [] });
  bot.saveSnapshot = async () => {};
  const { stockLeftSet } = require('../routes/stockLeft');
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { Object.assign(this, { body: b }); resolve({ res: this, rows }); } };
    stockLeftSet({ body: { text: patch.text } }, res).finally(() => { line.getDefaultDeps = saved.line; botAdmin.act = saved.act; bot.fetchSnapshot = saved.fetch; bot.saveSnapshot = saved.save; });
  });
}

test('one line updates the order app and BOH', async () => {
  let sent;
  const { res, rows } = await run({ text: 'left tpb 3, ragu 0, bolo 8', act: async (a, b) => { sent = [a, b]; return { message: 'Order app stock updated (3)' }; } });
  assert.deepStrictEqual(sent, ['stock', { text: 'tpb 3, ragu 0, bolo 8' }]);
  assert.strictEqual(rows.length, 3);
  assert.match(res.body.boh, /BOH counts saved/);
  assert.strictEqual(res.body.bot, 'Order app stock updated (3)');
});

test('the order app being down does not stop BOH saving, and says so', async () => {
  const { res, rows } = await run({ text: 'tpb 3', act: async () => { throw new Error('Editing needs BOT_URL and BOT_ADMIN_TOKEN'); } });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(res.body.botFailed, true);
  assert.match(res.body.bot, /not updated/);
});

test('empty text is refused', async () => {
  const { res, rows } = await run({ text: 'left', act: async () => ({}) });
  assert.strictEqual(res.code, 400);
  assert.strictEqual(rows.length, 0);
});
