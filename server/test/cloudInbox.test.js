const test = require('node:test');
const assert = require('node:assert');
const { run, runOne, waiting, HEADERS } = require('../lib/cloudInbox');

const NOW = () => new Date('2026-11-26T01:00:00Z');
function rig(rows, handlers) {
  const writes = [];
  return { writes, args: {
    readTabFresh: async () => rows,
    updateCells: async (tab, row, cells) => writes.push([row, ...cells.map((c) => [c.col, c.value])]),
    ensureTab: async () => {}, handlers, now: NOW,
  } };
}
const row = (kind, payload, status = 'new') => ['id1', '26/11/2026', kind, typeof payload === 'string' ? payload : JSON.stringify(payload), status, '', ''];

test('only rows with status new are picked up, with their sheet row numbers', () => {
  const rows = [HEADERS, row('content-week', {}, 'done'), row('content-week', { a: 1 }), row('brief-update', { id: 'b' }, 'error')];
  assert.deepStrictEqual(waiting(rows).map((w) => w.row), [3]);
});

test('a new row is claimed, run through its handler and marked done', async () => {
  const calls = [];
  const { writes, args } = rig([HEADERS, row('content-week', { prepared: '26/11/2026', proposals: [] })], { 'content-week': async (p) => { calls.push(p); return { ok: true, added: 2 }; } });
  const out = await run(args);
  assert.strictEqual(out.ran, 1);
  assert.deepStrictEqual(calls, [{ prepared: '26/11/2026', proposals: [] }]);
  assert.deepStrictEqual(writes[0], [2, [4, 'working'], [6, NOW().toISOString()]]);
  assert.strictEqual(writes[1][1][1], 'done');
  assert.match(writes[1][2][1], /"added":2/);
});

test('a rule failure is written back as error with the reason and is not retried', async () => {
  const { writes, args } = rig([HEADERS, row('content-week', { x: 1 })], { 'content-week': async () => { throw new Error('cp-1: no Friday posts'); } });
  await run(args);
  assert.strictEqual(writes[1][1][1], 'error');
  assert.match(writes[1][2][1], /no Friday posts/);
});

test('bad kind and bad JSON become errors, never thrown', async () => {
  assert.strictEqual((await runOne(row('delete-everything', {}), {})).status, 'error');
  const bad = await runOne(row('content-week', '{not json'), { 'content-week': async () => ({}) });
  assert.strictEqual(bad.status, 'error');
  assert.match(bad.result, /not valid JSON/);
});

test('a missing tab is created and nothing runs', async () => {
  let made = '';
  const out = await run({ readTabFresh: async () => { throw new Error('Unable to parse range: Cloud Inbox!A:Z'); }, ensureTab: async (t) => { made = t; }, updateCells: async () => {}, handlers: {} });
  assert.strictEqual(out.ran, 0);
  assert.strictEqual(made, 'Cloud Inbox');
});

test('the real handlers cover every kind', () => {
  const { KINDS } = require('../lib/cloudInbox');
  const h = require('../lib/cloudInbox');
  assert.deepStrictEqual(KINDS, ['content-week', 'brief-update', 'marketing-note', 'marketing-report', 'recipe-sync', 'content-sync-ack']);
  assert.ok(h.run);
});
