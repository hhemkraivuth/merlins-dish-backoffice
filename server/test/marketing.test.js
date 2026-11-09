const test = require('node:test');
const assert = require('node:assert');
const { buildMarketing, upcomingDates, notesFrom, merlinRange } = require('../lib/marketing');

const today = new Date(Date.UTC(2026, 10, 5));
const rows = [['Date', 'Kind', 'Title', 'Note', 'Status'], ['01/11/2026', 'Competitor', 'Sen and Sauce promo', 'Set lunch 199', ''], ['03/11/2026', 'Ad draft', 'Bolognese reel', 'Direct order angle', 'Draft']];

test('marketing reads notes newest first and groups them by kind', () => {
  const m = buildMarketing({ today, ledger: [], noteRows: rows });
  assert.strictEqual(m.notes['Ad draft'][0].title, 'Bolognese reel');
  assert.strictEqual(m.notes.Competitor.length, 1);
  assert.strictEqual(notesFrom(rows)[0].kind, 'Ad draft');
});

test('competitor check is pending after 9 days and not before', () => {
  assert.strictEqual(buildMarketing({ today, ledger: [], noteRows: rows }).auditDue, false);
  assert.strictEqual(buildMarketing({ today: new Date(Date.UTC(2026, 10, 20)), ledger: [], noteRows: rows }).auditDue, true);
  assert.strictEqual(buildMarketing({ today, ledger: [], noteRows: [] }).auditDue, true);
});

test('upcoming dates look 60 days ahead and wrap into next year', () => {
  const d = upcomingDates(today);
  assert.deepStrictEqual(d.map((x) => x.label), ["Father's Day (Thailand)", 'Christmas Eve', 'Christmas Day', "New Year's Eve"]);
  assert.strictEqual(d[0].date, '05/12/2026');
  assert.ok(upcomingDates(new Date(Date.UTC(2026, 11, 28))).some((x) => x.date === '14/02/2027'));
});

test('instagram orders are split out of LINE by the Order from column', () => {
  const { summarise } = require('../lib/reports');
  const mk = (from, no) => ({ date: new Date(Date.UTC(2026, 10, 3)), dmy: '03/11/2026', channel: 'LINE', orderFrom: from, type: 'Order', qty: 1, moneyIn: 330, cost: 0, net: 330, customer: 'x', orderNo: no, time: '', key: no, flags: '', desc: 'Stew' });
  const m = buildMarketing({ today, ledger: [mk('Instagram', '#1'), mk('LINE', '#2')], noteRows: [] });
  assert.strictEqual(m.week.ig, 1);
  assert.strictEqual(m.week.line, 1);
  assert.strictEqual(m.week.igText, '1 order, ฿330');
});

test('a re-run replaces the earlier summary per account on screen, history keeps every row', () => {
  const r = [['Date', 'Kind', 'Title', 'Note', 'Status'],
    ['05/11/2026', 'Competitor', '@ratto.bangkok', 'old', ''], ['05/11/2026', 'Competitor', '@ratto.bangkok 05/11/2026', 'new', ''],
    ['05/11/2026', 'Competitor', '@pasta.tomatoo', 'x', '']];
  const m = buildMarketing({ today, ledger: [], noteRows: r });
  assert.strictEqual(m.notes.Competitor.length, 2);
  assert.strictEqual(m.notes.Competitor.find((n) => n.title.startsWith('@ratto')).note, 'new');
  assert.strictEqual(m.history.length, 3);
});

test('date notes run soonest first and Coming up uses the same notes', () => {
  const r = [['Date', 'Kind', 'Title', 'Note', 'Status'],
    ['05/11/2026', 'Date', 'New Year 31/12/2026 to 01/01/2027', 'a', ''], ['05/11/2026', 'Date', 'Constitution Day 10/12/2026 (confirm)', 'b', ''],
    ['05/11/2026', 'Date', 'Loy Krathong 24/11/2026 (confirm date)', 'c', '']];
  const m = buildMarketing({ today, ledger: [], noteRows: r });
  assert.strictEqual(m.notes.Date[0].title.startsWith('Loy Krathong'), true);
  assert.deepStrictEqual(m.dates.map((d) => d.date), ['24/11/2026', '05/12/2026', '10/12/2026', '24/12/2026', '25/12/2026', '31/12/2026']);
  assert.strictEqual(m.dates[0].label, 'Loy Krathong (confirm date)');
  assert.strictEqual(m.dates[0].away, 19);
  assert.strictEqual(m.dates[0].day, 'Tue');
});

test('weekly moves are a note kind and come back newest first', () => {
  const r = [['Date', 'Kind', 'Title', 'Note', 'Status'], ['02/11/2026', 'Move', 'Old move', 'x', ''], ['05/11/2026', 'Move', 'New move', 'Borrow: @hangrybeefnoodle', '']];
  const m = buildMarketing({ today, ledger: [], noteRows: r });
  assert.ok(m.kinds.includes('Move'));
  assert.strictEqual(m.notes.Move[0].title, 'New move');
});

test('Merlin price range comes from the bot menu, mains only, with the 25 baht Grab markup', () => {
  const menu = { items: [{ category: 'Stews', price: 225 }, { category: 'Pasta', price: 185 }, { category: 'Drinks', price: 45 }, { category: 'Stews', price: 265 }] };
  const r = merlinRange(menu);
  assert.deepStrictEqual(r.direct, { lo: 185, hi: 265 });
  assert.deepStrictEqual(r.grab, { lo: 210, hi: 290 });
  assert.strictEqual(merlinRange(null), null);
  assert.strictEqual(buildMarketing({ today, ledger: [], noteRows: rows, menu }).merlin.count, 3);
});
