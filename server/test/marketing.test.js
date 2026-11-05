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

test('competitor check is due after 14 days and not before', () => {
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
