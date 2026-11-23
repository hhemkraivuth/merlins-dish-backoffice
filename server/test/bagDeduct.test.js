const test = require('node:test');
const assert = require('node:assert');
const { planBagUse, reportLines, deductForBatch, restoreForBatch, processCatchUp } = require('../lib/bagDeduct');
const { runChecks } = require('../lib/audit');

const ing = (name, qty, unit = 'g') => ({ type: 'Ingredient', name, qty, unit });
const chuck = (o = {}) => ({ key: 'beefchuck', name: 'Beef - chuck', unit: 'g', bags: [1810, 1600, 1600, 1600], countedAt: '', ...o });

test('a cook takes the best fitting bags off the Meat card', () => {
  const p = planBagUse([ing('Beef - chuck', 1600), ing('Onion', 500)], [chuck()], new Date('2026-11-20T00:00:00Z'));
  assert.strictEqual(p.used.length, 1);
  assert.deepStrictEqual(p.used[0].removed, [1600]);
  assert.strictEqual(p.used[0].left, 5010);
});

test('a count on or after the cook date wins, so nothing is taken', () => {
  const p = planBagUse([ing('Beef - chuck', 1600)], [chuck({ countedAt: '2026-11-11T16:45:00.000Z' })], new Date('2026-11-11T00:00:00Z'));
  assert.strictEqual(p.used.length, 0);
  assert.match(p.skipped[0].reason, /already includes/);
  const later = planBagUse([ing('Beef - chuck', 1600)], [chuck({ countedAt: '2026-11-11T16:45:00.000Z' })], new Date('2026-11-12T00:00:00Z'));
  assert.strictEqual(later.used.length, 1);
});

test('typed bags 900+700 take exactly those two bags, and a missing weight takes nothing', () => {
  const card = { key: 'porkmince', name: 'Pork mince', unit: 'g', bags: [900, 700, 1000, 1000], batch: 1600, countedAt: '' };
  const p = planBagUse([{ ...ing('Pork mince', 1600), parts: [900, 700] }], [card], new Date('2026-11-17T00:00:00Z'));
  assert.deepStrictEqual(p.used[0].removed, [900, 700]);
  assert.strictEqual(p.used[0].left, 2000);
  const miss = planBagUse([ing('Pork mince', 1500)], [card], new Date('2026-11-17T00:00:00Z'));
  assert.strictEqual(miss.used.length, 0);
  assert.match(miss.skipped[0].reason, /no 1,500g bag/);
});

test('it never empties the card, and says BUY when less than one batch is left', () => {
  const p = planBagUse([ing('Beef - chuck', 2000)], [chuck({ bags: [900, 800] })], new Date('2026-11-20T00:00:00Z'));
  assert.strictEqual(p.used.length, 0);
  const q = planBagUse([ing('Beef - chuck', 1600)], [chuck({ bags: [1600, 300], batch: 1600 })], new Date('2026-11-20T00:00:00Z'));
  assert.strictEqual(q.used[0].left, 300);
  assert.ok(reportLines(q).some((l) => /BUY Beef - chuck/.test(l)));
});

test('the note parser keeps 900+700 as two bags', () => {
  const { parseNote: parseNotes } = require('../lib/noteParser');
  const { defaultShorthand } = require('../lib/aliases');
  const out = parseNotes('17/11 bolo\nmeat 900+700\nyield 21', defaultShorthand(), new Date('2026-11-17T00:00:00Z'));
  const l = out.batches[0].lines[0];
  assert.strictEqual(l.qty, 1600);
  assert.deepStrictEqual(l.parts, [900, 700]);
});

test('a card counted in pieces is reported, not guessed', () => {
  const p = planBagUse([ing('Lamb - shank', 2000)], [{ key: 'lambshank', name: 'Lamb - shank', unit: 'pcs', bags: [], countedAt: '' }], new Date('2026-11-18T00:00:00Z'));
  assert.strictEqual(p.used.length, 0);
  assert.match(p.skipped[0].reason, /pcs/);
});

function memIo(initial) {
  const st = { map: JSON.parse(JSON.stringify(initial)), counts: {}, usage: {} };
  return { st, loadBags: async () => st.map, saveBags: async (m) => { st.map = m; }, stockNames: async () => new Map([['beefchuck', { itemName: 'Beef - chuck', lastUpdatedBy: 'Manual', lastUpdated: '2026-11-11T16:45:00.000Z' }]]), loadLinks: async () => ({}), setCount: async (n, c) => { st.counts[n] = c; }, loadUsage: async () => st.usage, saveUsage: async (k, e) => { st.usage[k] = e; }, saveAllUsage: async (a) => { st.usage = a; }, readTab: async () => [] };
}

test('deduct then delete puts the bags back exactly', async () => {
  const io = memIo({ beefchuck: { bags: [1810, 1600, 1600, 1600], unit: 'g', batch: 1600 } });
  const out = await deductForBatch({ lines: [ing('Beef - chuck', 1600)], date: new Date('2026-11-20T00:00:00Z') }, 'k1', io);
  assert.match(out[0], /Meat bags used: Beef - chuck 1,600g/);
  assert.strictEqual(io.st.counts['Beef - chuck'], 5010);
  assert.strictEqual(io.st.map.beefchuck.bags.length, 3);
  const back = await restoreForBatch('k1', io);
  assert.match(back[0], /put back/);
  assert.strictEqual(io.st.counts['Beef - chuck'], 6610);
  assert.deepStrictEqual(io.st.usage, {});
});

test('catch up preview lists missed batches and apply clears them', async () => {
  const io = memIo({ beefchuck: { bags: [1810, 1600, 1600, 1600], unit: 'g', batch: 1600 } });
  io.readTab = async (t) => (t === 'Cook Log' ? [['Key'], ['k9', '20/11/2026', 'Red Wine Beef Stew', 10]] : t === 'Cook Log Lines' ? [['Key'], ['k9', '20/11/2026', 'Red Wine Beef Stew', 'Ingredient', 'Beef - chuck', '1600', 'g']] : []);
  const dates = require('../lib/dates');
  const orig = dates.bangkokToday; dates.bangkokToday = () => new Date('2026-11-23T00:00:00Z');
  try {
    const prev = await processCatchUp('catch up meat', io);
    assert.match(prev[0], /Red Wine Beef Stew/);
    assert.strictEqual(io.st.map.beefchuck.bags.length, 4);
    const done = await processCatchUp('catch up meat apply', io);
    assert.match(done[0], /caught up/);
    assert.strictEqual(io.st.map.beefchuck.bags.length, 3);
    assert.match((await processCatchUp('catch up meat', io))[0], /Nothing to catch up/);
  } finally { dates.bangkokToday = orig; }
});

test('the Audit flags a batch that never took its meat off', () => {
  const f = runChecks({ today: new Date('2026-11-23T00:00:00Z'), meatGaps: [{ key: 'k9', dish: 'Red Wine Beef Stew', dmy: '20/11/2026', names: ['Beef - chuck'] }] });
  assert.ok(f.some((x) => x.id === 'meatgap:k9' && /never went down/.test(x.line)));
});
