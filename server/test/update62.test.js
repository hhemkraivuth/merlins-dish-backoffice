const test = require('node:test');
const assert = require('node:assert');
const { grabToDirect, headlineBet, buildMarketing } = require('../lib/marketing');
const reports = require('../lib/marketingReports');
const MD = require('../../public/md.js');

const day = (m, d) => new Date(Date.UTC(2026, m - 1, d));
const grab = (name, m, d) => ({ channel: 'Grab', type: 'Order', customer: name, date: day(m, d), dmy: `${d}/${m}/2026`, orderNo: `G${name}${m}${d}` });
const line = (name, m, d, no) => ({ channel: 'LINE', type: 'Order', customer: name, date: day(m, d), dmy: `${d}/${m}/2026`, orderNo: no, orderFrom: 'LINE' });
const bet = { title: 'November: move Grab customers to direct. Target 5 direct orders by 30/11/2026' };

test('grab to direct counts direct orders from names that ordered on Grab first', () => {
  const ledger = [grab('Mali K', 10, 5), grab('Nok', 11, 20), line('mali k', 11, 12, 'L1'), line('Nok', 11, 12, 'L2'), line('New person', 11, 13, 'L3')];
  const r = grabToDirect(ledger, bet);
  assert.deepStrictEqual(r, { count: 1, target: 5, since: '01/11/2026', until: '30/11/2026' });
});

test('grab to direct ignores masked names, orders outside the month and repeat rows of one order', () => {
  const ledger = [grab('XXXXXX', 10, 5), grab('A*** B', 10, 5), grab('Pim', 10, 5), line('XXXXXX', 11, 12, 'L1'), line('A*** B', 11, 12, 'L2'), line('Pim', 10, 28, 'L3'), line('Pim', 11, 12, 'L4'), line('Pim', 11, 12, 'L4'), line('Pim', 12, 2, 'L5')];
  assert.strictEqual(grabToDirect(ledger, bet).count, 1);
});

test('grab to direct only applies to a bet that is about Grab and direct, and needs a deadline', () => {
  assert.strictEqual(grabToDirect([], { title: 'November: post twice a week by 30/11/2026' }), null);
  assert.strictEqual(grabToDirect([], { title: 'November: move Grab customers to direct' }), null);
  assert.strictEqual(grabToDirect([], undefined), null);
  assert.strictEqual(grabToDirect([], { title: 'December: Grab customers to direct, 8 direct orders by 31/12/2026' }).target, 8);
});

test('the headline bet is the month note, not the detail note', () => {
  assert.strictEqual(headlineBet([{ title: '5 Grab customers to direct' }, bet]).title, bet.title);
  assert.strictEqual(headlineBet([]), undefined);
  const rows = [['Date', 'Kind', 'Title', 'Note', 'Status'], ['10/11/2026', 'Bet', bet.title, 'x', ''], ['10/11/2026', 'Bet', '5 Grab customers to direct', 'y', '']];
  assert.strictEqual(buildMarketing({ today: day(11, 11), ledger: [grab('A', 10, 1), line('A', 11, 12, 'L1')], noteRows: rows }).bet.count, 1);
});

test('a posted report is checked and stored as one row', () => {
  const now = new Date('2026-11-11T05:00:00Z');
  const row = reports.prepare({ slug: ' Audit ', title: 'Weekly audit', markdown: '# Hi\r\n\r\ntext' }, now);
  assert.strictEqual(row.slug, 'audit');
  assert.strictEqual(row.key, 'marketing_report_audit');
  assert.deepStrictEqual(JSON.parse(row.value), { title: 'Weekly audit', markdown: '# Hi\n\ntext', updated: '2026-11-11T05:00:00.000Z' });
  assert.throws(() => reports.prepare({ slug: 'a b', markdown: 'x' }), /short name/);
  assert.throws(() => reports.prepare({ slug: 'audit', markdown: '   ' }), /empty/);
  assert.throws(() => reports.prepare({ slug: 'audit', markdown: 'x'.repeat(reports.MAX_CELL) }), /too long/);
});

test('reports read back from App State rows in the usual order, other rows ignored', () => {
  const mk = (slug, title) => ['marketing_report_' + slug, JSON.stringify({ title, markdown: '# ' + title, updated: 'u' }), 's'];
  const rows = [['Key', 'Value', 'Updated'], ['bot_stock_snapshot', '{}', 's'], mk('inspo', 'Inspo'), mk('zeta', 'Zeta'), mk('audit', 'Audit'), ['marketing_report_bad', 'not json', 's'], mk('grab', 'Grab')];
  assert.deepStrictEqual(reports.fromRows(rows).map((r) => r.slug), ['audit', 'grab', 'inspo', 'zeta']);
  assert.strictEqual(reports.fromRows(rows)[0].markdown, undefined);
  assert.strictEqual(reports.fromRows(rows, { withText: true })[0].markdown, '# Audit');
  assert.deepStrictEqual(reports.fromRows(undefined), []);
});

test('report reader draws tables, lists and links, and never lets html or script through', () => {
  const out = MD.render('## Part\n\n| A | B |\n|---|---|\n| 1 | <script>x()</script> |\n\n- one\n- **two**\n\n[site](https://a.com/p?x=1&y=2) [bad](javascript:alert(1))');
  assert.match(out, /<h3>Part<\/h3>/);
  assert.match(out, /<table>/);
  assert.match(out, /<li><b>two<\/b><\/li>/);
  assert.match(out, /href="https:\/\/a\.com\/p\?x=1&amp;y=2"/);
  assert.ok(!out.includes('<script>'));
  assert.ok(!/href="javascript/.test(out));
});
