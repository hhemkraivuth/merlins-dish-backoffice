const test = require('node:test');
const assert = require('node:assert');
const recipeStore = require('../lib/recipeStore');
const botAdmin = require('../lib/botAdmin');
const { buildAnalysis } = require('../lib/analysis');
const { utc } = require('../lib/dates');

test('recipeStore.merge: newest edit wins, history counted, category guessed', () => {
  const seed = { dishes: [{ dish: 'Red Wine Beef Stew', title: 'Stew', lines: ['a'], updated: '01/10/2026' }, { dish: 'Creamy Chicken Soup', title: 'Soup', lines: ['s'] }] };
  const rows = [['Dish', 'Category', 'Title', 'Text', 'Saved'], ['Red Wine Beef Stew', 'Stews', 'Stew', 'one', '2026-11-01T00:00:00Z'], ['Red Wine Beef Stew', 'Stews', 'Stew v2', 'two\nlines', '2026-11-05T00:00:00Z']];
  const out = recipeStore.merge(seed, rows);
  const stew = out.dishes.find((d) => d.dish === 'Red Wine Beef Stew');
  assert.deepStrictEqual(stew.lines, ['two', 'lines']);
  assert.strictEqual(stew.versions, 2);
  assert.strictEqual(out.dishes.find((d) => d.dish === 'Creamy Chicken Soup').category, 'Soups');
});

test('botAdmin.stateFromPublic is read only and lists the menu', () => {
  const st = botAdmin.stateFromPublic({ items: [{ id: 'a', name: 'Ragu', price: 200, category: 'Pasta' }], categories: ['Pasta'] }, { isOpen: true });
  assert.strictEqual(st.readOnly, true);
  assert.strictEqual(st.menu[0].price, 200);
});

test('analysis: Aug and Sep come from the Master Log', () => {
  const master = [['Date', 'Desc', 'Branch', 'Order from', 'Type', 'QTY', 'Money In', 'Cost', 'Net', 'Customer', 'Order No'],
    ['05/08/2026', 'Polished Pork Bolognese', 'Grab', '', 'Order', 1, 300, '', 300, '', 'A1'],
    ['', 'Rigatoni (paired with Polished Pork Bolognese)', 'Grab', '', 'Order', 1, 60, '', 60, '', 'A1'],
    ['12/09/2026', 'Noir Ragu', 'LINE', 'Alice', 'Order', 2, 280, '', 560, 'Alice', 'L1']];
  const r = buildAnalysis({ weekly: [], monthly: [], ledger: [], today: utc(2026, 11, 7), master });
  assert.deepStrictEqual(r.months.map((m) => m.label), ['08/2026', '09/2026']);
  assert.strictEqual(r.months[0].orders, 1);
  assert.ok(r.months[0].margin !== null);
  assert.strictEqual(r.weeks[0].margin, null);
  assert.deepStrictEqual(r.mix.map((m) => m.month), ['2026-08', '2026-09']);
  assert.strictEqual(r.heatmap.total, 2);
});

test('analysis: food cost and repeat customers for Aug and Sep from the Master Log', () => {
  const master = [['Date', 'Desc', 'Branch', 'Order from', 'Type', 'QTY', 'Money In', 'Cost', 'Net', 'Customer', 'Order No'],
    ['05/08/2026', 'Noir Ragu', 'LINE', 'IG', 'Order', 1, 280, '', 280, 'Alice', 'L1'],
    ['06/08/2026', 'Noir Ragu', 'Grab', '', 'Recipe', 1, '', 90, -90, '', ''],
    ['12/09/2026', 'Noir Ragu', 'LINE', 'IG', 'Order', 1, 280, '', 280, 'Alice', 'L2']];
  const r = buildAnalysis({ weekly: [], monthly: [], ledger: [], today: utc(2026, 11, 7), master });
  assert.strictEqual(r.months[0].foodCost, 90);
  assert.strictEqual(r.months[0].newOrders, 1);
  assert.strictEqual(r.months[1].repeatOrders, 1);
});

test('grammar.parseReply keeps unchanged keys and reports changes', () => {
  const { parseReply } = require('../lib/grammar');
  const orig = { headline: 'Were closed', body: 'Same.' };
  const r = parseReply('{"fields":{"headline":"We\'re closed"},"notes":["Added apostrophe"]}', orig);
  assert.strictEqual(r.fields.headline, "We're closed");
  assert.strictEqual(r.fields.body, 'Same.');
  assert.strictEqual(r.changed, true);
  assert.throws(() => parseReply('nope', orig));
});

test('menuBible.merge: seed, edits and deletes', () => {
  const mb = require('../lib/menuBible');
  const seed = { categories: ['Stews'], items: [{ name: 'Red Wine Beef Stew', category: 'Stews', th: 'a', en: 'b' }, { name: 'Dark Beer Stew', category: 'Stews', th: 'c', en: 'd' }] };
  const rows = [['Item', 'Category', 'Fields', 'Saved', 'Deleted'],
    ['Red Wine Beef Stew', 'Stews', JSON.stringify({ th: 'a2', en: 'b' }), '2026-11-07T00:00:00Z', ''],
    ['Dark Beer Stew', '', '', '2026-11-07T01:00:00Z', '1'],
    ['Cheesecake', 'Dessert', JSON.stringify({ en: 'Sweet' }), '2026-11-07T02:00:00Z', '']];
  const out = mb.merge(seed, rows);
  assert.deepStrictEqual(out.items.map((i) => i.name), ['Red Wine Beef Stew', 'Cheesecake']);
  assert.strictEqual(out.items[0].th, 'a2');
  assert.ok(out.categories.includes('Dessert'));
  const real = mb.merge(require('../data/menuBible.json'));
  assert.ok(real.items.length >= 30);
});
