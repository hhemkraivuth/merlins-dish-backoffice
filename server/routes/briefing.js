// The staff briefing and team to do list (pop up on Home).
const svc = require('../lib/ledgerService');
const lib = require('../lib/briefing');
const reportsLib = require('../lib/marketingReports');

const fail = (res, err) => { console.error(err); res.status((err && err.status) || 500).json({ error: String((err && err.message) || err) }); };

async function current() {
  const [pit, list, moves, riderMissing] = await Promise.all([
    svc.pit(),
    reportsLib.listReports().catch(() => []), // the pop up still works without full reports
    svc.readOrEmpty(require('../lib/marketing').TAB).then(lib.movesFromRows).catch(() => []),
    svc.riderOrders().then((v) => v.missing).catch(() => 0),
  ]);
  return lib.build({ pit, marketingList: list, todayIso: lib.isoFromDmy(pit.today), moves, riderMissing });
}

// The morning LINE reminder: overdue and due today to dos, plus rider fees still to log. Used by the timer and by /api/todos/remind.
async function sendReminder() {
  const to = process.env.BOH_GROUP_ID;
  const access = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const todayIso = lib.isoFromDmy(formatDMY(bangkokToday()));
  const view = await lib.todoView(todayIso);
  let riderMissing = 0; try { riderMissing = (await svc.riderOrders()).missing; } catch (e) { /* skip the rider line */ }
  const text = lib.reminderText({ todos: view.todos, riderMissing, todayIso });
  if (text && to && access) await require('../lib/lineApi').push(to, text, access);
  return { sent: Boolean(text && to && access), text };
}
async function remind(req, res) {
  try {
    const token = process.env.HUDDLE_TOKEN;
    if (!token) return res.status(503).json({ error: 'HUDDLE_TOKEN is not set.' });
    if (req.get('x-huddle-token') !== token) return res.status(401).json({ error: 'Wrong token.' });
    res.json(await sendReminder());
  } catch (err) { fail(res, err); }
}

async function get(req, res) { try { res.json(await current()); } catch (err) { fail(res, err); } }
async function seen(req, res) { try { res.json(await lib.markSeen(req.body && req.body.keys)); } catch (err) { fail(res, err); } }
// To do changes return the fresh list so the page can redraw without a second call.
const { bangkokToday, formatDMY } = require('../lib/dates');
const todo = (fn) => async (req, res) => { try { await fn(req.body || {}); const b = await lib.todoView(lib.isoFromDmy(formatDMY(bangkokToday()))); res.json({ ok: true, todos: b.todos, done: b.done, today: b.today }); } catch (err) { fail(res, err); } };

module.exports = { sendReminder, remind, get, seen, add: todo(lib.addTodo), done: todo(lib.setDone), remove: todo(lib.removeTodo) };
