const test = require('node:test');
const assert = require('node:assert');

// Replace the App State store with a memory map so the briefing can run without Google Sheets.
const store = {};
const appStatePath = require.resolve('../lib/appState');
require.cache[appStatePath] = { id: appStatePath, filename: appStatePath, loaded: true, exports: { getState: async (k) => store[k] || '', setState: async (k, v) => { store[k] = v; }, TAB: 'App State' } };
const b = require('../lib/briefing');

test('dueLabel says it plainly', () => {
  assert.strictEqual(b.dueLabel('2026-11-09', '2026-11-11'), 'overdue by 2 days (09/11/2026)');
  assert.strictEqual(b.dueLabel('2026-11-10', '2026-11-11'), 'overdue by 1 day (10/11/2026)');
  assert.strictEqual(b.dueLabel('2026-11-11', '2026-11-11'), 'due today');
  assert.strictEqual(b.dueLabel('2026-11-12', '2026-11-11'), 'due tomorrow');
  assert.strictEqual(b.dueLabel('2026-11-14', '2026-11-11'), 'due in 3 days (14/11/2026)');
  assert.strictEqual(b.dueLabel('', '2026-11-11'), 'no due date');
});

test('date helpers convert both ways', () => {
  assert.strictEqual(b.isoFromDmy('1/2/2027'), '2027-02-01');
  assert.strictEqual(b.dmyFromIso('2027-02-01'), '01/02/2027');
  assert.strictEqual(b.isoFromDmy('nonsense'), '');
});

test('cleanTodo trims, limits and falls back', () => {
  const t = b.cleanTodo({ text: '  Shoot   the pasta ', team: 'Nobody', due: '2026-11-14' });
  assert.strictEqual(t.text, 'Shoot the pasta');
  assert.strictEqual(t.team, 'Me');
  assert.strictEqual(t.due, '2026-11-14');
  assert.throws(() => b.cleanTodo({ text: '   ' }), /Write what needs doing/);
  assert.throws(() => b.cleanTodo({ text: 'x'.repeat(201) }), /under 200/);
  assert.strictEqual(b.cleanTodo({ text: 'a', due: '31/12/2026' }).due, '');
});

test('sortTodos: overdue and nearest first, no due date last, done separate', () => {
  const { open, done } = b.sortTodos([
    { id: 'a', text: 'none', due: '', created: '2026-11-01' },
    { id: 'b', text: 'late', due: '2026-11-09', created: '2026-11-02' },
    { id: 'c', text: 'soon', due: '2026-11-12', created: '2026-11-03' },
    { id: 'd', text: 'finished', due: '2026-11-01', done: true, doneAt: '2026-11-10', created: '2026-11-01' },
  ]);
  assert.deepStrictEqual(open.map((t) => t.id), ['b', 'c', 'a']);
  assert.deepStrictEqual(done.map((t) => t.id), ['d']);
});

test('reports from the pit skip empty teams and change key when the text changes', () => {
  const pit = { teams: [
    { name: 'Operations', updates: ['Last batch 10/11/2026: Ragu, 8 portions.'], open: [] },
    { name: 'Creative', updates: ['No briefs waiting.'], open: [] },
  ] };
  const a = b.reportsFromPit(pit);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].team, 'Operations');
  pit.teams[0].updates = ['Last batch 11/11/2026: Ragu, 6 portions.'];
  assert.notStrictEqual(b.reportsFromPit(pit)[0].key, a[0].key);
});

test('open handoffs become reports once each', () => {
  const h = { from: 'Operations', to: 'App sales, Direct sales', message: 'Ragu: 4 portions are 6 days old.' };
  const r = b.reportsFromPit({ teams: [{ name: 'Operations', updates: [], open: [h] }, { name: 'Grab sales', updates: [], open: [h] }] });
  assert.strictEqual(r.length, 1);
  assert.match(r[0].team, /Operations to Sales/);
});

test('full flow: add, build, note, done, delete', async () => {
  const pit = { today: '11/11/2026', teams: [{ name: 'Operations', updates: ['Last batch 10/11/2026: Ragu, 8 portions.'], open: [] }] };
  const mk = [{ slug: 'audit', title: 'Audit', updated: '2026-11-11T05:14:28Z' }];
  await b.addTodo({ text: 'Shoot Thanksgiving dish', team: 'Creative', due: '2026-11-10' });
  await b.addTodo({ text: 'Order turkey', team: 'Purchasing', due: '2026-11-14' });
  let v = await b.build({ pit, marketingList: mk, todayIso: '2026-11-11' });
  assert.strictEqual(v.reports.length, 2);
  assert.strictEqual(v.todos[0].text, 'Shoot Thanksgiving dish');
  assert.strictEqual(v.todos[0].overdue, true);
  assert.strictEqual(v.todos[1].dueText, 'due in 3 days (14/11/2026)');
  assert.match(v.reports.find((r) => r.href).href, /report\.html\?doc=audit/);

  await b.markSeen(v.reports.map((r) => r.key));
  v = await b.build({ pit, marketingList: mk, todayIso: '2026-11-11' });
  assert.strictEqual(v.reports.length, 0);

  // A reposted report is news again.
  v = await b.build({ pit, marketingList: [{ slug: 'audit', title: 'Audit', updated: '2026-11-15T01:00:00Z' }], todayIso: '2026-11-11' });
  assert.strictEqual(v.reports.length, 1);

  const id = v.todos[0].id;
  await b.setDone({ id, done: true });
  v = await b.build({ pit, marketingList: mk, todayIso: '2026-11-11' });
  assert.strictEqual(v.todos.length, 1);
  assert.strictEqual(v.done.length, 1);
  await b.removeTodo({ id });
  v = await b.build({ pit, marketingList: mk, todayIso: '2026-11-11' });
  assert.strictEqual(v.done.length, 0);
  await assert.rejects(() => b.setDone({ id: 'missing', done: true }), /not on the list/);
});
