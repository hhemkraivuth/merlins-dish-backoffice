// Grammar and Merlin's voice check for a Content Plan caption Lily has just edited. It only suggests: nothing is saved by this.
// It keeps her wording and tone, fixes spelling, grammar and punctuation, uses Australian English (see grammar.js).
const grammar = require('./grammar');
const voice = require('./voiceCheck');

async function run(caption, client, opts = {}) {
  const text = String(caption == null ? '' : caption).replace(/\r/g, '').trim();
  if (!text) return { changed: false, suggestion: '', notes: [], voice: { ok: true, rules: [], notes: [], rewrite: '', unchecked: false } };
  if (text.length > 2000) throw Object.assign(new Error('That caption is too long. Keep it under 2000 characters.'), { status: 400 });
  if (opts.voiceOnly) return { voice: await voice.check(text, client) };
  // Grammar and voice run side by side. The voice check never throws, it reports unchecked instead.
  const [r, v] = await Promise.all([grammar.check({ caption: text }, client), voice.check(text, client)]);
  const suggestion = String((r.fields || {}).caption || text).trim();
  return { changed: suggestion !== text, suggestion, notes: r.notes || [], voice: v };
}

module.exports = { run };
