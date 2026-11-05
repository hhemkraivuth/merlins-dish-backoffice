// How much is in one bottle, can or bag. A receipt that says "2 bottles" is turned into the real amount
// (2 x 290ml = 580ml) so recipes that use ml or g are costed correctly.
//
// Tab "Pack Sizes" in the Claude Log (Lily can edit it):  Ingredient | Size per container | Note
// Set one from LINE:  size worcestershire sauce 290ml

const { normName, parsePurchaseUnit, UNIT_FACTORS } = require('./priceBook');

const TAB = 'Pack Sizes';
const HEADERS = ['Ingredient', 'Size per container', 'Note'];
const DEFAULT_SIZES = [['Worcestershire Sauce', '290ml', 'one bottle']];

// Words that mean "a single piece" rather than a container.
const PLAIN_PIECE = new Set(['p', 'pc', 'pcs', 'piece', 'pieces']);

function isContainerWord(unitText) {
  const u = String(unitText || '').toLowerCase();
  return !!UNIT_FACTORS[u] && UNIT_FACTORS[u][0] === 'piece' && !PLAIN_PIECE.has(u);
}

// rows: the Pack Sizes tab as read (header first) -> Map(normalised name -> { name, qty, unit, text })
function parseSizes(rows = []) {
  const map = new Map();
  rows.forEach((r, i) => {
    if (i === 0 && /ingredient/i.test(String(r[0] || ''))) return;
    const name = String(r[0] || '').trim();
    const text = String(r[1] || '').replace(/\s+/g, '');
    const pu = parsePurchaseUnit(text);
    if (!name || !pu || !(pu.qty > 0) || pu.unit === 'piece') return;
    const w = String(r[2] || '').match(/\bone\s+([a-z]+)/i);
    map.set(normName(name), { name, qty: pu.qty, unit: pu.unit, text, word: w ? w[1].toLowerCase() : 'pack' });
  });
  return map;
}

// item: a parsed receipt item. Returns { purchaseUnit, costPerUnit, pack } or null when nothing applies.
function applyPackSize(item, name, sizes) {
  if (!sizes || !isContainerWord(item.unit)) return null;
  const size = sizes.get(normName(name));
  if (!size) return null;
  const total = item.qty * size.qty;
  const shown = Number(total.toFixed(3));
  return {
    purchaseUnit: `${shown}${size.unit}`,
    costPerUnit: Number((item.price / total).toFixed(5)),
    pack: `${item.qty} ${item.unit} x ${size.text}`,
  };
}

async function loadPackSizes() {
  const cookLog = require('./cookLog');
  const { readTab } = require('./sheets');
  await cookLog.ensureTab(TAB, HEADERS, DEFAULT_SIZES);
  return parseSizes(await readTab(TAB));
}

// Adds or changes one ingredient's size. `word` (can, bottle, bag) is kept in the Note column as "one can". Returns 'added' or 'changed'.
async function setPackSize(name, sizeText, word) {
  const cookLog = require('./cookLog');
  const { readTab, appendRows, updateRow } = require('./sheets');
  await cookLog.ensureTab(TAB, HEADERS, DEFAULT_SIZES);
  const rows = await readTab(TAB);
  const at = rows.findIndex((r, i) => i > 0 && normName(r[0]) === normName(name));
  const note = word ? `one ${word}` : '';
  if (at > 0) { await updateRow(TAB, at + 1, [name, sizeText, note || rows[at][2] || '']); return 'changed'; }
  await appendRows(TAB, [[name, sizeText, note]]);
  return 'added';
}


// ---- counting in packs (cans, bags, bottles) ------------------------------------------------------
// size: one entry from parseSizes. left is in the stock's own unit (g, ml). Returns null when the size is unknown
// or the stock is counted in a different unit, so the page falls back to plain grams or ml.
function packView(left, unit, size) {
  if (!size || size.unit !== unit || !(size.qty > 0)) return null;
  const packs = Math.round((left / size.qty) * 10) / 10;
  return { packs, size: size.text, word: size.word, label: packLabel(packs, size.word) };
}
function packLabel(n, word) {
  const w = String(word || 'pack');
  const plural = /(s|x|ch|sh)$/.test(w) ? `${w}es` : `${w}s`;
  return `${n} ${n === 1 ? w : plural}`;
}
// 36 cans of 330ml -> 11880 (ml)
function packsToBase(packs, size) { return Math.round(packs * size.qty * 1000) / 1000; }

module.exports = { packView, packLabel, packsToBase, parseSizes, applyPackSize, isContainerWord, loadPackSizes, setPackSize, TAB, HEADERS, DEFAULT_SIZES };
