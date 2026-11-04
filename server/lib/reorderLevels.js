// "Tell me when it is running low". One level per ingredient, in the Reorder Levels tab of the Claude Log
// (Ingredient | Alert when below | Note). Set one from LINE:  low salt 500g
// An ingredient is low when what the stock lots say is left is below its level. Used by "lots", "low" and the huddle.

const { normName, toBaseQty } = (() => ({ normName: require('./priceBook').normName, toBaseQty: require('./ingredientLots').toBaseQty }))();

const TAB = 'Reorder Levels';
const HEADERS = ['Ingredient', 'Alert when below', 'Note'];

// rows: the tab as read (header first) -> Map(normalised name -> { name, qty, unit, text })
function parseLevels(rows = []) {
  const map = new Map();
  rows.forEach((r, i) => {
    if (i === 0 && /ingredient/i.test(String(r[0] || ''))) return;
    const name = String(r[0] || '').trim();
    const text = String(r[1] || '').replace(/\s+/g, '');
    const pu = toBaseQty(text);
    if (!name || !pu || !(pu.qty > 0)) return;
    map.set(normName(name), { name, qty: pu.qty, unit: pu.unit, text });
  });
  return map;
}

// book: a LotBook. Returns [{ name, left, level, unit }] for every tracked ingredient below its level.
function lowItems(book, levels) {
  const out = [];
  for (const [key, lv] of levels) {
    const lots = book.lots.get(key);
    if (!lots || !lots.length) continue;
    if (lots[0].unit !== lv.unit) continue;
    const left = book.totalRemaining(lots[0].name);
    if (left < lv.qty) out.push({ name: lots[0].name, left, level: lv.qty, unit: lv.unit });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadLevels() {
  const cookLog = require('./cookLog');
  const { readTab } = require('./sheets');
  await cookLog.ensureTab(TAB, HEADERS);
  return parseLevels(await readTab(TAB));
}

async function setLevel(name, text) {
  const cookLog = require('./cookLog');
  const { readTab, appendRows, updateRow } = require('./sheets');
  await cookLog.ensureTab(TAB, HEADERS);
  const rows = await readTab(TAB);
  const at = rows.findIndex((r, i) => i > 0 && normName(r[0]) === normName(name));
  if (at > 0) { await updateRow(TAB, at + 1, [name, text, rows[at][2] || '']); return 'changed'; }
  await appendRows(TAB, [[name, text, '']]);
  return 'added';
}

module.exports = { parseLevels, lowItems, loadLevels, setLevel, TAB, HEADERS };
