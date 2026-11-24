// Fresh produce that comes off the Stock page until Lily says to bring it back.
//
// Hidden items are left out of the Stock page lists, the low stock alerts and the shopping urgent list. They still cost on every
// batch through the receipt lots (nothing about costing changes), and a lot that runs short does not warn while the item is hidden.
// The list lives in App State, so it survives deploys. Starts with the fresh produce Lily picked on 24/11/2026.
//
//   hide onion            takes an item off the Stock page
//   bring back onion      puts it back
//   bring back all        puts everything back
//   hidden                shows what is hidden

const KEY = 'stock_hidden';
const DEFAULT = ['Broccoli', 'Carrot', 'Celery', 'Garlic', 'Mushroom - white', 'Onion', 'Potato', 'Milk'];

// "Mushroom - white", "mushroom white" and "Butter (allowrie)" vs "Butter" all compare on letters and numbers only, brand brackets dropped.
const key = (n) => String(n || '').replace(/\s*\([^)]*\)\s*/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const cap = (t) => String(t || '').trim().replace(/^./, (c) => c.toUpperCase());

const parse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String).filter(Boolean) : null; } catch (err) { return null; } };

async function load(store = require('./appState')) {
  const raw = await store.getState(KEY);
  if (!raw) return DEFAULT.slice();
  return parse(raw) || DEFAULT.slice();
}

async function save(list, store = require('./appState')) { await store.setState(KEY, JSON.stringify(list)); return list; }

const setOf = (list) => new Set((list || []).map(key));
const isHidden = (name, hidden) => (hidden instanceof Set ? hidden : setOf(hidden)).has(key(name));

async function hide(names, store) {
  const cur = await load(store); const have = setOf(cur);
  for (const n of [].concat(names)) { const t = cap(n); if (t && !have.has(key(t))) { cur.push(t); have.add(key(t)); } }
  return save(cur, store);
}

async function bringBack(names, store) {
  const cur = await load(store);
  const gone = names === 'all' ? setOf(cur) : setOf([].concat(names));
  return save(cur.filter((n) => !gone.has(key(n))), store);
}

// Text commands. Returns reply lines, or null when the text is not one of these.
async function processHidden(text, store) {
  const t = String(text || '').trim();
  const list = (l) => (l.length ? l.join(', ') : 'nothing');
  if (/^hidden$/i.test(t)) return [`Hidden for now: ${list(await load(store))}. Send "bring back onion" to put one back.`];
  let m = t.match(/^bring\s*back\s+(.+)$/i);
  if (m) {
    const what = m[1].trim();
    if (/^all$/i.test(what)) { await bringBack('all', store); return ['Everything is back on the Stock page.']; }
    const cur = await load(store); const found = cur.filter((n) => key(n) === key(what));
    if (!found.length) return [`${what} is not hidden. Hidden for now: ${list(cur)}.`];
    const after = await bringBack(what, store);
    return [`${found[0]} is back on the Stock page. Hidden for now: ${list(after)}.`];
  }
  m = t.match(/^hide\s+(.+)$/i);
  if (m) {
    const after = await hide(m[1].trim(), store);
    return [`${cap(m[1])} is off the Stock page. Hidden for now: ${list(after)}. It still costs on every batch.`];
  }
  return null;
}

module.exports = { load, save, hide, bringBack, isHidden, setOf, key, processHidden, DEFAULT, KEY };
