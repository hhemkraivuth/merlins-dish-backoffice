const test = require('node:test');
const assert = require('node:assert');
const sheets = require('../lib/sheets');
const { createReceiptItems } = require('../routes/receiptItems');

function fake(tabs) {
  const deleted = [];
  sheets.readTabFresh = async (t) => tabs[t] || [];
  sheets.deleteRowAt = async (t, i) => { deleted.push([t, i]); return 1; };
  sheets.deleteRowsWhere = async (t, fn) => { const n = (tabs[t] || []).slice(1).filter(fn).length; if (n) deleted.push([t, 'where']); return n; };
  return deleted;
}
const res = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

test('delete removes only the exact row it was shown, even when identical rows exist', async () => {
  const tabs = { 'Expense Log': [['h'], ['14/11/2026', 'Poco Vino - Shiraz', '199', '187ml', 1, 'villa', 'Receipt R261117-5'], ['14/11/2026', 'Poco Vino - Shiraz', '199', '187ml', 1, 'villa', 'Receipt R261117-5']], 'Ingredient Lots': [['h']] };
  const deleted = fake(tabs);
  const r = res();
  await createReceiptItems(() => ({})).del({ body: { ref: { t: 'E', i: 2, d: '14/11/2026', n: 'Poco Vino - Shiraz', p: '199' } } }, r);
  assert.strictEqual(r.code, 200);
  assert.deepStrictEqual(deleted[0], ['Expense Log', 2]);
});

test('a stale page cannot delete a different row', async () => {
  const deleted = fake({ Overheads: [['h'], ['13/11/2026', 'pot', '', '2575', '', '']] });
  const r = res();
  await createReceiptItems(() => ({})).del({ body: { ref: { t: 'O', i: 1, d: '13/11/2026', n: 'blender', p: '297' } } }, r);
  assert.strictEqual(r.code, 409);
  assert.strictEqual(deleted.length, 0);
});

test('edit with an unreadable line changes nothing', async () => {
  const deleted = fake({ Overheads: [['h'], ['13/11/2026', 'blender', '', '297', '', '']] });
  const r = res();
  await createReceiptItems(() => ({ appendOverheads: async () => {} })).edit({ body: { ref: { t: 'O', i: 1, d: '13/11/2026', n: 'blender', p: '297' }, date: '13/11/2026', item: 'blender', price: 'abc', kind: 'Overhead' } }, r);
  assert.strictEqual(r.code, 400);
  assert.strictEqual(deleted.length, 0);
});
