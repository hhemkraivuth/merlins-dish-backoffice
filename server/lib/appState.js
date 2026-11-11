// A tiny key and value store in the "App State" tab, for things the app must remember across restarts and deploys.
// Used so the daily huddle is only sent once a day, however many times the app restarts.
const { readTab, readTabFresh, appendRows, updateCells } = require('./sheets');
const { ensureTab } = require('./cookLog');

const TAB = 'App State';
const HEADERS = ['Key', 'Value', 'Updated'];

async function getState(key) {
  let rows = [];
  try { rows = await readTab(TAB); } catch (err) { if (/unable to parse range|not found/i.test(String(err.message))) return ''; throw err; }
  const row = (rows || []).slice(1).find((r) => String(r[0] || '').trim() === key);
  return row ? String(row[1] || '').trim() : '';
}

async function setState(key, value) {
  await ensureTab(TAB, HEADERS);
  const rows = await (readTabFresh || readTab)(TAB);
  const at = rows.findIndex((r, i) => i > 0 && String(r[0] || '').trim() === key);
  const stamp = new Date().toISOString();
  if (at >= 0) await updateCells(TAB, at + 1, [{ col: 1, value }, { col: 2, value: stamp }]);
  else await appendRows(TAB, [[key, value, stamp]], { raw: true });
}

module.exports = { getState, setState, TAB };
