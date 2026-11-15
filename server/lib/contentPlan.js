// Social content plan: competitor analysis (borrow, avoid), Merlin's own style read, and proposed posts.
// Lily taps Approve or Dismiss on each proposal. Approved ones become her shoot and publish list.
// The plan text lives in server/data/contentPlan.json (or a posted replacement in App State). Her decisions live in App State.

const seed = require('../data/contentPlan.json');
const { readTab } = require('./sheets');
const { setState, TAB } = require('./appState');

const PLAN_KEY = 'content_plan_json';
const STATUS_KEY = 'content_plan_status';
const EDIT_KEY = 'content_plan_edits';
const FOOTER_KEY = 'content_plan_footer';
const MAX_CELL = 48000;
const STATUSES = ['proposed', 'approved', 'dismissed', 'published'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

async function rows() {
  try { return await readTab(TAB); } catch (err) { if (/unable to parse range|not found/i.test(String(err.message))) return []; throw err; }
}
function pick(rs, key) {
  for (const r of (rs || []).slice(1)) if (String((r && r[0]) || '').trim() === key) { try { return JSON.parse(String(r[1] || '')); } catch (e) { return null; } }
  return null;
}

// Plan text plus each proposal's saved status.
function merge(plan, status, edits) {
  const st = status || {};
  const ed = edits || {};
  const proposals = (plan.proposals || []).map((p) => {
    const s = st[p.id] || {};
    const edited = typeof ed[p.id] === 'string' && ed[p.id].trim();
    return { ...p, caption: edited ? ed[p.id] : p.caption, edited: !!edited, status: STATUSES.includes(s.status) ? s.status : 'proposed', decided: s.at || '' };
  });
  return { ...plan, proposals };
}

async function load() {
  const rs = await rows();
  const { bangkokToday, formatDMY } = require('./dates');
  return { ...merge(pick(rs, PLAN_KEY) || seed, pick(rs, STATUS_KEY), pick(rs, EDIT_KEY)), footer: pick(rs, FOOTER_KEY) || seed.footer, pillars: seed.pillars, today: formatDMY(bangkokToday()) };
}

async function setStatus({ id, status }, now = new Date()) {
  const sid = String(id || '').trim();
  if (!STATUSES.includes(status)) throw fail('Status must be approved, dismissed, published or proposed.');
  const rs = await rows();
  const plan = pick(rs, PLAN_KEY) || seed;
  if (!(plan.proposals || []).some((p) => p.id === sid)) throw fail('That proposal is not in the plan.', 404);
  const st = pick(rs, STATUS_KEY) || {};
  if (status === 'proposed') delete st[sid]; else st[sid] = { status, at: now.toISOString() };
  await setState(STATUS_KEY, JSON.stringify(st));
  return { ok: true, id: sid, status };
}

// Lily edits a caption by hand. The edit is kept apart from the plan, so a new weekly plan never wipes it. Empty text resets to the original.
async function setCaption({ id, caption }) {
  const sid = String(id || '').trim();
  const text = String(caption == null ? '' : caption).replace(/\r/g, '').trim();
  if (text.length > 2000) throw fail('That caption is too long. Keep it under 2000 characters.');
  const rs = await rows();
  const plan = pick(rs, PLAN_KEY) || seed;
  if (!(plan.proposals || []).some((p) => p.id === sid)) throw fail('That proposal is not in the plan.', 404);
  const ed = pick(rs, EDIT_KEY) || {};
  if (text) ed[sid] = text; else delete ed[sid];
  await setState(EDIT_KEY, JSON.stringify(ed));
  return { ok: true, id: sid, edited: !!text };
}

// One footer for every post. Empty text goes back to the standard footer.
async function setFooter({ footer }) {
  const text = String(footer == null ? '' : footer).replace(/\r/g, '').trim();
  if (text.length > 800) throw fail('That footer is too long. Keep it under 800 characters.');
  await setState(FOOTER_KEY, JSON.stringify(text || null));
  return { ok: true, footer: text || seed.footer };
}

// House rules for what a post may say. Lily never announces batch cooking, and nobody wants to hear "reheat".
const BANNED = [
  [/re-?heat|ready to heat|batch|freez|frozen|leftover/i, 'never mention batches, reheating or freezing'],
  [/secret recipe/i, 'never say secret recipe'],
  [/yellow tape|tape label/i, 'the yellow tape label is retired, use cover text'],
  [/thanksgiving/i, 'Merlin\'s is European cuisine, no Thanksgiving'],
  [/this week'?s menu/i, 'never say this week\'s menu'],
  [/when they are gone|while stocks? last|only \d+ (left|portions?|shanks?)/i, 'no scarcity lines about stock'],
];
const REQUIRED = ['title', 'hook', 'visual', 'caption', 'why', 'pillar', 'format', 'date'];
const DMY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

// Returns a list of plain problems with one proposal. Empty means it is fine.
function check(p, pillarNames) {
  const out = [];
  for (const k of REQUIRED) if (!p || !String(p[k] || '').trim()) out.push(`${(p && p.id) || 'proposal'} needs ${k}`);
  if (out.length) return out;
  if (!DMY.test(p.date)) out.push(`${p.id} date must be DD/MM/YYYY`);
  if (pillarNames && !pillarNames.includes(p.pillar)) out.push(`${p.id} pillar must be one of ${pillarNames.join(', ')}`);
  // Lily's rule for the current two posts a week. Revisit when the rhythm moves to three a week or every second day.
  if (dayNum(p.date) !== null && (dayNum(p.date) + 4) % 7 === 5) out.push(`${p.id}: no Friday posts while we post twice a week (people go out), pick another day`);
  const text = [p.title, p.hook, p.visual, p.caption, p.why].join(' ');
  for (const [re, msg] of BANNED) if (re.test(text)) out.push(`${p.id}: ${msg}`);
  if (/link in (the last line|bio)|order direct|made with magic|#merlinsdish/i.test(p.caption)) out.push(`${p.id}: the footer adds the order line, write only the caption`);
  if (/%/.test(p.caption)) out.push(`${p.id}: no percentages in captions`);
  if (/ [-\u2013\u2014] /.test(p.caption + ' ' + p.hook)) out.push(`${p.id}: no dash joining clauses`);
  return out;
}
const dayNum = (dmy) => { const m = DMY.exec(String(dmy || '')); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000 : null; };

// The weekly check adds next week's proposals. Same id replaces, new ids are added, old undecided ones are dropped after 21 days.
async function addWeek(body, now = new Date()) {
  const incoming = body && body.proposals;
  if (!Array.isArray(incoming) || !incoming.length) throw fail('Send a proposals list.');
  const names = (seed.pillars || []).map((x) => x.name);
  const problems = [];
  const ids = new Set();
  for (const p of incoming) {
    if (!p || !/^[a-z0-9-]{1,30}$/.test(String(p.id || ''))) { problems.push('every proposal needs a short id using letters, numbers and dashes'); continue; }
    if (ids.has(p.id)) problems.push(`id ${p.id} is used twice`);
    ids.add(p.id);
    problems.push(...check(p, names));
  }
  if (problems.length) throw fail(`Not added: ${problems.join('; ')}.`);
  const rs = await rows();
  const plan = pick(rs, PLAN_KEY) || seed;
  const st = pick(rs, STATUS_KEY) || {};
  const today = Math.floor(now.getTime() / 86400000);
  const keep = (plan.proposals || []).filter((p) => !ids.has(p.id)).filter((p) => {
    const n = dayNum(p.date); const s = (st[p.id] || {}).status;
    return n === null || n >= today - 21 || s === 'approved';
  });
  const next = { ...plan, proposals: [...keep, ...incoming].sort((a, b) => dayNum(a.date) - dayNum(b.date)) };
  next.prepared = String(body.prepared || '').trim() || next.prepared;
  const value = JSON.stringify(next);
  if (value.length > MAX_CELL) throw fail('The plan is too long for one cell. Dismiss or publish old posts first.');
  await setState(PLAN_KEY, value);
  return { ok: true, added: incoming.length, total: next.proposals.length };
}

// A new plan posted by the weekly check. Decisions on ids that still exist are kept.
async function savePlan(body) {
  const plan = body && body.plan;
  if (!plan || !Array.isArray(plan.proposals) || !plan.proposals.length) throw fail('The plan needs a proposals list.');
  const ids = new Set();
  for (const p of plan.proposals) {
    if (!p || !/^[a-z0-9-]{1,30}$/.test(String(p.id || ''))) throw fail('Every proposal needs a short id using letters, numbers and dashes.');
    if (ids.has(p.id)) throw fail(`Proposal id ${p.id} is used twice.`);
    ids.add(p.id);
    if (!p.title) throw fail(`Proposal ${p.id} needs a title.`);
  }
  const value = JSON.stringify(plan);
  if (value.length > MAX_CELL) throw fail('That plan is too long for one cell. Send fewer proposals.');
  await setState(PLAN_KEY, value);
  return { ok: true, proposals: plan.proposals.length };
}

module.exports = { load, setStatus, setCaption, setFooter, savePlan, addWeek, check, merge, STATUSES };
