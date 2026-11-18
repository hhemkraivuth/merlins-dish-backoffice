const test = require('node:test');
const assert = require('node:assert');
const { mirrorBotCounts } = require('../lib/readyCount');
const { defaultShorthand } = require('../lib/aliases');

function deps(existing = [], last = {}) {
  const rows = []; const state = { last };
  return {
    rows, state,
    loadShorthand: async () => defaultShorthand(), ensureTab: async () => {}, appendRows: async (t, r) => rows.push(...r),
    readRows: async () => existing, loadMirrored: async () => state.last, saveMirrored: async (m) => { state.last = m; },
  };
}
// 03:00 Bangkok on 18/11 is 20:00 UTC on 17/11
const snap = { takenAt: '2026-11-17T20:00:00.000Z', items: [
  { name: 'Tuscan Pork Braise', left: 2, soldOut: false, sizes: [] },
  { name: 'Pecorino & Broccoli Cream Soup', left: null, soldOut: true, sizes: [] },
  { name: 'Dark Beer Stew', left: null, soldOut: false, sizes: [{ name: 'Regular', left: 7 }, { name: 'Large', left: 3 }] },
  { name: 'Coke Original', left: 5, soldOut: false, sizes: [] },
] };

test('the bot counts become Ready Counts rows, dated the service day that just closed', async () => {
  const d = deps();
  const out = await mirrorBotCounts(snap, d);
  const by = Object.fromEntries(d.rows.map((r) => [r[0], r]));
  assert.strictEqual(by['Tuscan Pork Braise'][1], 2);
  assert.strictEqual(by['Pecorino & Broccoli Cream Soup'][1], 0);
  assert.strictEqual(by['Dark beer Stew'][1], 10);
  assert.strictEqual(by['Dark beer Stew'][4], '7r 3l');
  assert.strictEqual(by['Tuscan Pork Braise'][2], '17/11/2026');
  assert.ok(!by['Coke Original'], 'drinks stay with the order app');
  assert.strictEqual(out.saved.length, 3);
});

test('a number that has not changed since last time is not saved again', async () => {
  const d = deps([], { 'Tuscan Pork Braise': 2, 'Pecorino & Broccoli Cream Soup': 0, 'Dark beer Stew': 10 });
  await mirrorBotCounts(snap, d);
  assert.strictEqual(d.rows.length, 0);
});

test('a newer count typed in BOH is left alone', async () => {
  const d = deps([['Dish', 'Count', 'Counted on', 'Logged at'], ['Tuscan Pork Braise', 5, '18/11/2026', 'x']]);
  await mirrorBotCounts(snap, d);
  assert.ok(!d.rows.some((r) => r[0] === 'Tuscan Pork Braise'));
});
