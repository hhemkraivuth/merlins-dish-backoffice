// The staff briefing: what the team reports to Lily when she opens the app, and the team to do list.
// Reports come from the Pit cards (each team's updates) and from newly posted full marketing reports.
// A report counts as "new" until Lily closes the pop up (Noted). Its key changes when its text changes, so changed numbers come back as news.
// Two App State rows hold the memory: briefing_seen (keys already noted) and team_todos (the to do list).

const crypto = require('crypto');
const { getState, setState } = require('./appState');

const SEEN_KEY = 'briefing_seen';
const TODO_KEY = 'team_todos';
const AUTO_KEY = 'todo_auto_seen'; // source keys already turned into a to do, so a ticked or deleted one never comes back
const MAX_AUTO_SEEN = 400;
const MAX_AUTO_NEW = 12; // most new automatic to dos in one pass, so the first run does not flood the list
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
  const open = (pit && pit.teams || []).flatMap((t) => (t.openShort || t.open || []).map((h) => ({ h, team: t.name })));
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


// ---- automatic to dos ---------------------------------------------------------------------------------------------
// Open handoffs between teams and the three weekly Moves become to dos with a due date. A to do made this way carries
// `src` (where it came from) and `auto: true`. A handoff to do ticks itself off when the situation clears. The rider fee
// to do is one rolled up line that follows the count of LINE orders with no rider fee yet.

const firstSentence = (t, max = 190) => { const s = String(t || '').replace(/\s+/g, ' ').trim().split(/(?<=[.?!])\s/)[0]; return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s; };
const addDays = (iso, n) => new Date(dayNum(iso) * 864e5 + n * 864e5).toISOString().slice(0, 10);

// Which team's list a handoff belongs on.
function teamForHandoff(to) {
  const t = String(to || '');
  if (/Lily|Boss|Me\b/i.test(t)) return 'Me';
  if (/Operations/i.test(t)) return 'Operations';
  if (/Purchasing/i.test(t)) return 'Purchasing';
  if (/Paid Media/i.test(t)) return 'Paid Media';
  if (/Creative/i.test(t)) return 'Creative';
  if (/Strategy/i.test(t)) return 'Strategy';
  if (/Marketing/i.test(t)) return 'Marketing';
  if (/App sales/i.test(t)) return 'Grab sales';
  if (/Direct sales/i.test(t)) return 'Direct sales';
  return 'Me';
}

// "by 13/11", "on 12/11/2026", "13/11" -> "2026-11-13". The year comes from today and rolls forward if the date is long past.
function dateInText(text, todayIso) {
  const m = /(?:^|[^\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/.exec(String(text || ''));
  if (!m) return '';
  const d = +m[1], mo = +m[2]; let y = m[3] ? +m[3] : +todayIso.slice(0, 4);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  let iso = `${y}-${pad(mo)}-${pad(d)}`;
  if (new Date(`${iso}T00:00:00Z`).getUTCDate() !== d) return '';
  if (!m[3] && dayNum(iso) < dayNum(todayIso) - 60) iso = `${y + 1}-${pad(mo)}-${pad(d)}`;
  return iso;
}

// Move rows from the Marketing Notes tab: the newest day's Moves, up to three. rows: sheet rows (header first or not).
function movesFromRows(rows) {
  const mv = (rows || []).filter((r) => String(r[1] || '').trim() === 'Move' && String(r[2] || '').trim());
  const stamp = (r) => dayNum(isoFromDmy(r[0])) || 0;
  const newest = mv.reduce((m, r) => Math.max(m, stamp(r)), 0);
  if (!newest) return [];
  return mv.filter((r) => stamp(r) === newest).slice(-3).map((r) => ({ date: String(r[0]).trim(), title: String(r[2]).trim(), note: String(r[3] || '').trim() }));
}

// pit: the Pit result. moves: movesFromRows(). riderMissing: LINE orders with no rider fee. Returns [{ src, text, team, due }].
function autoCandidates({ pit, moves = [], riderMissing = 0, todayIso }) {
  const out = [];
  const seen = new Set();
  for (const t of (pit && pit.teams) || []) {
    for (const h of t.open || []) {
      if (/has no rider fee yet/i.test(h.message)) continue; // rolled into the one rider fee to do below
      const src = `ho|${hash(`${h.from}|${h.to}|${h.message}`)}`;
      if (seen.has(src)) continue; seen.add(src);
      out.push({ src, text: firstSentence(h.message), team: teamForHandoff(h.to), due: addDays(todayIso, 2) });
    }
  }
  for (const m of moves) {
    const src = `mv|${m.date}|${hash(m.title)}`;
    const due = dateInText(`${m.title} ${m.note}`, todayIso);
    out.push({ src, text: firstSentence(m.title), team: 'Marketing', due: due && dayNum(due) >= dayNum(todayIso) ? due : addDays(todayIso, 3) });
  }
  if (riderMissing > 0) out.push({ src: `rider|${todayIso}`, text: `Log the rider fee for ${riderMissing} LINE ${riderMissing === 1 ? 'order' : 'orders'} (Index, Delivery cost).`, team: 'Me', due: todayIso });
  return out;
}

// Adds the new ones and ticks off the handoff and rider ones that cleared. Writes only when something changed.
async function syncAuto({ pit, moves, riderMissing, todayIso }) {
  const cands = autoCandidates({ pit, moves, riderMissing, todayIso });
  const list = await loadTodos();
  const seen = new Set(parseJson(await getState(AUTO_KEY), []));
  const live = new Set(cands.map((c) => c.src));
  let changed = false, seenChanged = false, added = 0;
  const nowIso = new Date().toISOString();

  for (const c of cands) {
    if (c.src.startsWith('rider|')) {
      const open = list.find((t) => !t.done && String(t.src || '').startsWith('rider|'));
      if (open) { if (open.text !== c.text) { open.text = c.text; changed = true; } continue; }
    }
    if (seen.has(c.src) || added >= MAX_AUTO_NEW) continue;
    if (list.filter((t) => t.auto && !t.done).length >= 40) break;
    const t = cleanTodo({ text: c.text, team: c.team, due: c.due });
    list.push({ ...t, src: c.src, auto: true });
    seen.add(c.src); added += 1; changed = true; seenChanged = true;
  }
  for (const t of list) {
    if (!t.auto || t.done || !t.src) continue;
    if ((t.src.startsWith('ho|') || t.src.startsWith('rider|')) && !live.has(t.src) && !(t.src.startsWith('rider|') && riderMissing > 0)) { t.done = true; t.doneAt = nowIso; changed = true; }
  }
  if (seenChanged) await setState(AUTO_KEY, JSON.stringify([...seen].slice(-MAX_AUTO_SEEN)));
  if (changed) await saveTodos(list);
  return { added };
}

// The morning LINE message: what is overdue or due today, and the rider fees still to log. '' when there is nothing.
function reminderText({ todos = [], riderMissing = 0, todayIso }) {
  const late = todos.filter((t) => !t.done && t.due && dayNum(t.due) < dayNum(todayIso));
  const now = todos.filter((t) => !t.done && t.due === todayIso);
  if (!late.length && !now.length && !riderMissing) return '';
  const row = (t) => `• ${t.text} (${t.team}, ${dueLabel(t.due, todayIso)})`;
  const parts = [`Morning Boss. ${dmyFromIso(todayIso)}`];
  if (late.length) parts.push(`Overdue:\n${late.map(row).join('\n')}`);
  if (now.length) parts.push(`Due today:\n${now.map(row).join('\n')}`);
  if (riderMissing) parts.push(`Rider fees: ${riderMissing} LINE ${riderMissing === 1 ? 'order has' : 'orders have'} no rider fee yet. Log them on the Index page, Delivery cost.`);
  return parts.join('\n\n');
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
async function build({ pit, marketingList, todayIso, moves = [], riderMissing = 0 }) {
  try { await syncAuto({ pit, moves, riderMissing, todayIso }); } catch (err) { console.error('Automatic to dos:', err.message); }
  const seen = new Set(parseJson(await getState(SEEN_KEY), []));
  const all = [...reportsFromMarketing(marketingList), ...reportsFromPit(pit)];
  const reports = all.filter((r) => !seen.has(r.key));
  return { ...(await todoView(todayIso)), reports, teams: TEAMS, riderMissing };
}

module.exports = { build, syncAuto, autoCandidates, movesFromRows, dateInText, teamForHandoff, reminderText, todoView, addTodo, setDone, removeTodo, markSeen, dueLabel, reportsFromPit, reportsFromMarketing, cleanTodo, sortTodos, isoFromDmy, dmyFromIso, TEAMS };
