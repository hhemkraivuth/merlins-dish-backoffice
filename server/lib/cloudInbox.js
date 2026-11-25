// Cloud Inbox. Scheduled cloud tasks cannot open the BOH page (that needs Lily's desktop browser), but they can write to
// the Claude Log sheet through Zapier. They append one row per job to the "Cloud Inbox" tab and this module picks the
// rows up every few minutes and runs each one through the same rules the page uses. Nothing here skips a check.
//
// Row: ID | Created | Kind | Payload | Status | Result | Updated
//   Kind: content-week (body of POST /api/content-plan/week), brief-update (body of /api/content-plan/brief/update),
//         marketing-note (kind, title, note, status), marketing-report (slug, title, markdown)
//   Payload: JSON text. Status: new, then done or error. The task leaves Status "new"; BOH writes the rest.

const TAB = 'Cloud Inbox';
const HEADERS = ['ID', 'Created', 'Kind', 'Payload', 'Status', 'Result', 'Updated'];
const KINDS = ['content-week', 'brief-update', 'marketing-note', 'marketing-report'];
const MAX_PER_RUN = 10;

const trim = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function handlersFor() {
  const cp = require('./contentPlan');
  const reports = require('./marketingReports');
  const svc = require('./ledgerService');
  return {
    'content-week': (p) => cp.addWeek(p),
    'brief-update': (p) => cp.updateBrief(p),
    'marketing-note': async (p) => { await svc.addMarketingNote(p); return { ok: true }; },
    'marketing-report': (p) => reports.saveReport(p),
  };
}

// Rows still waiting, with their 1-based sheet row numbers. Only exact status "new" is picked up, so a row is run once.
function waiting(rows) {
  return (rows || []).map((r, i) => ({ r: r || [], row: i + 1 })).slice(1)
    .filter(({ r }) => String(r[4] || '').trim().toLowerCase() === 'new' && (r[2] || r[3]));
}

// Runs one row. Never throws: a bad row becomes status "error" with the reason, so it is never retried by itself.
async function runOne(r, handlers) {
  const kind = String(r[2] || '').trim();
  if (!KINDS.includes(kind)) return { status: 'error', result: `Kind must be one of ${KINDS.join(', ')}.` };
  let payload;
  try { payload = JSON.parse(String(r[3] || '')); } catch (e) { return { status: 'error', result: 'Payload is not valid JSON.' }; }
  if (!payload || typeof payload !== 'object') return { status: 'error', result: 'Payload must be a JSON object.' };
  try {
    const out = await handlers[kind](payload);
    return { status: 'done', result: trim(JSON.stringify(out || { ok: true })) };
  } catch (err) {
    return { status: 'error', result: trim((err && err.message) || err) };
  }
}

async function run({ readTabFresh, updateCells, ensureTab = require('./cookLog').ensureTab, handlers = handlersFor(), now = () => new Date() } = {}) {
  const sheets = require('./sheets');
  const read = readTabFresh || sheets.readTabFresh;
  const write = updateCells || sheets.updateCells;
  let rows;
  try { rows = await read(TAB); } catch (err) {
    if (/unable to parse range|not found/i.test(String(err.message))) { if (ensureTab) await ensureTab(TAB, HEADERS); return { ran: 0 }; }
    throw err;
  }
  const todo = waiting(rows).slice(0, MAX_PER_RUN);
  const out = [];
  for (const { r, row } of todo) {
    // Claim the row first so a slow job is never picked up twice.
    await write(TAB, row, [{ col: 4, value: 'working' }, { col: 6, value: now().toISOString() }]);
    const res = await runOne(r, handlers);
    await write(TAB, row, [{ col: 4, value: res.status }, { col: 5, value: res.result }, { col: 6, value: now().toISOString() }]);
    out.push({ row, kind: r[2], ...res });
  }
  return { ran: out.length, rows: out };
}

// Creates the tab at start up so a cloud task can append to it the first time.
async function setup(ensureTab = require('./cookLog').ensureTab) { await ensureTab(TAB, HEADERS); }

module.exports = { setup, run, runOne, waiting, TAB, HEADERS, KINDS };
