const test = require('node:test');
const assert = require('node:assert');
const { processClose, closedFrom } = require('../lib/closedDays');
const { summarise } = require('../lib/reports');
const { buildHuddle } = require('../lib/huddle');
const { runCommands } = require('../lib/textCommands');

const day = (s) => { const [d, m, y] = s.split('/').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const today = day('14/11/2026');
const mk = () => { const rows = []; return { rows, ensureTab: async () => {}, appendRows: async (tab, r) => { rows.push(...r.map((x) => [tab, ...x])); } }; };

test('a past day with a reason is logged', async () => {
  const d = mk();
  const r = await processClose('close 12/11 rain, no riders', today, d);
  assert.match(r[0], /Closed 12\/11\/2026 noted: rain, no riders/);
  assert.deepStrictEqual(d.rows.map((x) => x.slice(0, 3)), [['Closed Days', '12/11/2026', 'rain, no riders']]);
});
test('no reason, today and a coming day', async () => {
  const d = mk();
  await processClose('close 12/11', today, d);
  await processClose('close today', today, d);
  await processClose('close 20/11 holiday', today, d);
  assert.deepStrictEqual(d.rows.map((x) => x[1]), ['12/11/2026', '14/11/2026', '20/11/2026']);
  assert.strictEqual(d.rows[0][2], '');
});
test('a range logs each day, and a bad range saves nothing', async () => {
  const d = mk();
  const r = await processClose('close 12/11-14/11 holiday', today, d);
  assert.match(r[0], /12\/11\/2026 to 14\/11\/2026 \(3 days\)/);
  assert.strictEqual(d.rows.length, 3);
  const bad = mk();
  assert.match((await processClose('close 14/11-12/11', today, bad))[0], /Nothing was saved/);
  assert.match((await processClose('close 1/1-20/3', today, bad))[0], /up to 31 days/i);
  assert.strictEqual(bad.rows.length, 0);
});
test('plain close and other text are left to the order app', async () => {
  const d = mk();
  assert.strictEqual(await processClose('close', today, d), null);
  assert.strictEqual(await processClose('close today', today, mk()) !== null, true);
  assert.strictEqual(await processClose('closing count', today, d), null);
  assert.strictEqual(d.rows.length, 0);
});
test('a date without a year across new year picks the nearest', async () => {
  const d = mk();
  await processClose('close 30/12', day('2/1/2027'), d);
  assert.strictEqual(d.rows[0][1], '30/12/2026');
});
test('closedFrom reads the tab, latest row wins', () => {
  const m = closedFrom([['Date', 'Reason', 'Logged at'], ['12/11/2026', 'rain', 'x'], ['12/11/2026', 'sick', 'y']]);
  assert.strictEqual(m.get('2026-11-12'), 'sick');
});
test('the daily report marks a closed day, and others stay unmarked', () => {
  const ledger = [{ date: day('11/11/2026'), channel: 'LINE', type: 'Order', net: 100, orderNo: 'A', dmy: '11/11/2026' }, { date: day('13/11/2026'), channel: 'LINE', type: 'Order', net: 100, orderNo: 'B', dmy: '13/11/2026' }];
  const days = summarise(ledger, [], [], 'day', { closed: new Map([['2026-11-12', 'rain']]) });
  assert.deepStrictEqual(days.map((x) => x.closed), [null, { reason: 'rain' }, null]);
  assert.strictEqual(summarise(ledger, [], [], 'week', { closed: new Map([['2026-11-12', 'rain']]) })[0].closed, null);
});
test('the huddle says closed with the reason', () => {
  const t = buildHuddle({ today, closed: new Map([['2026-11-13', 'rain']]), ledger: [], cookBatches: [], purchases: [], stock: [], open: [] });
  assert.match(t, /Yesterday \(13\/11\/2026\): closed, rain\./);
});
test('the group command runs it', async () => {
  const d = mk();
  const r = await runCommands('close 12/11 sick day', { waste: d }, Date.UTC(2026, 10, 14, 5));
  assert.match(r[0], /Closed 12\/11\/2026 noted: sick day/);
});
