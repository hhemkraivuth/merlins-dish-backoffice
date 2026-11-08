// Monthly overheads: list, add (the Repeat button), stop. And the run that logs them on the 1st.
const appState = require('../lib/appState');
const r = require('../lib/recurringOverheads');
const { getUsdRate } = require('../lib/usdRate');
const { bangkokToday } = require('../lib/dates');

const store = { get: appState.getState, set: appState.setState };
const fail = (res, err) => { console.error(err); res.status(500).json({ error: String((err && err.message) || err) }); };
const load = async () => r.parse(await store.get(r.KEY));
const view = (list) => list.map((x) => ({ id: x.id, name: x.name, category: x.category, shop: x.shop, usd: x.usd, thb: x.thb, text: r.describe(x), last: x.last }));

async function listJson(req, res) {
  try {
    const list = await load();
    const rate = list.some((x) => x.usd) ? await getUsdRate({ store }) : null;
    res.json({ items: view(list), rate: rate ? rate.rate : null });
  } catch (err) { fail(res, err); }
}

// The Repeat button on a row: { name, category, shop, thb, usd, date }. A dollar item stays in dollars.
async function add(req, res) {
  try {
    const b = req.body || {};
    const from = require('../lib/dates').parseDate(b.date, bangkokToday()) || bangkokToday();
    const out = r.addItem(await load(), { name: b.name, category: b.category, shop: b.shop, usd: b.usd, thb: b.thb }, from);
    if (out.error) return res.status(400).json({ error: out.error });
    await store.set(r.KEY, JSON.stringify(out.list));
    res.json({ ok: true, items: view(out.list) });
  } catch (err) { fail(res, err); }
}

async function stop(req, res) {
  try {
    const id = String((req.body && req.body.id) || '');
    const list = r.stopItem(await load(), id);
    await store.set(r.KEY, JSON.stringify(list));
    res.json({ ok: true, items: view(list) });
  } catch (err) { fail(res, err); }
}

// Used by the timer. Logs every item not yet logged this month.
async function runMonthly() {
  const { appendRows } = require('../lib/sheets');
  const cookLog = require('../lib/cookLog');
  const o = require('../lib/overheads');
  const list = await load();
  return r.runDue(list, bangkokToday(), {
    getRate: () => getUsdRate({ store }),
    appendOverheads: async (rows) => { await cookLog.ensureTab(o.TAB, o.HEADERS); await appendRows(o.TAB, rows); },
    save: (next) => store.set(r.KEY, JSON.stringify(next)),
  });
}

module.exports = { listJson, add, stop, runMonthly };
