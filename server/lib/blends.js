// Blends: one recipe ingredient made from two or more stocked ingredients, in fixed parts.
//   Red wine   = 1 part Red wine (Ti) + 1 part Red wine (Familia)
//   Thyme      = 3 parts Thyme (McCormick) + 5 parts Thyme (Nguan Soon)
// When a batch uses the blend, each part is taken from its own stock lots (oldest first) in proportion, so the cost
// is the real mix of what was paid for each brand, and each brand's stock goes down by its own share.
// The parts are shares of the amount used (a ratio), so 3 tsp and 5 tsp is simply 3 and 5.
//
// Tab "Blends" in the Claude Log: Blend | Ingredient | Parts (one row per ingredient in the blend). Editable by hand too.
const { normName } = require('./priceBook');

const TAB = 'Blends';
const HEADERS = ['Blend', 'Ingredient', 'Parts'];

// rows: the tab as read (header first) -> Map(normalised blend name -> { name, parts: [{ name, parts, share }] }), shares add to 1
function parseBlends(rows = []) {
  const raw = new Map();
  rows.forEach((r, i) => {
    if (i === 0 && /blend/i.test(String(r[0] || ''))) return;
    const blend = String(r[0] || '').trim();
    const name = String(r[1] || '').trim();
    const parts = Number(String(r[2] || '').replace(',', '.'));
    if (!blend || !name || !(parts > 0)) return;
    const key = normName(blend);
    if (!raw.has(key)) raw.set(key, { name: blend, parts: [] });
    raw.get(key).parts.push({ name, parts });
  });
  const out = new Map();
  for (const [key, b] of raw) {
    if (b.parts.length < 2) continue; // a blend needs at least two ingredients
    const total = b.parts.reduce((s, p) => s + p.parts, 0);
    out.set(key, { name: b.name, parts: b.parts.map((p) => ({ ...p, share: p.parts / total })) });
  }
  return out;
}

const toRows = (blends) => {
  const rows = [HEADERS];
  for (const b of blends.values()) for (const p of b.parts) rows.push([b.name, p.name, p.parts]);
  return rows;
};

async function loadBlends() {
  const cookLog = require('./cookLog');
  const { readTab } = require('./sheets');
  await cookLog.ensureTab(TAB, HEADERS);
  return parseBlends(await readTab(TAB));
}

// parts: [{ name, parts }]. Replaces the blend if it exists.
async function saveBlend(name, parts) {
  const clean = (parts || []).map((p) => ({ name: String(p.name || '').trim(), parts: Number(p.parts) })).filter((p) => p.name && p.parts > 0);
  if (!String(name || '').trim()) throw new Error('Give the blend a name.');
  if (clean.length < 2) throw new Error('A blend needs at least two ingredients with parts above zero.');
  if (new Set(clean.map((p) => normName(p.name))).size !== clean.length) throw new Error('Each ingredient can only appear once in a blend.');
  if (clean.some((p) => normName(p.name) === normName(name))) throw new Error('An ingredient in the blend cannot have the same name as the blend.');
  const { writeTab } = require('./sheets');
  const blends = await loadBlends();
  blends.set(normName(name), { name: String(name).trim(), parts: clean });
  await writeTab(TAB, toRows(blends));
  return { name: String(name).trim(), parts: clean };
}

async function deleteBlend(name) {
  const { writeTab } = require('./sheets');
  const blends = await loadBlends();
  if (!blends.delete(normName(name))) throw new Error(`${name} is not a blend.`);
  await writeTab(TAB, toRows(blends));
}

module.exports = { parseBlends, loadBlends, saveBlend, deleteBlend, TAB, HEADERS };
