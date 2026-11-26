// Grammar check for a Content Plan caption Lily has just edited. It only suggests: nothing is saved by this.
// It keeps her wording and tone, fixes spelling, grammar and punctuation, uses Australian English (see grammar.js).
const grammar = require('./grammar');

async function run(caption, client) {
  const text = String(caption == null ? '' : caption).replace(/\r/g, '').trim();
  if (!text) return { changed: false, suggestion: '', notes: [] };
  if (text.length > 2000) throw Object.assign(new Error('That caption is too long. Keep it under 2000 characters.'), { status: 400 });
  const r = await grammar.check({ caption: text }, client);
  const suggestion = String((r.fields || {}).caption || text).trim();
  return { changed: suggestion !== text, suggestion, notes: r.notes || [] };
}

module.exports = { run };
