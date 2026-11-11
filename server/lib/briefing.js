// The staff briefing: what the team reports to Lily when she opens the app, and the team to do list.
// Reports come from the Pit cards (each team's updates) and from newly posted full marketing reports.
// A report counts as "new" until Lily closes the pop up (Noted). Its key changes when its text changes, so changed numbers come back as news.
// Two App State rows hold the memory: briefing_seen (keys already noted) and team_todos (the to do list).

const crypto = require('crypto');
const { getState, setState } = require('./appState');

const SEEN_KEY = 'briefing_seen';
const TODO_KEY = 'team_todos';
const MAX_SEEN = 300;
const MAX_TODOS = 150;
const MAX_CELL = 45000;
const TEAMS = ['Me', 'Grab sales', 'Direct sales', 'Operations', 'Purchasing', 'Marketing', 'Strategy', 'Creative', 'Paid Media'];

const fail = (message) => Object.assign(new Error(message), { status: 400 });
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
const parseJson = (s, dflt) => { try { const v = JSON.parse(s); return v == null ? dflt : v; } catch (e) { return dflt; } };

const pad = (n) => String(n).padStart(2, '0');
// "11/11/2026" -> "2026-11-11"
function isoFromDmy(dmy) { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dmy || '')); return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : ''; }
function dmyFromIso(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; }
const dayNum = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null; };

// Plain words for a due date: "overdue by 2 days", "due today", "due tomorrow", "due in 3 days (14/11/2026)".
function dueLabel(due, todayIso) {
  const d = dayNum(due), t = dayNum(todayIso);
  if (d === null || t === null) return 'no due date';
  const diff = d - t;
  if (diff < 0) return `overdue by ${-diff} ${-diff === 1 ? 'day' : 'days'} (${dmyFromIso(due)})`;
  if (diff === 0) return 'due today';
  if (diff === 1) return 'due tomorrow';
  return `due in ${diff} days (${dmyFromIso(due)})`;
}

// Reports from the Pit teams. A team with nothing but "No ..." lines has nothing to report yet.
function reportsFromPit(pit) {
  const out = [];
  for (const t of (pit && pit.teams) || []) {
    const lines = (t.updates || []).filter(Boolean);
    if (!lines.length || lines.every((l) => /^no /i.test(l))) continue;
    out.push({ key: `team|${t.name}|${hash(lines.join('|'))}`, team: t.name, lines });
  }
  const open = (pit && pit.teams || []).flatMap((t) => (t.open || []).map((h) => ({ h, team: t.name })));
  const seen = new Set();
  for (const { h } of open) {
    const k = `ho|${hash(`${h.from}|${h.to}|${h.message}`)}`;
    if (seen.has(k)) continue; seen.add(k);
    out.push({ key: k, team: `${h.from} to ${h.to}`.replace('App sales, Direct sales', 'Sales').replace('App sales', 'Grab sales'), lines: [h.message] });
  }
  return out;
}

// Full marketing reports: news when a report is posted or reposted.
function reportsFromMarketing(list) {
  return (list || []).map((r) => ({ key: `mr|${r.slug}|${r.updated}`, team: 'Marketing', lines: [`Full report ready: ${r.title}.`], href: `report.html?doc=${encodeURIComponent(r.slug)}` }));
}

function cleanTodo(raw, now = new Date()) {
  const text = String(raw && raw.text || '').replace(/\s+/g, ' ').trim();
  if (!text) throw fail('Write what needs doing.');
  if (text.length > 200) throw fail('Keep it under 200 characters.');
  const team = TEAMS.includes(raw.team) ? raw.team : 'Me';
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.due || '')) && dayNum(raw.due) !== null ? raw.due : '';
  return { id: `${now.getTime().toString(36)}${hash(text + Math.random()).slice(0, 4)}`, text, team, due, done: false, created: now.toISOString() };
}

// Open items first: overdue and nearest due date first, no due date last. Done items afterwards, newest first.
function sortTodos(list) {
  const open = list.filter((t) => !t.done).sort((a, b) => (a.due ? dayNum(a.due) : 1e9) - (b.due ? dayNum(b.due) : 1e9) || String(a.created).localeCompare(String(b.created)));
  const done = list.filter((t) => t.done).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
  return { open, done };
}

async function loadTodos() { const v = parseJson(await getState(TODO_KEY), []); return Array.isArray(v) ? v : []; }
async function saveTodos(list) {
  // Keep every open item, and only the 30 latest done ones, so the cell stays small.
  const { open, done } = sortTodos(list);
  const kept = [...open, ...done.slice(0, 30)].slice(0, MAX_TODOS);
  const value = JSON.stringify(kept);
  if (value.length > MAX_CELL) throw fail('The to do list is full. Delete some finished items.');
  await setState(TODO_KEY, value);
  return kept;
}

async function addTodo(body) { const list = await loadTodos(); list.push(cleanTodo(body || {})); return saveTodos(list); }
async function setDone({ id, done }) {
  const list = await loadTodos(); const t = list.find((x) => x.id === id);
  if (!t) throw fail('That item is not on the list any more.');
  t.done = Boolean(done); t.doneAt = t.done ? new Date().toISOString() : undefined;
  return saveTodos(list);
}
async function removeTodo({ id }) { return saveTodos((await loadTodos()).filter((x) => x.id !== id)); }

async function markSeen(keys) {
  const add = (Array.isArray(keys) ? keys : []).map(String).filter((k) => k.length < 120).slice(0, 100);
  if (!add.length) return { ok: true };
  const seen = parseJson(await getState(SEEN_KEY), []);
  const next = [...new Set([...(Array.isArray(seen) ? seen : []), ...add])].slice(-MAX_SEEN);
  await setState(SEEN_KEY, JSON.stringify(next));
  return { ok: true };
}

// Just the to do lists with their due wording. Cheap, so adding or ticking an item does not rebuild the Pit.
async function todoView(todayIso) {
  const { open, done } = sortTodos(await loadTodos());
  const todos = open.map((t) => ({ ...t, dueText: dueLabel(t.due, todayIso), overdue: Boolean(t.due && dayNum(t.due) < dayNum(todayIso)), today: t.due === todayIso }));
  return { today: dmyFromIso(todayIso), todos, done: done.slice(0, 10) };
}

// { pit, marketingList, todayIso } -> what the pop up shows.
async function build({ pit, marketingList, todayIso }) {
  const seen = new Set(parseJson(await getState(SEEN_KEY), []));
  const all = [...reportsFromMarketing(marketingList), ...reportsFromPit(pit)];
  const reports = all.filter((r) => !seen.has(r.key));
  return { ...(await todoView(todayIso)), reports, teams: TEAMS };
}

module.exports = { build, todoView, addTodo, setDone, removeTodo, markSeen, dueLabel, reportsFromPit, reportsFromMarketing, cleanTodo, sortTodos, isoFromDmy, dmyFromIso, TEAMS };
