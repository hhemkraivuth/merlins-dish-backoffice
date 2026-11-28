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
    bank: { amount: 1, asOf: '15/09/2026' },
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

test('a bank balance that covers last month is not late, even if 16 days old', () => {
  const ok = runChecks({ today, ledger: [], bank: { amount: 1, asOf: '05/11/2026' } });
  assert.ok(!ok.some((x) => x.check === 'Bank'));
});

test('Saturday and Sunday are closed days, not missing days, unless sales show up that day', () => {
  // today is Sat 21/11/2026. Sat 14/11 and Sun 15/11 have no sales on either channel. Fri 13/11 is a weekday with none.
  const ledger = [row({ channel: 'Grab', date: d('2026-11-10') }), row({ channel: 'LINE', date: d('2026-11-19') })];
  const gaps = runChecks({ today, ledger }).filter((x) => x.check === 'Missing days').map((x) => x.line).join(' ');
  assert.ok(!/14\/11|15\/11/.test(gaps), gaps);
  assert.ok(/13\/11/.test(gaps), gaps);
  // A weekend with sales on one channel is an open day, so the other channel is checked for it.
  const open = [...ledger, row({ channel: 'LINE', date: d('2026-11-14'), dmy: '14/11/2026' })];
  const grab = runChecks({ today, ledger: open }).filter((x) => x.check === 'Missing days' && /^Grab/.test(x.line)).map((x) => x.line).join(' ');
  assert.ok(/14\/11/.test(grab), grab);
});

test('a receipt line at 0 baht is flagged, each one can be ignored on its own', () => {
  const expenseRows = [['Date', 'Ingredient', 'Price'], ['10/11/2026', 'Knorr cube - pork', '0', '48pcs', '', '', 'Receipt R261110-170628'], ['10/11/2026', 'Butter', '90', '', '', 'Tops']];
  const f = runChecks({ today, expenseRows }).filter((x) => /logged at ฿0/.test(x.line));
  assert.strictEqual(f.length, 1);
  assert.match(f[0].id, /^rcpt-zero:2026-11-10\|knorrcubepork$/);
});

test('a Grab file in Imported with no Ledger rows is flagged, one that reached the books is not', () => {
  const { strandedFiles } = require('../lib/driveImport');
  const files = [{ name: 'merlins_dish_claude_log_25_11_2026.csv' }, { name: 'grab_totals_25_11_2026.csv' }, { name: 'merlins_dish_claude_log_19_11_2026.csv' }, { name: 'notes.txt' }];
  const ledger = [row({ channel: 'Grab', date: d('2026-11-19'), key: 'g19' })];
  const have = { ordersIso: new Set(['2026-11-19']), totalsIso: new Set(['2026-11-19']) };
  const stranded = strandedFiles(files, have);
  assert.deepStrictEqual(stranded.map((x) => `${x.kind}:${x.day}`), ['orders:25/11/2026', 'totals:25/11/2026']);
  const f = runChecks({ today, ledger, strandedFiles: stranded }).filter((x) => x.check === 'Grab files');
  assert.strictEqual(f.length, 2);
  assert.match(f[0].line, /order file for 25\/11 is in the Imported folder/);
  assert.match(f[0].how, /Ready for BOH/);
});

test('a stranded file on a day marked closed or no orders is not flagged', () => {
  const stranded = [{ name: 'merlins_dish_claude_log_25_11_2026.csv', day: '25/11/2026', iso: '2026-11-25', kind: 'orders' }];
  assert.strictEqual(runChecks({ today, strandedFiles: stranded, closed: new Map([['2026-11-25', 'rain']]) }).filter((x) => x.check === 'Grab files').length, 0);
  assert.strictEqual(runChecks({ today, strandedFiles: stranded, noOrders: ['Grab|2026-11-25'] }).filter((x) => x.check === 'Grab files').length, 0);
});

test('stranded files list once per day and kind even when Drive holds duplicates', () => {
  const { strandedFiles } = require('../lib/driveImport');
  const files = [{ name: 'grab_totals_25_11_2026.csv' }, { name: 'grab_totals_25_11_2026.csv' }];
  assert.strictEqual(strandedFiles(files, { ordersIso: new Set(), totalsIso: new Set() }).length, 1);
});
