// The staff briefing and team to do list (pop up on Home).
const svc = require('../lib/ledgerService');
const lib = require('../lib/briefing');
const reportsLib = require('../lib/marketingReports');

const fail = (res, err) => { console.error(err); res.status((err && err.status) || 500).json({ error: String((err && err.message) || err) }); };

async function current() {
  const pit = await svc.pit();
  let list = []; try { list = await reportsLib.listReports(); } catch (e) { /* the pop up still works without full reports */ }
  return lib.build({ pit, marketingList: list, todayIso: lib.isoFromDmy(pit.today) });
}

async function get(req, res) { try { res.json(await current()); } catch (err) { fail(res, err); } }
async function seen(req, res) { try { res.json(await lib.markSeen(req.body && req.body.keys)); } catch (err) { fail(res, err); } }
// To do changes return the fresh list so the page can redraw without a second call.
const todo = (fn) => async (req, res) => { try { await fn(req.body || {}); const b = await current(); res.json({ ok: true, todos: b.todos, done: b.done, today: b.today }); } catch (err) { fail(res, err); } };

module.exports = { get, seen, add: todo(lib.addTodo), done: todo(lib.setDone), remove: todo(lib.removeTodo) };
