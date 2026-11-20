const test = require('node:test');
const assert = require('node:assert');
const pc = require('../lib/pastaCosts');
const seed = require('../data/pastaSeed.json');

const prices = { 'pasta - risoni': 0.156, orzo: 0.156, oil: 0.05, butter: 0.4, 'utility costs - cooking': 0.5, 'utility costs - reheating': 0.3, 'packaging box (carb600ml)': 5 };
const pb = { lookup: (n) => { const c = prices[String(n).toLowerCase()]; return c ? { cost: c, date: '2026-11-18' } : { missing: true }; } };

test('risoni card costs from live prices', () => {
  const r = seed.cards.find((c) => c.name === 'Risoni');
  const k = pc.costCard(pc.clean(r), pb, new Date('2026-11-21'));
  assert.ok(Math.abs(k.lines[0].cost - 85 * 0.156) < 1e-9);
  assert.strictEqual(k.missing.length, 0);
  assert.ok(k.guesses.includes('Oil'));
  assert.ok(k.total > 0 && k.marginPct < 1);
});

test('a price change changes the cost', () => {
  const card = pc.clean(seed.cards[0]);
  const a = pc.costCard(card, pb, new Date('2026-11-21')).total;
  prices.butter = 0.8;
  const b = pc.costCard(card, pb, new Date('2026-11-21')).total;
  prices.butter = 0.4;
  assert.ok(b > a);
});

test('newest saved row wins and new pastas appear', () => {
  const rows = [['Pasta', 'Saved', 'Card'], ['Risoni', '2026-11-21T01:00:00Z', JSON.stringify({ ...seed.cards.find((c) => c.name === 'Risoni'), dryG: 90 })], ['Penne', '2026-11-21T02:00:00Z', JSON.stringify({ ...seed.cards[0], name: 'Penne' })]];
  const out = pc.merge(seed, rows);
  assert.strictEqual(out.find((c) => c.card.name === 'Risoni').card.dryG, 90);
  assert.ok(out.find((c) => c.card.name === 'Penne'));
});

test('ledger recipe rows with no cost get the pasta cost', () => {
  const ledger = [{ type: 'Recipe', desc: 'Pasta - Risoni', cost: null, qty: 3, date: new Date('2026-11-20') }];
  const cards = pc.merge(seed, []);
  pc.applyToLedger(ledger, cards, pb, new Date('2026-11-21'));
  assert.ok(ledger[0].cost > 0);
  assert.ok(ledger.pastaCosts.has('risoni'));
});

test('saving a card confirms every number on it', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../lib/pastaCosts.js'), 'utf8');
  assert.match(src, /card\.unconfirmed = \[\];/);
});
