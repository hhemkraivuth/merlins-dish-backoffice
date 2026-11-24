// Social content plan: competitor analysis (borrow, avoid), Merlin's own style read, and proposed posts.
// Lily taps Approve or Dismiss on each proposal. Approved ones become her shoot and publish list.
// The plan text lives in server/data/contentPlan.json (or a posted replacement in App State). Her decisions live in App State.

const seed = require('../data/contentPlan.json');
const { readTab } = require('./sheets');
const { setState, TAB } = require('./appState');
const queue = require('./contentQueue');

const SCHED_KEY = 'content_plan_sched';
const DEFAULT_TIME = '17:00';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PLAN_KEY = 'content_plan_json';
const STATUS_KEY = 'content_plan_status';
const EDIT_KEY = 'content_plan_edits';
const FOOTER_KEY = 'content_plan_footer';
const BRIEF_KEY = 'content_plan_briefs';
const CHANNELS = ['Instagram and Facebook', 'LINE broadcast'];
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
// sched holds Lily's own date and time choices, kept apart from the plan so a new weekly plan never wipes them.
// qmap is the Content Queue tab: when the 17:00 task has posted a post, the page shows it as published with its links.
function merge(plan, status, edits, sched, qmap) {
  const st = status || {};
  const ed = edits || {};
  const sc = sched || {};
  const qm = qmap || {};
  const proposals = (plan.proposals || []).map((p) => {
    const s = st[p.id] || {};
    const c = sc[p.id] || {};
    const q = qm[p.id] || {};
    const edited = typeof ed[p.id] === 'string' && ed[p.id].trim();
    let status = STATUSES.includes(s.status) ? s.status : 'proposed';
    if (q.status === 'published' && status === 'approved') status = 'published';
    const date = DMY.test(c.date || '') ? c.date : p.date;
    const time = HHMM.test(c.time || '') ? c.time : (HHMM.test(p.time || '') ? p.time : DEFAULT_TIME);
    return {
      ...p, date, time, media: cleanMedia(p.media), caption: edited ? ed[p.id] : p.caption, edited: !!edited, status, decided: s.at || '',
      igUrl: q.igUrl || '', fbUrl: q.fbUrl || '', queueStatus: q.status || '', queueNote: q.note || '',
    };
  });
  return { ...plan, proposals };
}

const cleanMedia = (m) => (Array.isArray(m) ? m : []).map((x) => ({ id: String((x && x.id) || '').trim(), name: String((x && x.name) || '').trim().slice(0, 120), kind: (x && x.kind) === 'video' ? 'video' : 'image' })).filter((x) => x.id).slice(0, 10);

async function load() {
  const rs = await rows();
  const { bangkokToday, formatDMY } = require('./dates');
  let qmap = {};
  try { qmap = await queue.readQueue(); } catch (e) { qmap = {}; }
  return { ...merge(pick(rs, PLAN_KEY) || seed, pick(rs, STATUS_KEY), pick(rs, EDIT_KEY), pick(rs, SCHED_KEY), qmap), footer: pick(rs, FOOTER_KEY) || seed.footer, briefs: pick(rs, BRIEF_KEY) || [], pillars: seed.pillars, today: formatDMY(bangkokToday()) };
}

// What goes to Instagram and Facebook: her caption, then the footer.
const fullCaptionOf = (p, footer) => `${String(p.caption || '').trim()}\n\n${footer || ''}`.trim();

async function setStatus({ id, status }, now = new Date()) {
  const sid = String(id || '').trim();
  if (!STATUSES.includes(status)) throw fail('Status must be approved, dismissed, published or proposed.');
  const rs = await rows();
  const plan = pick(rs, PLAN_KEY) || seed;
  if (!(plan.proposals || []).some((p) => p.id === sid)) throw fail('That proposal is not in the plan.', 404);
  const st = pick(rs, STATUS_KEY) || {};
  // Approving puts the post on the queue first. If the queue cannot be written the approval is not saved, so nothing is approved but never posted.
  if (status === 'approved') {
    const merged = merge(plan, st, pick(rs, EDIT_KEY), pick(rs, SCHED_KEY)).proposals.find((p) => p.id === sid);
    await queue.upsert({ ...merged, fullCaption: fullCaptionOf(merged, pick(rs, FOOTER_KEY) || seed.footer) }, 'approved', merged.media.length ? '' : 'No file attached yet', now);
  } else if (status === 'proposed' || status === 'dismissed') {
    await queue.cancel(sid, now);
  }
  if (status === 'proposed') delete st[sid]; else st[sid] = { status, at: now.toISOString() };
  await setState(STATUS_KEY, JSON.stringify(st));
  return { ok: true, id: sid, status };
}

// Lily picks another day or time for a post. If it is already approved, the queue row follows.
async function setSchedule({ id, date, time }, now = new Date()) {
  const sid = String(id || '').trim();
  const d = String(date || '').trim();
  const t = String(time || '').trim();
  const q = DMY.exec(d);
  if (!q || new Date(Date.UTC(+q[3], +q[2] - 1, +q[1])).getUTCDate() !== +q[1]) throw fail('Pick a real date.');
  if (!HHMM.test(t)) throw fail('Pick a time like 17:00.');
  const rs = await rows();
  const plan = pick(rs, PLAN_KEY) || seed;
  if (!(plan.proposals || []).some((p) => p.id === sid)) throw fail('That proposal is not in the plan.', 404);
  const sc = pick(rs, SCHED_KEY) || {};
  const st = pick(rs, STATUS_KEY) || {};
  if ((st[sid] || {}).status === 'published') throw fail('That post is already published.');
  sc[sid] = { date: d, time: t };
  if ((st[sid] || {}).status === 'approved') {
    const merged = merge(plan, st, pick(rs, EDIT_KEY), sc).proposals.find((p) => p.id === sid);
    await queue.upsert({ ...merged, fullCaption: fullCaptionOf(merged, pick(rs, FOOTER_KEY) || seed.footer) }, 'approved', merged.media.length ? '' : 'No file attached yet', now);
  }
  await setState(SCHED_KEY, JSON.stringify(sc));
  return { ok: true, id: sid, date: d, time: t };
}

// The preview route may only serve a file that a post in the plan names.
async function mediaAllowed(fileId) {
  const rs = await rows();
  const plan = pick(rs, PLAN_KEY) || seed;
  return (plan.proposals || []).some((p) => cleanMedia(p.media).some((m) => m.id === String(fileId)));
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
  const st = pick(rs, STATUS_KEY) || {};
  if ((st[sid] || {}).status === 'approved') {
    const merged = merge(plan, st, ed, pick(rs, SCHED_KEY)).proposals.find((p) => p.id === sid);
    await queue.upsert({ ...merged, fullCaption: fullCaptionOf(merged, pick(rs, FOOTER_KEY) || seed.footer) }, 'approved', merged.media.length ? '' : 'No file attached yet');
  }
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

// Lily's briefs: a few words on what is happening (a new dish, a drink, a promo, a date). Claude turns each into captions and shot designs, then marks it done.
async function addBrief({ text, date, channels }, now = new Date()) {
  const t = String(text == null ? '' : text).replace(/\r/g, '').trim();
  if (t.length < 3) throw fail('Write a few words about what is happening.');
  if (t.length > 1500) throw fail('That brief is too long. Keep it under 1500 characters.');
  const d = String(date || '').trim();
  if (d && !/^\d{2}\/\d{2}\/\d{4}$/.test(d)) throw fail('Write the date as DD/MM/YYYY, or leave it empty.');
  const ch = (Array.isArray(channels) ? channels : []).filter((c) => CHANNELS.includes(c));
  const rs = await rows();
  const list = pick(rs, BRIEF_KEY) || [];
  if (list.length >= 30) throw fail('There are 30 briefs already. Remove some first.');
  const brief = { id: `br-${now.getTime().toString(36)}`, text: t, date: d, channels: ch, at: now.toISOString(), done: false, posts: [] };
  list.push(brief);
  await setState(BRIEF_KEY, JSON.stringify(list));
  return { ok: true, brief };
}
async function updateBrief({ id, done, remove, posts }) {
  const rs = await rows();
  const list = pick(rs, BRIEF_KEY) || [];
  const i = list.findIndex((b) => b.id === String(id || '').trim());
  if (i < 0) throw fail('That brief is not on the list.', 404);
  if (remove) list.splice(i, 1);
  else { list[i].done = !!done; if (Array.isArray(posts)) list[i].posts = posts.map(String).slice(0, 10); }
  await setState(BRIEF_KEY, JSON.stringify(list));
  return { ok: true, id: String(id) };
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
  if (p.time != null && !HHMM.test(String(p.time))) out.push(`${p.id}: time must be HH:MM, for example 17:00`);
  if (p.media != null && (!Array.isArray(p.media) || p.media.some((m) => !m || !String(m.id || '').trim()))) out.push(`${p.id}: media must be a list of { id, name } with the Drive file id`);
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

module.exports = { load, setStatus, setSchedule, mediaAllowed, fullCaptionOf, cleanMedia, setCaption, setFooter, addBrief, updateBrief, CHANNELS, savePlan, addWeek, check, merge, STATUSES };
