// Stock Counts from the LINE group.
//
//   stock                       -> list every item with its count and when it was last updated
//   stock coke zero zero 5      -> set that item's count to 5 (the full item name is needed)
//   stock add Cup 12oz, set, 40 -> add a new item: name, unit, starting count
//   stock add packaging         -> add the 4 packaging items from the recipe tabs at 0 (skips any already there)
//
// Same tab and same rules as the web page: your number always wins from that point on.

const { formatBangkokStamp } = require('./dates');

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const num = (s) => Number(String(s).replace(',', '.'));

// Exact name only (case and spacing ignored). Near matches are offered, never applied.
function findItem(items, name) {
  const n = norm(name);
  const exact = items.find((i) => norm(i.itemName) === n);
  if (exact) return { item: exact };
  const words = n.split(' ').filter(Boolean);
  const hits = items.filter((i) => {
    const t = norm(i.itemName);
    return t.includes(n) || n.includes(t) || words.some((w) => w.length >= 3 && t.split(' ').includes(w));
  });
  return { hits };
}

// The packaging used by the dish tabs in Merlin's numbers. Foil is overhead, so it is not tracked.
const PACKAGING_ITEMS = ['Packaging Cup (26oz)', 'Packaging Cup (16oz)', 'Packaging Cup (12oz)', 'Packaging Box (carb600ml)'];

// Adds any missing packaging items at 0 so batches can take cups off. Never touches an item that already exists.
async function seedPackaging(deps) {
  const items = await deps.getAll();
  const have = new Set(items.map((i) => norm(i.itemName)));
  const added = [];
  for (const name of PACKAGING_ITEMS) {
    if (have.has(norm(name))) continue;
    await deps.setCount(name, 0, 'Set', 'Seed');
    added.push(name);
  }
  return { added, skipped: PACKAGING_ITEMS.filter((n) => !added.includes(n)) };
}

const line = (i) => `• ${i.itemName}: ${i.currentCount}${i.unit ? ' ' + i.unit : ''} (updated ${formatBangkokStamp(i.lastUpdated) || 'never'}${i.lastUpdatedBy ? ', ' + i.lastUpdatedBy : ''})`;

const USAGE = 'Stock commands:\nstock (list everything)\nstock coke zero zero 5 (set a count)\nstock add Cup 12oz, set, 40 (add an item: name, unit, count)';

// deps: { getAll(), setCount(name, count, unit, by) }. Returns an array of replies, or null if the text is not a stock command.
async function processStock(text, deps) {
  const m = String(text || '').trim().match(/^stock(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const rest = (m[1] || '').trim();
  const items = await deps.getAll();

  if (!rest || /^(list|all)$/i.test(rest)) {
    if (!items.length) return ['No stock items yet. Add one with: stock add Cup 12oz, set, 40'];
    return [`Stock counts:\n${items.map(line).join('\n')}`];
  }

  if (/^add\s+packaging$/i.test(rest)) {
    const r = await seedPackaging(deps);
    return [r.added.length
      ? `Added at 0 (please set the real counts): ${r.added.join(', ')}.${r.skipped.length ? `\nAlready there: ${r.skipped.join(', ')}.` : ''}`
      : 'All packaging items are already in Stock Counts. Nothing changed.'];
  }

  const add = rest.match(/^add\s+(.+?)\s*,\s*(.*?)\s*,\s*(\d+(?:[.,]\d+)?)$/i);
  if (add) {
    const [, name, unit, count] = add;
    if (findItem(items, name).item && norm(findItem(items, name).item.itemName) === norm(name)) {
      return [`"${name}" is already tracked. To change its count send: stock ${name} ${count}`];
    }
    await deps.setCount(name, num(count), unit, 'LINE');
    return [`Added ${name}: ${num(count)} ${unit}.`];
  }

  const set = rest.match(/^(.+?)\s*[:=]?\s+(\d+(?:[.,]\d+)?)$/);
  if (!set) return [`I couldn't read that.\n${USAGE}`];
  const [, name, count] = set;
  const { item, hits } = findItem(items, name);
  if (!item) {
    if (hits && hits.length) return [`Nothing changed. "${name}" is not an exact item name. Did you mean:\n${hits.map((h) => `• ${h.itemName}`).join('\n')}\nSend the full name, for example: stock ${hits[0].itemName} ${count}`];
    return [`Nothing changed. "${name}" isn't a tracked item. Check the spelling with "stock", or add it: stock add ${name}, unit, ${count}`];
  }
  const n = num(count);
  await deps.setCount(item.itemName, n, item.unit, 'LINE');
  return [`${item.itemName}: ${item.currentCount} → ${n}${item.unit ? ' ' + item.unit : ''}. Updated ${formatBangkokStamp(new Date().toISOString())}.`];
}

module.exports = { processStock, seedPackaging, PACKAGING_ITEMS, USAGE };
