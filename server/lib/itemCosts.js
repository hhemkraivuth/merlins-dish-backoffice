// Costs typed in BOH for items the books have no cost for (a drink, a side, anything sold with no cost on record).
// Append only, newest row for an item wins: tab "Item Costs" in the Claude Log, columns Item | Saved | Cost (฿ per portion).
// Typed from the Audit page, so Lily never has to open a sheet tab. The sheets stay read only for the app.
const { readTab, appendRows } = require('./sheets');
const { ensureTab } = require('./cookLog');
const { normName } = require('./priceBook');

const TAB = 'Item Costs';
const HEADERS = ['Item', 'Saved', 'Cost'];

function parse(rows = []) {
  const out = new Map();
  (rows || []).forEach((r, i) => {
    if (i === 0 && /^item$/i.test(String(r[0] || '').trim())) return;
    const name = String(r[0] || '').trim();
    const cost = Number(String(r[2] ?? '').replace(/[฿,\s]/g, ''));
    if (!name || !Number.isFinite(cost) || cost <= 0) return;
    out.set(normName(name), { name, cost, saved: String(r[1] || '') });
  });
  return out;
}

async function load() {
  let rows = [];
  try { rows = await readTab(TAB); } catch (err) { if (!/unable to parse range|not found/i.test(String(err.message))) throw err; }
  return parse(rows);
}

async function save(name, cost) {
  const n = String(name || '').trim();
  const c = Number(String(cost ?? '').replace(/[฿,\s]/g, ''));
  if (!n) throw new Error('Which item is this cost for?');
  if (/^x{3,}$/i.test(n)) throw new Error('That item name could not be read, so it has no cost to save. Fix the name first.');
  if (!Number.isFinite(c) || c <= 0) throw new Error('The cost must be a number above 0');
  await ensureTab(TAB, HEADERS);
  await appendRows(TAB, [[n, new Date().toISOString(), c]], { raw: true });
  return { name: n, cost: c };
}

// Gives every Recipe row that has no cost its typed item cost, and adds the typed costs to the cost table (ledger.pastaCosts).
function applyToLedger(ledger, items) {
  if (!items || !items.size) return ledger;
  for (const r of ledger) {
    if (r.type !== 'Recipe' || (r.cost !== null && r.cost > 0)) continue;
    const it = items.get(normName(r.desc));
    if (!it) continue;
    r.cost = it.cost;
    if (r.qty !== null && r.qty !== undefined) r.net = -(r.qty * it.cost);
  }
  const map = new Map(ledger.pastaCosts || []);
  for (const [k, it] of items) if (!map.has(k)) map.set(k, it.cost);
  ledger.pastaCosts = map;
  return ledger;
}

module.exports = { parse, load, save, applyToLedger, TAB, HEADERS };
