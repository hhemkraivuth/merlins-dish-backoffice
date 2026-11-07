// Recipes (the how to for each batch dish) that Lily can edit on the Recipes page.
//
// data/recipes.json is the starting set. Every save is added as a new row in the "Recipe Edits" tab of the Claude Log
// (Dish | Category | Title | Text | Saved), never overwritten, so the last edit of each dish is known and older versions
// can be brought back. The newest row for a dish wins; a dish with no rows shows the starting text.
const { readTab, appendRows } = require('./sheets');
const { ensureTab } = require('./cookLog');

const TAB = 'Recipe Edits';
const HEADERS = ['Dish', 'Category', 'Title', 'Text', 'Saved'];
const CATEGORIES = ['Stews', 'Pasta', 'Soups', 'Other'];

const keyOf = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

function guessCategory(name) {
  const n = String(name || '').toLowerCase();
  if (/soup/.test(n)) return 'Soups';
  if (/stew|braise/.test(n)) return 'Stews';
  if (/ragu|ragù|bolognese|rosso|pasta|sauce/.test(n)) return 'Pasta';
  return 'Other';
}

// seed: the parsed recipes.json. rows: the Recipe Edits tab as read (header first, or empty).
function merge(seed, rows = []) {
  const history = new Map();
  (rows || []).forEach((r, i) => {
    if (i === 0 && /^dish$/i.test(String(r[0] || '').trim())) return;
    const dish = String(r[0] || '').trim();
    if (!dish || !String(r[3] || '').trim()) return;
    const list = history.get(keyOf(dish)) || [];
    list.push({ dish, category: CATEGORIES.includes(String(r[1] || '').trim()) ? String(r[1]).trim() : guessCategory(dish), title: String(r[2] || '').trim() || dish, text: String(r[3]), saved: String(r[4] || '').trim() });
    history.set(keyOf(dish), list);
  });
  const out = [];
  const used = new Set();
  for (const d of seed.dishes || []) {
    const h = history.get(keyOf(d.dish)) || [];
    used.add(keyOf(d.dish));
    const last = h[h.length - 1];
    out.push(last
      ? { dish: d.dish, category: last.category, title: last.title, lines: last.text.split('\n'), updated: d.updated, saved: last.saved, versions: h.length }
      : { dish: d.dish, category: guessCategory(d.dish), title: d.title, lines: d.lines, updated: d.updated, saved: '', versions: 0 });
  }
  for (const [k, h] of history) {
    if (used.has(k)) continue;
    const last = h[h.length - 1];
    out.push({ dish: last.dish, category: last.category, title: last.title, lines: last.text.split('\n'), updated: '', saved: last.saved, versions: h.length });
  }
  return { ...seed, categories: CATEGORIES, dishes: out, history: Object.fromEntries([...history].map(([k, h]) => [k, h.slice(-10).reverse().map((v) => ({ title: v.title, category: v.category, text: v.text, saved: v.saved }))])) };
}

async function load(seed) {
  let rows = [];
  try { rows = await readTab(TAB); } catch (err) { if (!/unable to parse range|not found/i.test(String(err.message))) throw err; }
  return merge(seed, rows);
}

async function save(seed, { dish, category, title, text }) {
  const name = String(dish || '').trim();
  const body = String(text || '').replace(/\r\n/g, '\n');
  if (!name) throw new Error('The recipe needs a name');
  if (!body.trim()) throw new Error('The recipe text is empty. Nothing was saved.');
  const cat = CATEGORIES.includes(category) ? category : guessCategory(name);
  await ensureTab(TAB, HEADERS);
  await appendRows(TAB, [[name, cat, String(title || name).trim(), body, new Date().toISOString()]], { raw: true });
  return load(seed);
}

module.exports = { merge, load, save, guessCategory, CATEGORIES, TAB };
