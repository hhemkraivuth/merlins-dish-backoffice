// Social content plan: competitor analysis (borrow, avoid), Merlin's own style read, and proposed posts.
// Lily taps Approve or Dismiss on each proposal. Approved ones become her shoot and publish list.
// The plan text lives in server/data/contentPlan.json (or a posted replacement in App State). Her decisions live in App State.

const seed = require('../data/contentPlan.json');
const { readTab } = require('./sheets');
const { setState, TAB } = require('./appState');

const PLAN_KEY = 'content_plan_json';
const STATUS_KEY = 'content_plan_status';
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
function merge(plan, status) {
  const st = status || {};
  const proposals = (plan.proposals || []).map((p) => {
    const s = st[p.id] || {};
    return { ...p, status: STATUSES.includes(s.status) ? s.status : 'proposed', decided: s.at || '' };
  });
  return { ...plan, proposals };
}

async function load() {
  const rs = await rows();
  return merge(pick(rs, PLAN_KEY) || seed, pick(rs, STATUS_KEY));
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

module.exports = { load, setStatus, savePlan, merge, STATUSES };
