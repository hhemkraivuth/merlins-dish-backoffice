// Money Lily has borrowed from Merlin's Dish, one amount per month. Editable on the Numbers page.
// Stored in the "Borrowed" tab of the Claude Log (Month | Amount | Note), Month written as 2026-10.
// July and August come from the "Borrowed" notes in the Merlin's numbers Log tab until the tab says otherwise.
const { readTab, appendRows, updateCells } = require('./sheets');
const { ensureTab } = require('./cookLog');
const { num } = require('./ledger');

const TAB = 'Borrowed';
const HEADERS = ['Month', 'Amount', 'Note'];
const KNOWN = { '2026-07': 13629.93, '2026-08': 15069.12 };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseBorrowed(rows) {
  const out = new Map(Object.entries(KNOWN));
  (rows || []).forEach((r, i) => {
    if (i === 0 && /month/i.test(String(r[0] || ''))) return;
    const key = String(r[0] || '').trim();
    const amount = num(r[1]);
    if (MONTH.test(key) && amount !== null) out.set(key, amount);
  });
  return out;
}

async function loadBorrowed() {
  try { return parseBorrowed(await readTab(TAB)); } catch (err) { return parseBorrowed([]); }
}

// month: "2026-10". amount: a number, or blank to clear. Updates the month's row, or adds one.
async function saveBorrowed(month, amount) {
  const key = String(month || '').trim();
  if (!MONTH.test(key)) throw new Error('The month must look like 2026-10.');
  const value = String(amount ?? '').trim() === '' ? 0 : num(amount);
  if (value === null || value < 0) throw new Error('Borrowed must be a number, zero or more.');
  await ensureTab(TAB, HEADERS);
  const rows = await readTab(TAB);
  const at = rows.findIndex((r, i) => i > 0 && String(r[0] || '').trim() === key);
  if (at >= 0) await updateCells(TAB, at + 1, [{ col: 1, value }]);
  else await appendRows(TAB, [[key, value, '']], { raw: true });
  return { month: key, amount: value };
}

module.exports = { loadBorrowed, saveBorrowed, parseBorrowed, TAB, HEADERS, KNOWN };
