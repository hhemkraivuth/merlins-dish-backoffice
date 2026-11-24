const test = require('node:test');
const assert = require('node:assert');
const h = require('../lib/stockHidden');

const mem = (start) => { const m = start ? { stock_hidden: JSON.stringify(start) } : {}; return { getState: async (k) => m[k] || '', setState: async (k, v) => { m[k] = v; } }; };

test('starts with the fresh produce Lily picked, and matches names loosely', async () => {
  const hidden = h.setOf(await h.load(mem()));
  for (const n of ['Onion', 'Mushroom white', 'Mushroom - white', 'milk', 'Garlic (local)']) assert.ok(h.isHidden(n, hidden), n);
  for (const n of ['Butter', 'Cheese - Pecorino', 'Onion powder', 'Cream']) assert.ok(!h.isHidden(n, hidden), n);
});

test('hide and bring back by text command', async () => {
  const store = mem();
  assert.match((await h.processHidden('bring back onion', store))[0], /Onion is back on the Stock page/);
  assert.ok(!h.isHidden('Onion', await h.load(store)));
  assert.ok(h.isHidden('Carrot', await h.load(store)));
  assert.match((await h.processHidden('hide butter', store))[0], /Butter is off the Stock page/);
  assert.ok(h.isHidden('Butter', await h.load(store)));
  assert.match((await h.processHidden('bring back sugar', store))[0], /not hidden/);
  assert.match((await h.processHidden('hidden', store))[0], /Hidden for now: .*Butter/);
  await h.processHidden('bring back all', store);
  assert.deepStrictEqual(await h.load(store), []);
});

test('other messages are not taken as hide commands', async () => {
  assert.strictEqual(await h.processHidden('Bolo yield 20', mem()), null);
  assert.strictEqual(await h.processHidden('catch up meat', mem()), null);
});
