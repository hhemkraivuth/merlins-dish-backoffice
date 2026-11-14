const test = require('node:test');
const assert = require('node:assert');

// ---- memory App State, so the briefing runs without Google Sheets ----
const store = {};
const appStatePath = require.resolve('../lib/appState');
require.cache[appStatePath] = { id: appStatePath, filename: appStatePath, loaded: true, exports: { getState: async (k) => store[k] || '', setState: async (k, v) => { store[k] = v; }, TAB: 'App State' } };
const b = require('../lib/briefing');
const riderFees = require('../lib/riderFees');
const botAdmin = require('../lib/botAdmin');
const { utc } = require('../lib/dates');

const day = (dmy) => { const [d, m, y] = dmy.split('/').map(Number); return utc(y, m, d); };
const row = (dmy, no, type, net, extra = {}) => ({ channel: 'LINE', dmy, date: day(dmy), orderNo: no, type, net, customer: 'Cee', time: '12:00', flags: '', ...extra });
const reset = () => { for (const k of Object.keys(store)) delete store[k]; };

// ---------------- delivery cost per order ----------------
test('riderView lists free delivery orders with no rider fee, newest first', () => {
  const ledger = [
    row('10/11/2026', '#001', 'Order', 330), row('10/11/2026', '#001', 'Delivery', 0),
    row('10/11/2026', '#002', 'Order', 250), row('10/11/2026', '#002', 'Delivery', 50), row('10/11/2026', '#002', 'Rider', -55),
    row('11/11/2026', '#003', 'Order', 120),
    { ...row('01/09/2026', '#900', 'Order', 100) }, // too old
    { ...row('10/11/2026', 'L-abc', 'Order', 100) }, // no order number
    { ...row('10/11/2026', '#050', 'Order', 100), channel: 'Grab' },
  ];
  const v = riderFees.riderView(ledger, day('11/11/2026'));
  assert.deepStrictEqual(v.orders.map((o) => o.orderNo), ['#003', '#002', '#001']);
  const o1 = v.orders.find((o) => o.orderNo === '#001');
  assert.strictEqual(o1.free, true);
  assert.strictEqual(o1.rider, null);
  const o2 = v.orders.find((o) => o.orderNo === '#002');
  assert.strictEqual(o2.free, false);
  assert.strictEqual(o2.rider, 55);
  // #003 is today, still open, so only #001 counts as missing
  assert.strictEqual(v.missing, 1);
  assert.strictEqual(v.month.freeOrders, 2);
  assert.strictEqual(v.month.riderPaid, 55);
  assert.strictEqual(v.month.deliveryCharged, 50);
});

test('a rider fee of 0 counts as logged (customer collected)', () => {
  const ledger = [row('10/11/2026', '#001', 'Order', 330), row('10/11/2026', '#001', 'Rider', -0)];
  const v = riderFees.riderView(ledger, day('11/11/2026'));
  assert.strictEqual(v.orders[0].rider, 0);
  assert.strictEqual(v.missing, 0);
});

test('buildRiderRows works with any order number, splits trips and rejects bad input', () => {
  const orders = [{ orderNo: '#MF174', customer: 'Nin' }, { orderNo: '#002', customer: 'Ann' }];
  const one = riderFees.buildRiderRows({ dmy: '02/11/2026', orderNos: ['#MF174'], fee: '฿55' }, orders);
  assert.deepStrictEqual(one.keys, ['R|02/11/2026|#MF174']);
  assert.deepStrictEqual(one.shares, [55]);
  const zero = riderFees.buildRiderRows({ dmy: '02/11/2026', orderNos: ['MF174'], fee: '0' }, orders);
  assert.deepStrictEqual(zero.shares, [0]);
  const trip = riderFees.buildRiderRows({ dmy: '02/11/2026', orderNos: ['#MF174', '002'], fee: 81 }, orders);
  assert.deepStrictEqual(trip.shares, [40.5, 40.5]);
  assert.strictEqual(trip.rows.length, 2);
  assert.throws(() => riderFees.buildRiderRows({ dmy: '02/11/2026', orderNos: [], fee: '55' }, orders), /Pick the order/);
  assert.throws(() => riderFees.buildRiderRows({ dmy: '02/11/2026', orderNos: ['#1'], fee: 'abc' }, orders), /number/);
  assert.throws(() => riderFees.buildRiderRows({ dmy: '02/11/2026', orderNos: ['#1'], fee: '-5' }, orders), /number/);
  assert.throws(() => riderFees.buildRiderRows({ dmy: 'soon', orderNos: ['#MF174'], fee: '5' }, orders), /date/);
  assert.throws(() => riderFees.buildRiderRows({ dmy: '02/11/2026', orderNos: ['#999'], fee: '5' }, orders), /can't find LINE order #999/);
});

// ---------------- automatic to dos ----------------
test('dateInText reads a due date from a move', () => {
  assert.strictEqual(b.dateInText('Thanksgiving pre orders on the order bot by 13/11', '2026-11-11'), '2026-11-13');
  assert.strictEqual(b.dateInText('Post on 12/11/2026 at 5pm', '2026-11-11'), '2026-11-12');
  assert.strictEqual(b.dateInText('No date here', '2026-11-11'), '');
  assert.strictEqual(b.dateInText('Price 120/150', '2026-11-11'), '');
  assert.strictEqual(b.dateInText('Back on 05/01', '2026-12-20'), '2027-01-05');
});

test('movesFromRows takes the newest day, up to three', () => {
  const rows = [
    ['Date', 'Kind', 'Title', 'Note', 'Status'],
    ['04/11/2026', 'Move', 'Old move', '', ''],
    ['11/11/2026', 'Move', 'Move A', 'a', ''], ['11/11/2026', 'Move', 'Move B', 'b', ''], ['11/11/2026', 'Move', 'Move C', 'c', ''], ['11/11/2026', 'Competitor', 'Not a move', '', ''],
  ];
  assert.deepStrictEqual(b.movesFromRows(rows).map((m) => m.title), ['Move A', 'Move B', 'Move C']);
  assert.deepStrictEqual(b.movesFromRows([]), []);
});

test('teamForHandoff maps the receiving team onto a to do team', () => {
  assert.strictEqual(b.teamForHandoff('Operations'), 'Operations');
  assert.strictEqual(b.teamForHandoff('App sales, Direct sales'), 'Grab sales');
  assert.strictEqual(b.teamForHandoff('Direct sales'), 'Direct sales');
  assert.strictEqual(b.teamForHandoff('Lily'), 'Me');
  assert.strictEqual(b.teamForHandoff('Paid Media'), 'Paid Media');
});

const pitWith = (...open) => ({ teams: [{ name: 'Operations', open }] });
const handoff = (message, to = 'Operations') => ({ from: 'App sales, Direct sales', to, message });

test('syncAuto turns handoffs and moves into to dos once, with due dates', async () => {
  reset();
  const pit = pitWith(handoff('Bolognese: only 2 portions left. Cook another batch? More words follow.'));
  const moves = [{ date: '11/11/2026', title: 'Open Thanksgiving pre orders by 13/11', note: '' }, { date: '11/11/2026', title: 'Pasta post for Ratto closure', note: '' }];
  const first = await b.syncAuto({ pit, moves, riderMissing: 0, todayIso: '2026-11-11' });
  assert.strictEqual(first.added, 3);
  const v = await b.todoView('2026-11-11');
  const by = Object.fromEntries(v.todos.map((t) => [t.text.slice(0, 12), t]));
  assert.strictEqual(by['Bolognese: o'].team, 'Operations');
  assert.strictEqual(by['Bolognese: o'].due, '2026-11-13'); // today + 2
  assert.strictEqual(by['Open Thanksg'].due, '2026-11-13'); // date in the move
  assert.strictEqual(by['Pasta post f'].due, '2026-11-14'); // no date, today + 3
  assert.ok(v.todos.every((t) => t.auto && t.src));
  // running again adds nothing
  assert.strictEqual((await b.syncAuto({ pit, moves, riderMissing: 0, todayIso: '2026-11-11' })).added, 0);
  assert.strictEqual((await b.todoView('2026-11-11')).todos.length, 3);
});

test('a deleted automatic to do does not come back', async () => {
  reset();
  const pit = pitWith(handoff('Time for a flash sale on Ragu.'));
  await b.syncAuto({ pit, moves: [], riderMissing: 0, todayIso: '2026-11-11' });
  const id = (await b.todoView('2026-11-11')).todos[0].id;
  await b.removeTodo({ id });
  await b.syncAuto({ pit, moves: [], riderMissing: 0, todayIso: '2026-11-12' });
  assert.strictEqual((await b.todoView('2026-11-12')).todos.length, 0);
});

test('a handoff to do ticks off when the handoff clears; a move to do stays', async () => {
  reset();
  const pit = pitWith(handoff('Ragu is sold out. Mark it sold out on Grab.'));
  await b.syncAuto({ pit, moves: [{ date: '11/11/2026', title: 'Shoot the pasta', note: '' }], riderMissing: 0, todayIso: '2026-11-11' });
  await b.syncAuto({ pit: pitWith(), moves: [{ date: '11/11/2026', title: 'Shoot the pasta', note: '' }], riderMissing: 0, todayIso: '2026-11-12' });
  const v = await b.todoView('2026-11-12');
  assert.deepStrictEqual(v.todos.map((t) => t.text), ['Shoot the pasta']);
  assert.deepStrictEqual(v.done.map((t) => t.text), ['Ragu is sold out.']);
});

test('rider fee gaps roll up into one to do that follows the count', async () => {
  reset();
  const gap = (n) => handoff(`LINE order #00${n} on 10/11/2026 has no rider fee yet. Send: rider 00${n} 55`, 'Operations');
  const pit = pitWith(gap(1), gap(2));
  await b.syncAuto({ pit, moves: [], riderMissing: 2, todayIso: '2026-11-11' });
  let v = await b.todoView('2026-11-11');
  assert.strictEqual(v.todos.length, 1);
  assert.match(v.todos[0].text, /rider fee for 2 LINE orders/);
  assert.strictEqual(v.todos[0].due, '2026-11-11');
  await b.syncAuto({ pit, moves: [], riderMissing: 1, todayIso: '2026-11-11' });
  v = await b.todoView('2026-11-11');
  assert.strictEqual(v.todos.length, 1);
  assert.match(v.todos[0].text, /rider fee for 1 LINE order\b/);
  await b.syncAuto({ pit: pitWith(), moves: [], riderMissing: 0, todayIso: '2026-11-11' });
  v = await b.todoView('2026-11-11');
  assert.strictEqual(v.todos.length, 0);
  assert.strictEqual(v.done.length, 1);
});

test('the first pass adds at most 12 automatic to dos', async () => {
  reset();
  const many = Array.from({ length: 20 }, (_, i) => handoff(`Item ${i} needs a look.`));
  const out = await b.syncAuto({ pit: pitWith(...many), moves: [], riderMissing: 0, todayIso: '2026-11-11' });
  assert.strictEqual(out.added, 12);
});

test('build still answers when the sheet cannot be written', async () => {
  reset();
  const out = await b.build({ pit: pitWith(handoff('Cook more Bolo.')), marketingList: [], todayIso: '2026-11-11', moves: [], riderMissing: 3 });
  assert.strictEqual(out.riderMissing, 3);
  assert.ok(out.todos.length >= 2); // the handoff and the rider line
});

// ---------------- LINE reminder ----------------
test('reminderText lists overdue, due today and rider fees; empty when nothing is due', () => {
  const todos = [
    { text: 'Shoot the pasta', team: 'Creative', due: '2026-11-09' },
    { text: 'Open pre orders', team: 'Marketing', due: '2026-11-11' },
    { text: 'Later job', team: 'Me', due: '2026-11-20' },
    { text: 'Done job', team: 'Me', due: '2026-11-01', done: true },
  ];
  const t = b.reminderText({ todos, riderMissing: 2, todayIso: '2026-11-11' });
  assert.match(t, /^Morning Boss\. 11\/11\/2026/);
  assert.match(t, /Overdue:\n• Shoot the pasta \(Creative, overdue by 2 days \(09\/11\/2026\)\)/);
  assert.match(t, /Due today:\n• Open pre orders \(Marketing, due today\)/);
  assert.match(t, /2 LINE orders have no rider fee yet/);
  assert.ok(!/Later job|Done job/.test(t));
  assert.strictEqual(b.reminderText({ todos: [{ text: 'x', team: 'Me', due: '2026-11-20' }], riderMissing: 0, todayIso: '2026-11-11' }), '');
});

test('the reminder timer sends once a day inside its window', async () => {
  const { startTodoReminderTimer } = require('../lib/scheduler');
  const keep = { g: process.env.BOH_GROUP_ID, t: process.env.LINE_CHANNEL_ACCESS_TOKEN, a: process.env.TODO_REMIND_AUTO };
  process.env.BOH_GROUP_ID = 'C1'; process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok'; delete process.env.TODO_REMIND_AUTO;
  try {
    let clock = Date.UTC(2026, 10, 11, 1, 0); // 08:00 Bangkok
    const mem = {}; let sends = 0;
    const timer = startTodoReminderTimer(async () => { sends += 1; return { sent: true }; }, { now: () => clock, every: 5, log: { log() {}, error() {} }, store: { get: async (k) => mem[k] || '', set: async (k, v) => { mem[k] = v; } } });
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(sends, 0, 'before 09:00');
    clock = Date.UTC(2026, 10, 11, 2, 5); // 09:05
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(sends, 1, 'at 09:05');
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(sends, 1, 'not twice');
    clock = Date.UTC(2026, 10, 12, 14, 0); // 21:00 next day, past the 8 hour window
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(sends, 1, 'outside the window');
    clearInterval(timer);
    process.env.TODO_REMIND_AUTO = 'off';
    assert.strictEqual(startTodoReminderTimer(async () => ({}), {}), null);
    delete process.env.TODO_REMIND_AUTO; delete process.env.BOH_GROUP_ID;
    assert.strictEqual(startTodoReminderTimer(async () => ({}), {}), null, 'needs the LINE group');
  } finally {
    for (const [k, v] of [['BOH_GROUP_ID', keep.g], ['LINE_CHANNEL_ACCESS_TOKEN', keep.t], ['TODO_REMIND_AUTO', keep.a]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ---------------- Index auto expiry ----------------
test('staleActions switches off everything whose end date has passed', () => {
  const st = {
    announcement: { headline: 'Closed 9 to 10 Nov', endDate: '2026-11-10', live: false },
    storewidePromo: { active: true, label: 'Launch', endDate: '2026-09-30' },
    itemPromos: { bolo: { label: 'Bolo deal', endDate: '2026-11-12' }, ragu: { label: 'Old', endDate: '2026-10-01' } },
    open: { override: false, closures: [{ start: '2026-11-09', end: '2026-11-10' }, { start: '2026-11-20', end: '2026-11-21' }], special: [{ date: '2026-11-01', open: '11:00', close: '19:00' }] },
  };
  const acts = botAdmin.staleActions(st, '2026-11-11');
  assert.deepStrictEqual(acts.map((a) => a.action), ['announcement/clear', 'promo/storewide/off', 'promo/item/clear', 'hours']);
  assert.deepStrictEqual(acts[2].body, { id: 'ragu' });
  assert.deepStrictEqual(acts[3].body, { override: 'closed', closures: [{ start: '2026-11-20', end: '2026-11-21' }], special: [], blocks: [] });
});

test('staleActions clears blocked slots on past dates and keeps the rest', () => {
  const st = { announcement: {}, storewidePromo: {}, itemPromos: {}, open: { override: null, closures: [], special: [], blocks: [{ date: '2026-11-10', start: '11:00', end: '14:00' }, { date: '2026-11-13', start: '11:00', end: '14:00' }] } };
  const acts = botAdmin.staleActions(st, '2026-11-11');
  assert.deepStrictEqual(acts.map((a) => a.action), ['hours']);
  assert.deepStrictEqual(acts[0].body.blocks, [{ date: '2026-11-13', start: '11:00', end: '14:00' }]);
});

test('staleActions leaves live things, open ended ones and read only state alone', () => {
  const st = {
    announcement: { headline: 'Open late', endDate: '2026-11-11', live: true },
    storewidePromo: { active: true, label: 'Always', endDate: null },
    itemPromos: {}, open: { override: null, closures: [{ start: '2026-11-11', end: '2026-11-12' }], special: [] },
  };
  assert.deepStrictEqual(botAdmin.staleActions(st, '2026-11-11'), []);
  assert.deepStrictEqual(botAdmin.staleActions({ ...st, readOnly: true, announcement: { headline: 'x', endDate: '2020-01-01' } }, '2026-11-11'), []);
  assert.deepStrictEqual(botAdmin.staleActions(null, '2026-11-11'), []);
});

// ---------------- Sheets read cache ----------------
test('sheet reads are cached briefly, shared, copied, and forgotten after a write', async () => {
  const googlePath = require.resolve('googleapis');
  const sheetsPath = require.resolve('../lib/sheets');
  const saved = { g: require.cache[googlePath], s: require.cache[sheetsPath], ttl: process.env.SHEETS_READ_CACHE_MS, e: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, k: process.env.GOOGLE_PRIVATE_KEY };
  let gets = 0; let appends = 0; let authBuilt = 0;
  const data = { Orders: [['a', '1'], ['b', '2']] };
  const fake = { spreadsheets: { values: {
    get: async ({ range }) => { gets += 1; await new Promise((r) => setTimeout(r, 15)); return { data: { values: data[range.split('!')[0]] } }; },
    append: async () => { appends += 1; return {}; },
  } } };
  require.cache[googlePath] = { id: googlePath, filename: googlePath, loaded: true, exports: { google: { auth: { GoogleAuth: class { constructor() { authBuilt += 1; } } }, sheets: () => fake } } };
  delete require.cache[sheetsPath];
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'x@y'; process.env.GOOGLE_PRIVATE_KEY = 'key'; delete process.env.SHEETS_READ_CACHE_MS;
  try {
    const sheets = require('../lib/sheets');
    const [r1, r2] = await Promise.all([sheets.readTab('Orders'), sheets.readTab('Orders')]);
    assert.strictEqual(gets, 1, 'two readers at once share one request');
    r1[0][0] = 'MUTATED';
    const r3 = await sheets.readTab('Orders');
    assert.strictEqual(gets, 1, 'second read comes from the cache');
    assert.strictEqual(r3[0][0], 'a', 'callers get their own copy');
    assert.strictEqual(r2[0][0], 'a');
    await sheets.appendRows('Orders', [['c', '3']]);
    await sheets.readTab('Orders');
    assert.strictEqual(gets, 2, 'a write makes the next read fresh');
    await sheets.readTabFresh('Orders');
    assert.strictEqual(gets, 3, 'readTabFresh always asks Google');
    assert.strictEqual(authBuilt, 1, 'one Google client for all calls');
    process.env.SHEETS_READ_CACHE_MS = '0';
    await sheets.readTab('Orders'); await sheets.readTab('Orders');
    assert.strictEqual(gets, 5, 'cache can be turned off');
  } finally {
    if (saved.g) require.cache[googlePath] = saved.g; else delete require.cache[googlePath];
    if (saved.s) require.cache[sheetsPath] = saved.s; else delete require.cache[sheetsPath];
    for (const [k, v] of [['SHEETS_READ_CACHE_MS', saved.ttl], ['GOOGLE_SERVICE_ACCOUNT_EMAIL', saved.e], ['GOOGLE_PRIVATE_KEY', saved.k]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
