const test = require('node:test');
const assert = require('node:assert');
const { buildMarketing, upcomingDates, notesFrom } = require('../lib/marketing');

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
