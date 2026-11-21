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

test('a Grab order with no customer name is flagged with a name box and the Drive folder to upload to', () => {
  const ledger = [row({ channel: 'Grab', dmy: '17/11/2026', date: d('2026-11-17'), orderNo: 'GF-140', type: 'Order', desc: 'Dark Beer Stew', customer: 'XXXXXX', key: 'G|17/11/2026|9', moneyIn: 350 })];
  const f = runChecks({ today, ledger }).find((x) => x.check === 'No customer name');
  assert.ok(f); assert.strictEqual(f.action.type, 'customer'); assert.deepStrictEqual(f.action.keys, ['G|17/11/2026|9']);
  assert.match(f.how, /Daily Screenshots, November, folder 17\/11/);
  assert.ok(f.links[0].href.includes('drive.google.com'));
});

test('unreadable items name the folder to upload to, and a name placeholder alongside is not flagged twice', () => {
  const ledger = [row({ channel: 'Grab', dmy: '17/11/2026', date: d('2026-11-17'), orderNo: 'GF-140', desc: 'XXXXXX', customer: 'XXXXXX', key: 'G1', moneyIn: 350 })];
  const out = runChecks({ today, ledger });
  const f = out.filter((x) => /GF-140/.test(x.line));
  assert.strictEqual(f.length, 1); assert.strictEqual(f[0].check, 'Unreadable item');
  assert.match(f[0].how, /folder 17\/11/);
});

test('margin links to the exact dates and rows, and states price and cost', () => {
  const ledger = [row({ type: 'Recipe', desc: 'Pierre Maison - Forever Lemon', cost: 41, channel: 'Grab' }), row({ desc: 'Pierre Maison - Forever Lemon', moneyIn: 78, channel: 'Grab' })];
  const f = runChecks({ today, ledger }).find((x) => x.check === 'Margin');
  assert.ok(f); assert.strictEqual(f.text, 'Selling price ฿78, cost ฿41. The cost is ฿10 too much.');
  assert.match(f.fix, /^reports\.html\?from=19%2F11%2F2026&to=19%2F11%2F2026&find=Pierre%20Maison/);
});

test('missing days list every date as a link, with what to do for each channel', () => {
  const ledger = [row({ channel: 'Grab', date: d('2026-11-10') }), row({ channel: 'LINE', date: d('2026-11-10') })];
  const f = runChecks({ today, ledger }).filter((x) => x.check === 'Missing days');
  const g = f.find((x) => /^Grab/.test(x.line)); const l = f.find((x) => /^LINE/.test(x.line));
  assert.ok(g.chips.length > 4); assert.ok(g.chips[0].href.startsWith('reports.html?from='));
  assert.match(g.how, /Drive/); assert.ok(g.links.length === 1);
  assert.match(l.how, /Sync LINE orders/); assert.strictEqual(l.fix, 'reports.html#tools');
});

test('receipt problems list each line so it can be fixed on the card', () => {
  const f = runChecks({
    today, ledger: [],
    expenseRows: [['Date', 'Ingredient', 'Price', 'Unit'], ['', 'Salt', '20', '500g', '', 'Tops'], ['19/11/2026', 'Butter', '90', '250g', '', ''], ['19/11/2026', 'Eggs', '60', '10pc', '', 'Tops'], ['19/11/2026', 'Eggs', '60', '10pc', '', 'Tops']],
  }).filter((x) => x.check === 'Receipts');
  const nd = f.find((x) => /no readable date/.test(x.line)); const ns = f.find((x) => /no shop/.test(x.line)); const dp = f.find((x) => /entered twice/.test(x.line));
  assert.strictEqual(nd.items[0].kind, 'date'); assert.strictEqual(nd.items[0].ref.i, 1); assert.strictEqual(nd.items[0].row.qty, '500g');
  assert.strictEqual(ns.items[0].kind, 'shop'); assert.strictEqual(ns.items[0].row.item, 'Butter');
  assert.strictEqual(dp.items[0].kind, 'delete'); assert.strictEqual(dp.items[0].ref.i, 4);
});

test('a pasta still counting reheats per order is asked for minutes', () => {
  const pcs = require('../lib/pastaCosts'); const seed = require('../data/pastaSeed.json');
  const card = pcs.clean({ ...seed.cards.find((c) => c.reheat > 0) });
  const prices = { oil: 0.05, butter: 0.4, 'utility costs - cooking': 0.18, 'utility costs - reheating': 0.43, 'packaging box (carb600ml)': 1.54 };
  const pb = { lookup: (n) => (prices[String(n).toLowerCase()] ? { cost: prices[String(n).toLowerCase()], date: '2026-11-18' } : { cost: 0.17, date: '2026-11-18' }) };
  const f = runChecks({ today, pastaCards: [{ card, cost: pcs.costCard(card, pb, today) }] }).find((x) => /reheating is still counted per order/.test(x.line));
  assert.ok(f);
});

test('the Expense Log header is not a receipt line, and three identical lines in one receipt are three items, not duplicates', () => {
  const rid = 'Typed on the web; Receipt R261117-164137; x';
  const shiraz = ['14/11/2026', 'Poco Vino - Shiraz', '199', '187ml', '1.06', 'villa', rid];
  const header = ['Shopping Date', 'Ingredient', 'Purchase Price', 'Purchase Unit', 'Cost per Recipe Unit', 'Shopped at', 'Remarks'];
  const one = runChecks({ today, expenseRows: [header, shiraz, shiraz, shiraz] }).filter((x) => x.check === 'Receipts');
  assert.strictEqual(one.length, 0);
  const again = [...shiraz]; again[6] = 'Typed on the web; Receipt R261118-090000; x';
  const two = runChecks({ today, expenseRows: [header, shiraz, again] }).filter((x) => /entered twice/.test(x.line));
  assert.strictEqual(two.length, 1); assert.strictEqual(two[0].items[0].ref.i, 2);
});
