const test = require('node:test');
const assert = require('node:assert');

// Memory stand ins for App State, the sheet reader and the Content Queue tab.
const store = {};
const calls = [];
const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('../lib/appState', { getState: async (k) => store[k] || '', setState: async (k, v) => { store[k] = v; }, TAB: 'App State' });
stub('../lib/sheets', { readTab: async () => [['Key', 'Value', 'Updated'], ...Object.entries(store).map(([k, v]) => [k, v, ''])] });
let queueFails = false;
stub('../lib/contentQueue', {
  readQueue: async () => ({ 'cp-1': { status: 'published', igUrl: 'https://instagram.com/p/x', fbUrl: 'https://facebook.com/y', note: '' } }),
  upsert: async (post, status, note) => { if (queueFails) throw new Error('sheet down'); calls.push(['upsert', post.id, post.date, post.time, status, post.fullCaption, (post.media || []).length, note]); return { ok: true }; },
  cancel: async (id) => { calls.push(['cancel', id]); return { ok: true }; },
});
const lib = require('../lib/contentPlan');

const P = (id, extra = {}) => ({ id, date: '30/11/2026', pillar: 'Hour by hour', format: 'Reel', title: 'Why we brown first', hook: 'h', visual: 'v', caption: 'Brown first, braise slow.', why: 'w', borrow: 'b', avoid: 'a', audience: 'Thai 60 / Expat 40', ...extra });
const plan = { footer: 'Footer', pillars: [], proposals: [P('cp-1'), P('cp-2', { time: '12:30', media: [{ id: 'FILE_ID_ABC123', name: 'pot.jpg' }] })] };
const reset = () => { for (const k of Object.keys(store)) delete store[k]; calls.length = 0; queueFails = false; store.content_plan_json = JSON.stringify(plan); store.content_plan_footer = JSON.stringify('My footer'); };

test('merge: time defaults to 17:00, her own date and time win, media is cleaned', () => {
  const m = lib.merge(plan, {}, {}, { 'cp-1': { date: '01/12/2026', time: '19:30' } }, {});
  const [a, b] = m.proposals;
  assert.strictEqual(a.date, '01/12/2026');
  assert.strictEqual(a.time, '19:30');
  assert.strictEqual(b.date, '30/11/2026');
  assert.strictEqual(b.time, '12:30');
  assert.deepStrictEqual(b.media, [{ id: 'FILE_ID_ABC123', name: 'pot.jpg', kind: 'image' }]);
  assert.strictEqual(lib.merge(plan, {}, {}, {}, {}).proposals[0].time, '17:00');
});

test('merge: a post the queue says is published shows as published with its links', () => {
  const m = lib.merge(plan, { 'cp-1': { status: 'approved' } }, {}, {}, { 'cp-1': { status: 'published', igUrl: 'https://instagram.com/p/x', fbUrl: '' } });
  assert.strictEqual(m.proposals[0].status, 'published');
  assert.strictEqual(m.proposals[0].igUrl, 'https://instagram.com/p/x');
});

test('check: time and media shapes are validated', () => {
  assert.ok(lib.check(P('cp-9', { time: '5pm' }), null).some((x) => /time must be HH:MM/.test(x)));
  assert.ok(lib.check(P('cp-9', { media: [{ name: 'no id' }] }), null).some((x) => /media must be a list/.test(x)));
  assert.deepStrictEqual(lib.check(P('cp-9', { time: '17:00', media: [{ id: 'X', name: 'a' }] }), null), []);
});

test('approve writes the queue row first, with caption and footer, then saves the status', async () => {
  reset();
  await lib.setStatus({ id: 'cp-2', status: 'approved' });
  assert.deepStrictEqual(calls[0].slice(0, 7), ['upsert', 'cp-2', '30/11/2026', '12:30', 'approved', 'Brown first, braise slow.\n\nMy footer', 1]);
  assert.strictEqual(JSON.parse(store.content_plan_status)['cp-2'].status, 'approved');
});

test('approve without a file still queues, with a note saying no file', async () => {
  reset();
  await lib.setStatus({ id: 'cp-1', status: 'approved' });
  assert.strictEqual(calls[0][7], 'No file attached yet');
});

test('if the queue cannot be written the post is not approved', async () => {
  reset();
  queueFails = true;
  await assert.rejects(() => lib.setStatus({ id: 'cp-2', status: 'approved' }), /sheet down/);
  assert.strictEqual(store.content_plan_status, undefined);
});

test('undo approval and dismiss cancel the queue row', async () => {
  reset();
  await lib.setStatus({ id: 'cp-2', status: 'approved' });
  await lib.setStatus({ id: 'cp-2', status: 'proposed' });
  await lib.setStatus({ id: 'cp-1', status: 'dismissed' });
  assert.deepStrictEqual(calls.filter((c) => c[0] === 'cancel'), [['cancel', 'cp-2'], ['cancel', 'cp-1']]);
});

test('schedule: saves her date and time, validates, and updates the queue when approved', async () => {
  reset();
  await lib.setSchedule({ id: 'cp-2', date: '02/12/2026', time: '17:00' });
  assert.deepStrictEqual(JSON.parse(store.content_plan_sched)['cp-2'], { date: '02/12/2026', time: '17:00' });
  assert.strictEqual(calls.length, 0);
  await lib.setStatus({ id: 'cp-2', status: 'approved' });
  await lib.setSchedule({ id: 'cp-2', date: '03/12/2026', time: '18:30' });
  const last = calls[calls.length - 1];
  assert.deepStrictEqual(last.slice(0, 5), ['upsert', 'cp-2', '03/12/2026', '18:30', 'approved']);
  await assert.rejects(() => lib.setSchedule({ id: 'cp-2', date: '31/02/2026', time: '17:00' }), /real date/);
  await assert.rejects(() => lib.setSchedule({ id: 'cp-2', date: '02/12/2026', time: '5pm' }), /like 17:00/);
  await assert.rejects(() => lib.setSchedule({ id: 'nope', date: '02/12/2026', time: '17:00' }), /not in the plan/);
});

test('editing the caption of an approved post updates the queue', async () => {
  reset();
  await lib.setStatus({ id: 'cp-2', status: 'approved' });
  await lib.setCaption({ id: 'cp-2', caption: 'New words.' });
  const last = calls[calls.length - 1];
  assert.strictEqual(last[5], 'New words.\n\nMy footer');
});

test('media preview is only allowed for files a post names', async () => {
  reset();
  assert.strictEqual(await lib.mediaAllowed('FILE_ID_ABC123'), true);
  assert.strictEqual(await lib.mediaAllowed('SOMETHING_ELSE_1'), false);
});
