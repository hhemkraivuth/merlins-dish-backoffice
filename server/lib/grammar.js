// Grammar check for anything Lily posts to the order app (announcement, promo name, dish description).
// One small call to Claude. It fixes spelling, grammar and punctuation only, keeps her wording and tone (Australian
// English), never adds or removes facts, dates, times or prices. If the check cannot run, the caller posts as written.
const MODEL = 'claude-sonnet-4-6';

const PROMPT = `You proofread short customer-facing messages for a Bangkok food business. Use Australian English spelling.
Fix spelling, grammar, punctuation and capitalisation only. Keep the wording, tone and meaning. Never change dates, times, prices, names or numbers. Do not add or remove sentences. Do not use hyphens or dashes to join clauses; use commas or full stops.
You get a JSON object of fields. Return strict JSON only, no markdown fences: {"fields": {<same keys, corrected text>}, "notes": [<short plain English list of what was changed, empty if nothing>]}`;

function parseReply(text, original) {
  const m = /\{[\s\S]*\}/.exec(String(text || ''));
  if (!m) throw new Error('The grammar check gave no answer');
  const j = JSON.parse(m[0]);
  const out = {};
  for (const k of Object.keys(original)) out[k] = typeof (j.fields || {})[k] === 'string' ? j.fields[k] : original[k];
  const changed = Object.keys(original).some((k) => out[k] !== original[k]);
  return { fields: out, changed, notes: Array.isArray(j.notes) ? j.notes.map(String).slice(0, 8) : [] };
}

async function check(fields, client) {
  const clean = {};
  for (const [k, v] of Object.entries(fields || {})) clean[k] = String(v ?? '');
  if (!Object.values(clean).some((v) => v.trim())) return { fields: clean, changed: false, notes: [] };
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  const msg = await client.messages.create({ model: MODEL, max_tokens: 1200, system: PROMPT, messages: [{ role: 'user', content: JSON.stringify(clean) }] });
  return parseReply((msg.content || []).map((c) => c.text || '').join(''), clean);
}

module.exports = { check, parseReply };
