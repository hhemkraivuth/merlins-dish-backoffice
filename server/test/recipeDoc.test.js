const test = require('node:test');
const assert = require('node:assert');
const { parseDoc, syncFromDoc } = require('../lib/recipeDoc');

const body = (n) => `**I. Ingredients**\n\n  - **Beef:** ${n}g Chuck Roll (3.5cm chunks)\n  - **Veg:** 550g Carrot, 480g Mushrooms\n\n**II. Method**\n\n1\\. **Sear** the beef on high heat.\n\n2\\. **Braise** for 24 minutes.`;
const DOC = `***Recipe: Mein Hans*** **Edition** (Pressure cooker)\n\n**Update: 14/10**\n\n**Red Wine Beef Stew (Target: 7R + 4L)**\n\n${body(1500)}\n\n  \n  \n\n**Update: 25/11**\n\n**Dark Beer Beef Stew (Target: 7R \\+ 4L)**\n\n${body(1600)}\n\n**Update: 26/11**\n\n**Pecorino & Broccoli Cream Soup** (Pressure Cooker)\n\n${body(500)}\n\n**Previously::**\n\n**Red Wine Beef Stew (Target: 6R + 2L)**\n\n${body(1200)}\n\n**Update: 22/8**\n\nPecorino & Broccoli Cream Soup (Pressure Cooker Edition)\n\n${body(520)}`;

test('only the current recipes above "Previously" are read, with their update dates and clean titles', () => {
  const r = parseDoc(DOC);
  assert.deepStrictEqual(r.map((x) => [x.title, x.updated]), [['Red Wine Beef Stew (Target: 7R + 4L)', '14/10'], ['Dark Beer Beef Stew (Target: 7R + 4L)', '25/11'], ['Pecorino & Broccoli Cream Soup (Pressure Cooker)', '26/11']]);
  assert.match(r[1].text, /1600g Chuck Roll/);
  assert.doesNotMatch(r[0].text, /Update:|Dark Beer/);
});

test('with no "Previously" line the newest copy of each title wins', () => {
  const doc = DOC.replace('**Previously::**', '');
  const titles = parseDoc(doc).map((x) => x.title);
  assert.strictEqual(new Set(titles.map((t) => t.toLowerCase())).size, titles.length);
});

test('syncFromDoc sends each recipe through the sync and totals the results', async () => {
  const doc = Array.from({ length: 5 }, (_, i) => `**Update: 2${i}/11**\n\n**Dish ${i}**\n\n${body(100 + i)}`).join('\n\n');
  const seen = [];
  const out = await syncFromDoc({ fetchText: async () => doc, sync: async (r) => { seen.push(r.title); return { dish: r.title, result: seen.length === 1 ? 'updated from the doc' : seen.length === 2 ? 'unchanged' : seen.length === 3 ? 'kept the BOH version' : 'new recipe added from the doc', why: 'x' }; } });
  assert.strictEqual(seen.length, 5);
  assert.deepStrictEqual([out.updated, out.unchanged, out.kept, out.added, out.errors], [1, 1, 1, 2, 0]);
});

test('a doc that reads as almost empty changes nothing', async () => {
  await assert.rejects(() => syncFromDoc({ fetchText: async () => 'nothing here', sync: async () => { throw new Error('should not run'); } }), /nothing was changed/);
});
