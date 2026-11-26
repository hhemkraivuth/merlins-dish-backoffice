// Merlin's tone of voice check for a Content Plan caption. It only advises: nothing is saved or blocked by this.
// Part 1 is instant and free: the house rules that can be tested with plain patterns.
// Part 2 is one small call to Claude that judges the voice (warm, friendly, fun, appetite led) and flags what a pattern cannot.
const { BANNED } = require('./contentPlan');
const MODEL = 'claude-sonnet-4-6';

const RULES = [
  ...BANNED,
  [/[฀-๿]/, 'captions are English only'],
  [/\d\s?%|percent/i, 'no percentages in captions, use slash prices'],
  [/ [-–—] /, 'no dash joining clauses, use a comma or a full stop'],
  [/(cooked|made|prepared) at home|home kitchen|home[- ]?cooked/i, 'never hint the food is cooked at home, say slow cooked in Bangkok'],
  [/grab (charges|takes|is (more|expensive))|cheaper than grab|instead of grab/i, 'never attack or compare with Grab'],
  [/\bminimum (spend|order)\b/i, 'never state a minimum spend, use "Free delivery within 2km*"'],
];

function rulesHit(text) {
  const t = String(text || '');
  return RULES.filter(([re]) => re.test(t)).map(([, msg]) => msg);
}

const PROMPT = `You are the brand voice guard for Merlin's Dish, a Bangkok slow cooked European comfort food delivery business. Use Australian English.
The voice is warm, friendly, fun, and all about eating good food. Appetite led, a little cheeky, punchy and human. Short sentences, vivid food words, a light joke when it fits. It grabs attention. It is NOT quiet, flat, corporate, a spec sheet or a hard sell.
Caption shape: a sensory hook, then a sharp invitation to order. The footer (tagline, order line, hashtags) is added separately, so do not judge it or add one.
Also flag: promotional alcohol copy (a push to buy wine or drinks; dish names such as Red Wine Beef Stew and Dark Beer Stew are fine), invented facts (hours of cooking, ingredients or origins that were not given), fake urgency or stock scarcity (the word "available" alone is not scarcity, only wording like "only 6 left" or "while stocks last"), attacking or comparing with any delivery platform, "this week's menu" or availability windows, prices that are not slash prices, and anything that sounds like reheated or batch food.
Never use hyphens or dashes to join clauses in your notes or rewrite, use commas or full stops. Judge only the caption you are given. Do not be fussy: if the voice is warm and appetising, it is on voice, even if you would phrase it differently.
Return strict JSON only, no markdown fences: {"onVoice": true or false, "notes": [<up to 4 short plain English reasons, empty if on voice>], "rewrite": "<only when off voice: a rewrite in the Merlin's voice that keeps every fact, same length or shorter. Empty string when on voice>"}`;

const noDash = (t) => String(t).replace(/\s[\u2013\u2014-]\s/g, ', ');

function parseReply(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || ''));
  if (!m) throw new Error('The voice check gave no answer');
  const j = JSON.parse(m[0]);
  const onVoice = j.onVoice !== false;
  return { onVoice, notes: Array.isArray(j.notes) ? j.notes.map(noDash).slice(0, 4) : [], rewrite: onVoice ? '' : noDash(String(j.rewrite || '').trim()) };
}

async function judge(caption, client) {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  const msg = await client.messages.create({ model: MODEL, max_tokens: 800, system: PROMPT, messages: [{ role: 'user', content: caption }] });
  return parseReply((msg.content || []).map((c) => c.text || '').join(''));
}

// Always returns the instant rule hits. If the Claude call fails, the rule hits still come back and unchecked is true.
async function check(caption, client) {
  const text = String(caption == null ? '' : caption).replace(/\r/g, '').trim();
  if (!text) return { ok: true, rules: [], notes: [], rewrite: '', unchecked: false };
  const rules = rulesHit(text);
  try {
    const j = await judge(text, client);
    return { ok: j.onVoice && !rules.length, rules, notes: j.notes, rewrite: j.rewrite, unchecked: false };
  } catch (e) {
    return { ok: !rules.length, rules, notes: [], rewrite: '', unchecked: true, reason: e.message };
  }
}

module.exports = { check, rulesHit, parseReply };
