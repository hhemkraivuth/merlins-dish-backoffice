const test = require('node:test');
const assert = require('node:assert');
const { pinnedFor } = require('../lib/pinned');

test('Christmas note shows from 23/11/2026 and names the current phase', () => {
  const p = pinnedFor('2026-11-23');
  assert.strictEqual(p.length, 1);
  assert.match(p[0].lines[0], /^Now: Christmas decorations\./);
  assert.ok(p[0].lines.some((l) => l.includes('13/12/2026 to 25/12/2026: Christmas and New Year together')));
  assert.ok(p[0].lines.some((l) => l.includes('26/12/2026 to 15/01/2027: New Year only')));
});

test('phase changes on 13/12 and 26/12', () => {
  assert.match(pinnedFor('2026-12-13')[0].lines[0], /Christmas and New Year together/);
  assert.match(pinnedFor('2026-12-25')[0].lines[0], /Christmas and New Year together/);
  assert.match(pinnedFor('2026-12-26')[0].lines[0], /New Year only/);
});

test('note is gone before 23/11/2026 and after 15/01/2027', () => {
  assert.strictEqual(pinnedFor('2026-11-22').length, 0);
  assert.strictEqual(pinnedFor('2027-01-15').length, 1);
  assert.strictEqual(pinnedFor('2027-01-16').length, 0);
});
