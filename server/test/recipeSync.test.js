const test = require('node:test');
const assert = require('node:assert');
const { sync, tidyText, findDish, docDate } = require('../lib/recipeSync');
const seed = require('../data/recipes.json');
const recipeStore = require('../lib/recipeStore');

const NOW = () => new Date('2026-11-26T08:00:00Z');
function rig(rows = [], state = {}) {
  const saves = []; const st = { ...state };
  return {
    saves, st,
    deps: {
      now: NOW,
      load: async () => recipeStore.merge(seed, rows),
      save: async (o) => { saves.push(o); },
      appState: { getState: async (k) => (st[k] === undefined ? '' : st[k]), setState: async (k, v) => { st[k] = v; } },
    },
  };
}
const LONG = '**I. Ingredients**\n\n  - **Beef:** 1,600g Chuck Roll (3.5cm chunks, salted)\n  - **Veg:** 625g Potato, 450g Carrot, 220g Frozen Peas\n\n**II. Method**\n\n1\\. **Sear chuck roll** in a skillet over high heat.\n\n2\\. **Braise:** Run High Pressure for **24 minutes**.';

test('every dish title in the doc finds its BOH recipe, including the renamed ones', () => {
  const dishes = seed.dishes;
  const want = {
    'Red Wine Beef Stew (Target: 7R + 4L)': 'Red Wine Beef Stew', 'Dark Beer Beef Stew (Target: 7R \\+ 4L)': 'Dark Beer Beef Stew',
    'Polished Pork Bolognese': 'Polished Pork Bolognese', 'Noir Ragù': 'Noir Ragù', 'Tuscan Pork Braise': 'Tuscan Pork Braise',
    'Pecorino & Broccoli Cream Soup': 'Pecorino & Broccoli Cream Soup', 'Creamy Chicken Comfort Soup (Pressure Cooker Edition)': 'Creamy Chicken Comfort Soup',
    'Bacon Pomodoro': 'Spicy Rosso', 'Braised Lamb Shanks (4 Portions)': 'Slow-Braised Lamb Shank', 'Spicy Sausage Cream Ragù': 'Spicy Sausage Cream Ragù',
  };
  for (const [t, d] of Object.entries(want)) assert.strictEqual((findDish(t, dishes) || {}).dish, d, t);
  assert.strictEqual(findDish('Brand New Dish', dishes), null);
});

test('Google export markdown is put in the style the Recipes page shows', () => {
  assert.strictEqual(tidyText('  - **Beef:** 1,500g\n\n1\\. **Render** bacon\n<!-- end list -->\nPortion x'), '* **Beef:** 1,500g\n1. **Render** bacon\nPortion x');
});

test('a changed recipe is saved under the BOH dish name with the doc title', async () => {
  const { saves, st, deps } = rig();
  const out = await sync({ title: 'Dark Beer Beef Stew (Target: 7R + 4L)', updated: '25/11', text: LONG }, deps);
  assert.strictEqual(out.result, 'updated from the doc');
  assert.strictEqual(saves.length, 1);
  assert.strictEqual(saves[0].dish, 'Dark Beer Beef Stew');
  assert.match(saves[0].text, /^\*\*I\. Ingredients\*\*\n\* \*\*Beef:\*\*/);
  assert.ok(JSON.parse(st.recipe_sync_state).darkbeerbeefstew);
});

test('the same recipe a week later is unchanged and saves nothing', async () => {
  const first = rig();
  await sync({ title: 'Dark Beer Beef Stew', updated: '25/11', text: LONG }, first.deps);
  const rows = [['Dish'], ['Dark Beer Beef Stew', 'Stews', 'Dark Beer Beef Stew', first.saves[0].text, '2026-11-26T01:00:00.000Z']];
  const again = rig(rows, first.st);
  const out = await sync({ title: 'Dark Beer Beef Stew', updated: '25/11', text: LONG }, again.deps);
  assert.strictEqual(out.result, 'unchanged');
  assert.strictEqual(again.saves.length, 0);
});

test('a recipe edited on the BOH page since the last sync is kept and reported, unless forced', async () => {
  const first = rig();
  await sync({ title: 'Dark Beer Beef Stew', updated: '25/11', text: LONG }, first.deps);
  const rows = [['Dish'], ['Dark Beer Beef Stew', 'Stews', 'Dark Beer Beef Stew', first.saves[0].text + '\n* Lily added a note', '2026-11-27T01:00:00.000Z']];
  const changed = LONG.replace('24 minutes', '26 minutes');
  const kept = rig(rows, first.st);
  const out = await sync({ title: 'Dark Beer Beef Stew', updated: '27/11', text: changed }, kept.deps);
  assert.strictEqual(out.result, 'kept the BOH version');
  assert.strictEqual(kept.saves.length, 0);
  const forced = rig(rows, first.st);
  assert.strictEqual((await sync({ title: 'Dark Beer Beef Stew', updated: '27/11', text: changed, force: true }, forced.deps)).result, 'updated from the doc');
});

test('a dish not in BOH is added, and almost empty text is refused', async () => {
  const { saves, deps } = rig();
  const out = await sync({ title: 'Mushroom Stroganoff (6 Portions)', updated: '26/11', text: LONG }, deps);
  assert.strictEqual(out.result, 'new recipe added from the doc');
  assert.strictEqual(saves[0].dish, 'Mushroom Stroganoff');
  await assert.rejects(() => sync({ title: 'Dark Beer Beef Stew', text: '* x' }, rig().deps), /almost no text/);
});

test('doc dates get the right year', () => {
  assert.strictEqual(docDate('25/11', NOW()).getUTCFullYear(), 2026);
  assert.strictEqual(docDate('2/12', NOW()).getUTCFullYear(), 2025);
});
