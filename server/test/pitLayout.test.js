const test = require('node:test');
const assert = require('node:assert');
const pit = require('../lib/pitLayout');

test('an empty or broken layout falls back to automatic with nothing placed', () => {
  assert.deepStrictEqual(pit.sanitise(undefined), { theme: 'auto', items: [] });
  assert.deepStrictEqual(pit.sanitise('nope'), { theme: 'auto', items: [] });
  assert.deepStrictEqual(pit.sanitise({ theme: 'summer', items: 5 }), { theme: 'auto', items: [] });
});

test('themes are kept, unknown decorations and bad positions are dropped, positions are clamped', () => {
  const v = pit.sanitise({ theme: 'christmas', items: [
    { t: 'tree', x: 20.04, y: 100 },
    { t: 'dragon', x: 5, y: 5 },
    { t: 'gift', x: 'a', y: 5 },
    { t: 'heart', x: 500, y: -9 },
    null,
  ] });
  assert.strictEqual(v.theme, 'christmas');
  assert.deepStrictEqual(v.items, [{ t: 'tree', x: 20, y: 100 }, { t: 'heart', x: 192, y: 0 }]);
});

test('no more than the maximum number of decorations are kept', () => {
  const many = Array.from({ length: 200 }, () => ({ t: 'plant', x: 10, y: 10 }));
  assert.strictEqual(pit.sanitise({ items: many }).items.length, pit.MAX_ITEMS);
});
