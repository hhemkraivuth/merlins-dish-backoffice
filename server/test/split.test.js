const test = require('node:test');
const assert = require('node:assert');
const { plan, rowsToWrite } = require('../lib/splitOrder');
const { COL } = require('../lib/ledger');

const d = new Date('2026-11-17T00:00:00Z');
const order = { key: 'G|1', type: 'Order', channel: 'Grab', desc: 'XXXXXX', qty: 1, moneyIn: 350, date: d, dmy: '17/11/2026' };
const ledger = [{ type: 'Order', desc: 'Dark Beer Stew', moneyIn: 295, qty: 1, date: d }];

test('Dbs + tubet on a 350 order becomes stew 295 and Tubetti 55', () => {
  const p = plan(order, 'Dbs + tubet', ledger);
  assert.ifError(p.error);
  assert.deepStrictEqual(p.items.map((i) => [i.desc, i.price]), [['Dark Beer Stew', 295], ['Tubetti', 55]]);
});

test('rows to write: edit the order, add Tubetti, reuse the placeholder Recipe row', () => {
  const p = plan(order, 'dbs + tubet', ledger);
  const raw = new Array(14).fill(''); raw[COL.date] = '17/11/2026';
  const w = rowsToWrite(order, [{ key: 'G|2', type: 'Recipe' }], p, raw, COL);
  assert.strictEqual(w.edits[0].changes.desc, 'Dark Beer Stew');
  assert.strictEqual(w.edits[0].changes.moneyIn, 295);
  assert.deepStrictEqual(w.edits[1], { key: 'G|2', changes: { desc: 'Tubetti', cost: '', net: '' } });
  assert.strictEqual(w.adds.length, 1);
  assert.strictEqual(w.adds[0][COL.desc], 'Tubetti');
  assert.strictEqual(w.adds[0][COL.moneyIn], 55);
  assert.strictEqual(w.adds[0][COL.type], 'Order');
  assert.strictEqual(w.deletes.length, 0);
});

test('a stew with no pasta deletes the placeholder Recipe row', () => {
  const o = { ...order, moneyIn: 295 };
  const p = plan(o, 'dbs', ledger);
  const raw = new Array(14).fill(''); raw[COL.date] = '17/11/2026';
  const w = rowsToWrite(o, [{ key: 'G|2', type: 'Recipe' }], p, raw, COL);
  assert.deepStrictEqual(w.deletes, ['G|2']);
});

test('ragu with radiatori is a 5 baht bundle', () => {
  const o = { ...order, moneyIn: 250 };
  const p = plan(o, 'ragu + radiatori', ledger);
  assert.ifError(p.error);
  assert.deepStrictEqual(p.items.map((i) => i.price), [245, 5]);
  assert.match(p.items[1].desc, /Radiatori \(Ragu bundle\)/);
});

test('unknown words and totals that do not add up are refused, nothing guessed', () => {
  assert.match(plan(order, 'banana', ledger).error, /don't know/);
  const two = plan({ ...order, moneyIn: 100 }, 'tubet + radiatori', ledger);
  assert.match(two.error, /add up to/);
});
