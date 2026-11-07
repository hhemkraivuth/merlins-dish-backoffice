// The menu bible: every item's names and descriptions in one place (Thai and English for the order app, the Grab name,
// the Grab description and its English translation). data/menuBible.json is the starting set from Lily's Menu Names doc.
// Every save, add or delete is a NEW row in the "Menu Bible Edits" tab of the Claude Log (never overwritten), so the last
// edit of each item is known and nothing is lost. The newest row for an item wins; a delete row hides the item.
const { readTab, appendRows } = require('./sheets');
const { ensureTab } = require('./cookLog');

const TAB = 'Menu Bible Edits';
const HEADERS = ['Item', 'Category', 'Fields', 'Saved', 'Deleted'];
const FIELDS = ['th', 'en', 'grabName', 'grabDesc', 'translation'];
const key = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

const blank = () => Object.fromEntries(FIELDS.map((f) => [f, '']));

// seed: parsed menuBible.json. rows: the edits tab as read (header first, or empty).
function merge(seed, rows = []) {
  const state = new Map(); // key -> { item, versions, saved, deleted }
  for (const s of seed.items || []) state.set(key(s.name), { item: { name: s.name, category: s.category || 'Other', ...blank(), ...Object.fromEntries(FIELDS.map((f) => [f, s[f] || ''])) }, versions: 0, saved: '', deleted: false });
  (rows || []).forEach((r, i) => {
    if (i === 0 && /^item$/i.test(String(r[0] || '').trim())) return;
    const name = String(r[0] || '').trim();
    if (!name) return;
    const k = key(name);
    const prev = state.get(k);
    if (String(r[4] || '').trim()) { if (prev) { prev.deleted = true; prev.saved = String(r[3] || ''); prev.versions += 1; } else state.set(k, { item: { name, category: String(r[1] || 'Other'), ...blank() }, versions: 1, saved: String(r[3] || ''), deleted: true }); return; }
    let f = {};
    try { f = JSON.parse(String(r[2] || '{}')); } catch (err) { f = {}; }
    const item = { name, category: String(r[1] || (prev && prev.item.category) || 'Other'), ...blank(), ...Object.fromEntries(FIELDS.map((x) => [x, String(f[x] ?? '')])) };
    state.set(k, { item, versions: (prev ? prev.versions : 0) + 1, saved: String(r[3] || ''), deleted: false });
  });
  const items = [...state.values()].filter((v) => !v.deleted).map((v) => ({ ...v.item, saved: v.saved, versions: v.versions }));
  const categories = [...new Set([...(seed.categories || []), ...items.map((i) => i.category)])];
  return { categories, items };
}

async function load(seed) {
  let rows = [];
  try { rows = await readTab(TAB); } catch (err) { if (!/unable to parse range|not found/i.test(String(err.message))) throw err; }
  return merge(seed, rows);
}

async function save(seed, { name, category, fields }) {
  const n = String(name || '').trim();
  if (!n) throw new Error('The item needs a name');
  const f = {}; for (const x of FIELDS) f[x] = String((fields || {})[x] ?? '').replace(/\r\n/g, '\n');
  await ensureTab(TAB, HEADERS);
  await appendRows(TAB, [[n, String(category || 'Other').trim() || 'Other', JSON.stringify(f), new Date().toISOString(), '']], { raw: true });
  return load(seed);
}

async function remove(seed, { name }) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Say which item to delete');
  await ensureTab(TAB, HEADERS);
  await appendRows(TAB, [[n, '', '', new Date().toISOString(), '1']], { raw: true });
  return load(seed);
}

module.exports = { merge, load, save, remove, TAB, FIELDS };
