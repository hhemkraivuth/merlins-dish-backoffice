// Bagged meat. Brisket is bought in one big lot (8 to 10 kg), split into bags of different weights, and leftovers wait
// to be combined into one batch (1,600 g). So the item is counted in grams, and the bags are a list under it.
// The item's count in Stock Counts is always the total of its bags, so the red rule, the shopping plan and the home page
// all read grams. A batch is red when the total is below what one batch uses.
const appState = require('./appState');
const KEY = 'stock_bags'; // { [normName]: { bags: [g, ...], batch: g } }

function parseBags(input) {
  if (Array.isArray(input)) return input.map(Number).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.round(n * 100) / 100);
  // "220 x 5" means five bags of 220 (weight first, then how many).
  const t = String(input || '').replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d+(?:\.\d+)?)\s*(?:g|pcs)?\s*[x×*]\s*(\d+)\b/gi, (m, w, n) => Array(Math.min(Number(n), 200)).fill(w).join(' ')).replace(/g\b/gi, ' ');
  return t.split(/[\s,;+]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.round(n * 100) / 100);
}
const total = (bags) => Math.round((bags || []).reduce((a, b) => a + b, 0) * 100) / 100;

// The bags that reach the batch weight with the least left over in the pot, using as few bags as possible among ties.
// If everything together is short, all bags are used and the shortfall is reported. Up to 20 bags are searched exactly.
function suggest(bags, target) {
  const list = (bags || []).slice().sort((a, b) => b - a);
  const need = Number(target);
  if (!(need > 0)) return { use: [], leave: list, short: 0, over: 0 };
  const sum = total(list);
  if (sum < need) return { use: list, leave: [], short: Math.round((need - sum) * 100) / 100, over: 0 };
  const n = Math.min(list.length, 20);
  let best = null;
  for (let mask = 1; mask < (1 << n); mask++) {
    let s = 0; let c = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { s += list[i]; c += 1; }
    if (s + 1e-9 < need) continue;
    const over = s - need;
    if (!best || over < best.over - 1e-9 || (Math.abs(over - best.over) < 1e-9 && c < best.c)) best = { mask, over, c };
  }
  const use = []; const leave = [];
  list.forEach((g, i) => { if (i < n && best && (best.mask & (1 << i))) use.push(g); else leave.push(g); });
  return { use, leave, short: 0, over: Math.round((best ? best.over : 0) * 100) / 100 };
}

async function load() {
  try { return JSON.parse((await appState.getState(KEY)) || '{}'); } catch (err) { return {}; }
}
async function saveAll(map) { await appState.setState(KEY, JSON.stringify(map)); }

module.exports = { parseBags, total, suggest, load, saveAll, KEY };
