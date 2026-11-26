const test = require('node:test');
const assert = require('node:assert');
const { run } = require('../lib/captionCheck');

const fake = (reply) => ({ messages: { create: async () => ({ content: [{ text: JSON.stringify(reply) }] }) } });

test('a caption with a typo comes back with a suggestion and notes', async () => {
  const out = await run('Slow braised for hours, delivred to your door.', fake({ fields: { caption: 'Slow braised for hours, delivered to your door.' }, notes: ['Fixed spelling of delivered'] }));
  assert.strictEqual(out.changed, true);
  assert.strictEqual(out.suggestion, 'Slow braised for hours, delivered to your door.');
  assert.deepStrictEqual(out.notes, ['Fixed spelling of delivered']);
});

test('a clean caption comes back unchanged', async () => {
  const out = await run('Hungry for something slow?', fake({ fields: { caption: 'Hungry for something slow?' }, notes: [] }));
  assert.strictEqual(out.changed, false);
});

test('an empty caption is not sent anywhere', async () => {
  const out = await run('   ', { messages: { create: async () => { throw new Error('should not be called'); } } });
  assert.strictEqual(out.changed, false);
});

const voice = require('../lib/voiceCheck');
const seq = (...replies) => { let i = 0; return { messages: { create: async () => ({ content: [{ text: JSON.stringify(replies[Math.min(i++, replies.length - 1)]) }] }) } }; };

test('house rules are caught instantly without Claude', () => {
  const hits = voice.rulesHit('Our batch is reheated, cooked at home - only 6 left! 20% off');
  for (const w of ['batches', 'cooked at home', 'stock', 'percentages', 'dash']) assert.ok(hits.some((h) => h.includes(w)), w);
});

test('a warm caption is on voice', async () => {
  const out = await voice.check('Slow braised for hours. Hungry yet? Tap Order and we will deliver.', seq({ onVoice: true, notes: [], rewrite: '' }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.rewrite, '');
});

test('a flat caption is flagged with a rewrite', async () => {
  const out = await voice.check('Lamb shank available. Order now.', seq({ onVoice: false, notes: ['Reads like a spec sheet'], rewrite: 'Fall off the bone, hungry for more? Tap Order.' }));
  assert.strictEqual(out.ok, false);
  assert.deepStrictEqual(out.notes, ['Reads like a spec sheet']);
  assert.ok(out.rewrite);
});

test('if Claude cannot be reached the house rules still answer', async () => {
  const dead = { messages: { create: async () => { throw new Error('down'); } } };
  const bad = await voice.check('Freshly frozen goodness', dead);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.unchecked, true);
  const fine = await voice.check('Slow braised, delivered hot.', dead);
  assert.strictEqual(fine.ok, true);
  assert.strictEqual(fine.unchecked, true);
});

test('captionCheck returns grammar and voice together, and voiceOnly skips grammar', async () => {
  const both = await run('Hungry?', seq({ fields: { caption: 'Hungry?' }, notes: [] }, { onVoice: true, notes: [], rewrite: '' }));
  assert.ok(both.voice && both.voice.ok);
  const only = await run('Hungry?', seq({ onVoice: true, notes: [], rewrite: '' }), { voiceOnly: true });
  assert.ok(only.voice.ok);
  assert.strictEqual(only.changed, undefined);
});

test('dish names with wine or beer, and eating at home, are not flagged', () => {
  assert.deepStrictEqual(voice.rulesHit('Red Wine Beef Stew and Dark Beer Stew, delivered. Eat at home tonight.'), []);
});

test('dashes joining clauses in the voice notes and rewrite are turned into commas', () => {
  const r = voice.parseReply(JSON.stringify({ onVoice: false, notes: ['Flat \u2014 no hook'], rewrite: 'Slow cooked - hungry yet?' }));
  assert.deepStrictEqual(r.notes, ['Flat, no hook']);
  assert.strictEqual(r.rewrite, 'Slow cooked, hungry yet?');
});
