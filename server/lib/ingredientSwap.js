// Brand changes from the website: "recipes that say Polpa now use Pelati (Mutti Rosso)".
// The recipe itself is never touched. It is the same Swap row the LINE group's "swap" command writes in the Shorthand tab,
// with * as the dish so it applies to every dish that uses the line:  Swap | * | polpa | Pelati (Mutti Rosso) | from (YYYY-MM-DD)
const { normName } = require('./priceBook');

const key = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

// rows: Shorthand tab rows -> the swaps, newest last
function listSwaps(rows = []) {
  return rows.filter((r) => String(r[0] || '').trim().toLowerCase() === 'swap').map((r) => {
    const [dish, line] = String(r[1] || '').split('|').map((x) => x.trim());
    return { dish: dish || '', line: line || '', to: String(r[2] || '').trim(), from: String(r[3] || '').trim() };
  }).filter((s) => s.dish && s.line && s.to);
}

// deps: { readRows(), saveSwap(row), deleteSwaps(pred), loadCatalogue() }
async function addSwap({ old, to, from }, deps) {
  const oldName = String(old || '').trim();
  let fresh = String(to || '').trim();
  if (!oldName || !fresh) throw new Error('Say which ingredient the recipes use now and what they should use instead');
  const iso = String(from || '').trim();
  if (iso && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error('The start date must look like 2026-10-29');
  if (normName(oldName) === normName(fresh)) throw new Error('That is already the same ingredient');
  let note = '';
  try {
    const catalogue = await deps.loadCatalogue();
    const hit = catalogue.find((n) => key(n) === key(fresh));
    if (hit) fresh = hit;
    else note = `"${fresh}" is not in the Price Tracker yet, so batches will show no price for it until you add it to column B of the Price Tracker.`;
  } catch (err) { note = 'The Price Tracker could not be checked, so the name was saved as typed.'; }
  await deps.deleteSwaps((r) => String(r[0] || '').toLowerCase() === 'swap' && key(r[1]) === key(`*|${oldName}`) && String(r[3] || '').trim() === iso);
  await deps.saveSwap(['Swap', `* | ${oldName}`, fresh, iso]);
  return { ok: true, to: fresh, note };
}

async function removeSwap({ line, from }, deps) {
  const iso = String(from || '').trim();
  const n = await deps.deleteSwaps((r) => String(r[0] || '').toLowerCase() === 'swap' && key(String(r[1] || '').split('|').slice(1).join('|')) === key(line) && String(r[3] || '').trim() === iso);
  return { ok: true, removed: n };
}

module.exports = { listSwaps, addSwap, removeSwap };
