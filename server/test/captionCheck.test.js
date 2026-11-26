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
