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
  const m = lib.merge(seed, { 'cp-11': { status: 'approved', at: 'x' }, 'cp-12': { status: 'bogus' } });
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

test('every proposal passes the house rules and belongs to a pillar', () => {
  const names = seed.pillars.map((x) => x.name);
  assert.strictEqual(seed.pillars.length, 6);
  assert.ok(seed.pillars.some((x) => x.name === 'How it arrives'));
  assert.match(seed.footer, /Free delivery within 2km\*/);
  for (const p of seed.proposals) assert.deepStrictEqual(lib.check(p, names), [], p.id);
  assert.ok(seed.story && seed.story.points.length <= 4);
  assert.ok(!/ [-\u2013\u2014] /.test(JSON.stringify(seed.story)));
  assert.ok(!/batch|reheat|ready to heat|thanksgiving|yellow tape/i.test(JSON.stringify(seed)));
});

test('check rejects batch talk, scarcity lines, thanksgiving and dashes', () => {
  const ok = { id: 'x', date: '17/11/2026', pillar: 'Play', format: 'Post', title: 't', hook: 'h', visual: 'v', caption: 'Fine caption.', why: 'w' };
  assert.deepStrictEqual(lib.check(ok, ['Play']), []);
  assert.ok(lib.check({ ...ok, caption: 'Ready to heat in minutes.' }, ['Play']).length);
  assert.ok(lib.check({ ...ok, caption: 'Only 6 shanks, when they are gone they are gone.' }, ['Play']).length);
  assert.ok(lib.check({ ...ok, title: 'Thanksgiving pot' }, ['Play']).length);
  assert.ok(lib.check({ ...ok, caption: 'Slow - and rich.' }, ['Play']).length);
  assert.ok(lib.check({ ...ok, caption: '20% off.' }, ['Play']).length);
  assert.ok(lib.check({ ...ok, caption: 'Lovely. Order direct, link in the last line.' }, ['Play']).length);
  assert.ok(lib.check({ ...ok, pillar: 'Other' }, ['Play']).length);
  assert.ok(lib.check({ ...ok, date: '2026-11-17' }, ['Play']).length);
});

test('addWeek refuses a bad proposal without writing', async () => {
  await assert.rejects(() => lib.addWeek({ proposals: [{ id: 'w1', date: '17/11/2026', pillar: 'Play', format: 'Post', title: 't', hook: 'h', visual: 'v', caption: 'Reheat it.', why: 'w' }] }), /Not added/);
  await assert.rejects(() => lib.addWeek({ proposals: [] }), /proposals list/);
});
