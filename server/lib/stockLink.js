// Links hand counted stock items (the Stock page) to the ingredients the shopping plan needs (the recipes).
// The two lists are typed separately, so the names never match exactly: "Brisket" is "Beef - brisket", "Knorr - beef" is
// "Knorr cube - beef", "Wine - Ti" and "Wine - Familia" are the blend "Wine - Red - blend".
//
// Order of trust, first hit wins:
//   1. a link Lily set by hand (App State "stock_links": stock name to ingredient name)
//   2. the same name
//   3. a brand change (swap) between the two names, or a blend that lists the stock item as a part
//   4. the same words (any order, tiny spelling slips such as sholder / shoulder)
//   5. every word of the stock name found in exactly one ingredient name
// Anything that still has no match is returned as "unlinked" so it is shown, never silently ignored.

const { normName } = require('./priceBook');

const STOP = new Set(['cube', 'full', 'blend', 'brand', 'the', 'of', 'and']);
const stem = (w) => w.replace(/(ed|es|s)$/, '').replace(/e$/, '');
const tokens = (name) => String(name || '').toLowerCase().split(/[^a-z0-9฀-๿]+/).filter((w) => w && !STOP.has(w)).map(stem).filter(Boolean);

// one letter added, dropped or changed
function oneOff(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}
const same = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && oneOff(a, b));
const within = (small, big) => small.length > 0 && small.every((t) => big.some((u) => same(t, u)));
const equalSets = (a, b) => a.length > 0 && a.length === b.length && within(a, b) && within(b, a);

// needs: [{ key, name }]  stock: [{ key, name }]
// options: { links: {stockKey: ingredientName}, swaps: [{ from, to }], blends: Map(normName -> { name, parts: [{ name }] }) }
// Returns { assign: Map(stockKey -> needKey), blendOf: Map(needKey -> [stockKey]), unlinked: [stock item] }
function linkStock(needs, stock, { links = {}, swaps = [], blends = new Map() } = {}) {
  const needByKey = new Map(needs.map((n) => [n.key, n]));
  const assign = new Map();
  const blendOf = new Map();
  const needTok = needs.map((n) => ({ ...n, tok: tokens(n.name) }));

  // blends: the ingredient a blend stands for, and the stock items that are its parts
  for (const b of blends.values()) {
    const bt = tokens(b.name);
    const hit = needTok.find((n) => n.key === normName(b.name)) || needTok.find((n) => equalSets(bt, n.tok));
    if (!hit) continue;
    for (const p of b.parts || []) {
      const item = stock.find((s) => s.key === normName(p.name));
      if (!item) continue;
      assign.set(item.key, hit.key);
      if (!blendOf.has(hit.key)) blendOf.set(hit.key, []);
      blendOf.get(hit.key).push(item.key);
    }
  }

  for (const s of stock) {
    if (assign.has(s.key)) continue;
    const userTo = links[s.key] ? normName(links[s.key]) : '';
    if (userTo && needByKey.has(userTo)) { assign.set(s.key, userTo); continue; }
    if (needByKey.has(s.key)) { assign.set(s.key, s.key); continue; }
    const swap = swaps.find((w) => (normName(w.from) === s.key && needByKey.has(normName(w.to))) || (normName(w.to) === s.key && needByKey.has(normName(w.from))));
    if (swap) { assign.set(s.key, needByKey.has(normName(swap.to)) && normName(swap.from) === s.key ? normName(swap.to) : normName(swap.from)); continue; }
    const st = tokens(s.name);
    const exact = needTok.filter((n) => equalSets(st, n.tok));
    if (exact.length === 1) { assign.set(s.key, exact[0].key); continue; }
    if (exact.length > 1) continue;
    const sub = needTok.filter((n) => within(st, n.tok));
    if (sub.length === 1) assign.set(s.key, sub[0].key);
  }
  const unlinked = stock.filter((s) => !assign.has(s.key));
  return { assign, blendOf, unlinked };
}

module.exports = { linkStock, tokens };
