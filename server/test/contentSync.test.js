const test = require('node:test');
const assert = require('node:assert');
const { request, state, ack } = require('../lib/contentSync');

const rig = () => { const m = {}; return { m, deps: { now: () => new Date('2026-11-26T09:00:00Z'), appState: { getState: async (k) => m[k] || '', setState: async (k, v) => { m[k] = v; } } } }; };

test('pressing Sync now leaves one request, and pressing again does not add another', async () => {
  const { m, deps } = rig();
  assert.deepStrictEqual(await request(deps), { pending: '2026-11-26T09:00:00.000Z', already: false });
  assert.strictEqual((await request({ ...deps, now: () => new Date('2026-11-26T09:30:00Z') })).already, true);
  assert.strictEqual(JSON.parse(m.content_sync_request).requestedAt, '2026-11-26T09:00:00.000Z');
  assert.strictEqual((await state(deps)).pending, '2026-11-26T09:00:00.000Z');
});

test('the hourly task acknowledging the request clears it and records when the review started', async () => {
  const { deps } = rig();
  await request(deps);
  const out = await ack({}, { ...deps, now: () => new Date('2026-11-26T09:23:00Z') });
  assert.strictEqual(out.ok, true);
  const s = await state(deps);
  assert.strictEqual(s.pending, null);
  assert.deepStrictEqual(s.last, { requestedAt: '2026-11-26T09:00:00.000Z', startedAt: '2026-11-26T09:23:00.000Z' });
});
