const test = require('node:test');
const assert = require('node:assert');
const lib = require('../lib/contentPlan');
const seed = require('../data/contentPlan.json');

test('seed plan has unique ids, required fields and house rules', () => {
  const ids = new Set();
  for (const p of seed.proposals) {
    assert.ok(!ids.has(p.id)); ids.add(p.id);
    for (const k of ['date', 'pillar', 'format', 'title', 'hook', 'visual', 'caption', 'borrow', 'avoid']) assert.ok(p[k], `${p.id} ${k}`);
    assert.ok(!/secret recipe/i.test(JSON.stringify(p)));
    assert.ok(!/%/.test(p.caption), `${p.id} caption has a percentage`);
    assert.ok(!/ [-–—] /.test(p.caption + p.hook), `${p.id} dash joins clauses`);
  }
  assert.ok(seed.analysis.borrow.length >= 5 && seed.analysis.avoid.length >= 5);
});

test('merge defaults to proposed and applies saved decisions', () => {
  const m = lib.merge(seed, { 'cp-01': { status: 'approved', at: 'x' }, 'cp-02': { status: 'bogus' } });
  assert.strictEqual(m.proposals[0].status, 'approved');
  assert.strictEqual(m.proposals[1].status, 'proposed');
});

test('setStatus rejects unknown status', async () => {
  await assert.rejects(() => lib.setStatus({ id: 'cp-01', status: 'maybe' }), /Status must be/);
});

test('savePlan validates proposals', async () => {
  await assert.rejects(() => lib.savePlan({ plan: { proposals: [] } }), /proposals list/);
  await assert.rejects(() => lib.savePlan({ plan: { proposals: [{ id: 'a', title: 't' }, { id: 'a', title: 't' }] } }), /used twice/);
  await assert.rejects(() => lib.savePlan({ plan: { proposals: [{ id: 'BAD ID', title: 't' }] } }), /short id/);
});
