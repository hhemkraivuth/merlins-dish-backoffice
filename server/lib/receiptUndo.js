// Every typed receipt gets an ID (R261104-153211 = Bangkok date and time sent). The ID is written into the Remarks of the
// Expense Log and Overheads rows and the Note of the stock lots, so "undo receipt" can take the whole receipt back out.

const ID = /R\d{6}-\d{6}/;
const ID_G = /R\d{6}-\d{6}/g;

function newReceiptId(nowMs = Date.now()) {
  const d = new Date(nowMs + 7 * 3600 * 1000).toISOString();   // Bangkok clock, read as UTC
  return `R${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}${d.slice(17, 19)}`;
}

const TABS = [
  { tab: 'Expense Log', col: 6, label: 'ingredient lines' },
  { tab: 'Overheads', col: 5, label: 'overhead items' },
  { tab: 'Ingredient Lots', col: 11, label: 'stock lots', lots: true },
];

function latestId(tabRows) {
  let best = '';
  for (const rows of tabRows) for (const r of rows) for (const cell of r) {
    for (const m of String(cell || '').match(ID_G) || []) if (m > best) best = m;
  }
  return best;
}

const COMMAND = /^undo\s+receipt(?:\s+(R\d{6}-\d{6}))?$/i;

// deps: { readRows(tab), deleteWhere(tab, predicate), after() }
async function processReceiptUndo(text, deps) {
  const m = String(text || '').trim().match(COMMAND);
  if (!m || !deps) return null;
  const data = [];
  for (const t of TABS) { try { data.push(await deps.readRows(t.tab)); } catch (err) { data.push([]); } }
  const id = (m[1] || latestId(data)).toUpperCase();
  if (!id) return ['No receipt with an ID found. Receipts sent before this feature have no ID, so delete those rows by hand in the Expense Log tab.'];
  const parts = [];
  const kept = [];
  for (const t of TABS) {
    const n = await deps.deleteWhere(t.tab, (r) => {
      if (!String(r[t.col] || '').includes(id)) return false;
      // A lot that a batch has already used from is kept, so the cost of that batch stays right.
      if (t.lots && Number(r[6]) < Number(r[4]) - 1e-6) { kept.push(`${r[1]} (${r[6]} of ${r[4]} left)`); return false; }
      return true;
    });
    if (n) parts.push(`${n} ${t.label}`);
  }
  if (deps.after) { try { await deps.after(); } catch (err) { /* best prices refresh is best effort */ } }
  if (!parts.length && !kept.length) return [`I found no rows for ${id}.`];
  const out = [`Receipt ${id} taken back out: ${parts.join(', ') || 'nothing removed'}.`];
  if (kept.length) out.push(`Kept because a batch already used some of it: ${kept.join(', ')}. Use "count" to correct the stock.`);
  out.push('If it had condiment packs, fix those with "stock set".');
  return out;
}

module.exports = { newReceiptId, processReceiptUndo, latestId, ID };
