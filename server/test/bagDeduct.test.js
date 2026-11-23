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

const chicken = (o = {}) => ({ key: 'chickenthigh', name: 'Chicken thigh', unit: 'pcs', bags: [2, 3, 1, 7, 7, 7, 7], batch: 7, countedAt: '', ...o });

test('chicken soup takes one piece per portion by default, the 7 piece bag', () => {
  const p = planBagUse([ing('Chicken thigh', 980)], [chicken()], new Date('2026-11-24T00:00:00Z'), {}, { yield: 7 });
  assert.deepStrictEqual(p.used[0].removed, [7]);
  assert.strictEqual(p.used[0].left, 27);
  assert.match(reportLines(p)[0], /7 pcs, 27 pcs left/);
});

test('chicken typed by the bag: 7pcs 980g + 1pc 150g takes the 7 bag and the 1 bag', () => {
  const l = { ...ing('Chicken thigh', 1130), pieces: [{ n: 7, of: 0, grams: 980 }, { n: 1, of: 0, grams: 150 }] };
  const p = planBagUse([l], [chicken()], new Date('2026-11-24T00:00:00Z'), {}, { yield: 7 });
  assert.deepStrictEqual(p.used[0].removed, [7, 1]);
  assert.deepStrictEqual(p.used[0].bagsAfter.slice().sort((a, b) => a - b), [2, 3, 7, 7, 7]);
});

test('1pc of 7 leaves a 6 piece bag, and a bag size that does not exist takes nothing', () => {
  const l = { ...ing('Chicken thigh', 150), pieces: [{ n: 1, of: 7, grams: 150 }] };
  const p = planBagUse([l], [chicken()], new Date('2026-11-24T00:00:00Z'), {}, { yield: 7 });
  assert.ok(p.used[0].bagsAfter.includes(6));
  const none = planBagUse([ing('Chicken thigh', 500)], [chicken({ bags: [2, 3] })], new Date('2026-11-24T00:00:00Z'), {}, { yield: 7 });
  assert.strictEqual(none.used.length, 0);
  assert.match(none.skipped[0].reason, /no 7 piece bag/);
});

test('the piece parser and the note parser read 7pcs 980g + 1pc 150g', () => {
  const { parsePieceBags } = require('../lib/bagText');
  assert.strictEqual(parsePieceBags('7pcs 980g + 1pc 150g').grams, 1130);
  assert.strictEqual(parsePieceBags('7pcs'), null);
  const { parseNote } = require('../lib/noteParser');
  const { defaultShorthand } = require('../lib/aliases');
  const out = parseNote('24/11 chix\nchicken 7pcs 980g + 1pc 150g\nyield 7', defaultShorthand(), new Date('2026-11-24T00:00:00Z'));
  const line = out.batches.length ? out.batches[0].lines[0] : null;
  assert.ok(line && line.pieces && line.pieces.length === 2 && line.qty === 1130, JSON.stringify(out.problems));
});
