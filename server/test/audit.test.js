const test = require('node:test');
const assert = require('node:assert');
const { runChecks, view, ignore, summarise, sundayLine } = require('../lib/audit');

const today = new Date('2026-11-21T00:00:00Z');
const d = (s) => new Date(`${s}T00:00:00Z`);
const row = (o) => ({ date: d('2026-11-19'), dmy: '19/11/2026', desc: '', channel: 'LINE', type: 'Order', qty: 1, moneyIn: 0, cost: null, net: null, key: '', ...o });
const memStore = () => { const m = {}; return { getState: async (k) => m[k] || '', setState: async (k, v) => { m[k] = v; } }; };

test('sold with no cost is flagged with the money at risk', () => {
  const ledger = [row({ desc: 'Mystery Dish', moneyIn: 120, qty: 2 })];
  const f = runChecks({ today, ledger }).find((x) => x.check === 'Sold with no cost');
  assert.ok(f); assert.strictEqual(f.baht, 120);
});

test('food cost over 40% is flagged, under is not', () => {
  const costed = (price) => [row({ type: 'Recipe', desc: 'Stew', cost: 50, qty: 1, channel: 'Grab' }), row({ desc: 'Stew', moneyIn: price, qty: 1 })];
  assert.ok(runChecks({ today, ledger: costed(100) }).some((x) => x.check === 'Margin'));
  assert.ok(!runChecks({ today, ledger: costed(200) }).some((x) => x.check === 'Margin'));
});

test('duplicate ledger keys, missing days, receipts, bank and stock', () => {
  const ledger = [row({ key: 'a', moneyIn: 80 }), row({ key: 'a', moneyIn: 80 }), row({ channel: 'Grab', date: d('2026-11-10'), key: 'g' })];
  const f = runChecks({
    today, ledger,
    expenseRows: [['Date', 'Ingredient', 'Price'], ['19/11/2026', 'Butter', '90', '', '', ''], ['19/11/2026', 'Eggs', '60', '', '', 'Tops'], ['19/11/2026', 'Eggs', '60', '', '', 'Tops']],
    bank: { amount: 1, asOf: '01/11/2026' },
    stock: [{ dish: 'Bolo', remaining: -2 }, { dish: 'Ragu', remaining: 4, oldestAgeDays: 7 }],
    cookBatches: [{ date: d('2026-11-18'), dish: 'Stew', portions: 0 }],
  });
  const checks = f.map((x) => x.check);
  for (const c of ['Totals', 'Missing days', 'Receipts', 'Bank', 'Stock']) assert.ok(checks.includes(c), c);
  assert.ok(f.some((x) => /no shop/.test(x.line) && x.baht === 90));
  assert.ok(f.some((x) => /entered twice/.test(x.line)));
  assert.ok(f.some((x) => /oversold/.test(x.line)) && f.some((x) => /Flash sale/.test(x.line)) && f.some((x) => /no yield/.test(x.line)));
});

test('a closed day is not a missing day', () => {
  const ledger = [row({ channel: 'Grab', date: d('2026-11-10') })];
  const closed = new Map([['2026-11-12', 'holiday'], ['2026-11-13', 'x'], ['2026-11-14', 'x'], ['2026-11-15', 'x'], ['2026-11-16', 'x'], ['2026-11-17', 'x'], ['2026-11-18', 'x'], ['2026-11-11', 'x'], ['2026-11-09', 'x'], ['2026-11-08', 'x'], ['2026-11-07', 'x']]);
  const f = runChecks({ today, ledger, closed }).filter((x) => x.check === 'Missing days');
  assert.ok(!f.some((x) => /12\/11/.test(x.line)));
});

test('ignore hides a finding for good, summary lights', async () => {
  const store = memStore();
  await store.setState('audit_latest', JSON.stringify({ ranAt: '2026-11-21T00:00:00Z', findings: [{ id: 'a', check: 'X', line: 'one', baht: 10 }, { id: 'b', check: 'X', line: 'two', baht: 0 }] }));
  assert.strictEqual((await view(null, store)).count, 2);
  const v = await ignore('a', { store });
  assert.strictEqual(v.count, 1); assert.strictEqual(v.ignored, 1);
  assert.strictEqual(summarise([]).light, 'green');
  assert.strictEqual(summarise(new Array(5).fill({})).light, 'red');
  assert.match(sundayLine(v), /1 to review/);
});

test('unreadable XXXXXX items get a split action, not a cost request', () => {
  const ledger = [row({ channel: 'Grab', desc: 'XXXXXX', moneyIn: 350, key: 'k1', orderNo: 'GF-1' }), row({ channel: 'Grab', type: 'Recipe', desc: 'XXXXXX', key: 'k2', orderNo: '' })];
  const f = runChecks({ today, ledger });
  const u = f.find((x) => x.check === 'Unreadable item');
  assert.ok(u && u.action.type === 'split' && u.baht === 350);
  assert.ok(!f.some((x) => x.check === 'Sold with no cost'));
});

test('bundled noodles at 5 baht are not judged on food cost, and a plain item gets a cost box', () => {
  const ledger = [
    row({ type: 'Recipe', desc: 'Radiatori', cost: 7.05, channel: 'Grab' }),
    row({ desc: 'Radiatori (Ragu bundle)', moneyIn: 5, qty: 1, channel: 'Grab' }),
    row({ desc: 'Lemon Soda', moneyIn: 60, qty: 2 }),
  ];
  const f = runChecks({ today, ledger });
  assert.ok(!f.some((x) => x.check === 'Margin'));
  const n = f.find((x) => x.check === 'Sold with no cost');
  assert.ok(n && n.action.type === 'cost' && n.action.name === 'Lemon Soda');
});
