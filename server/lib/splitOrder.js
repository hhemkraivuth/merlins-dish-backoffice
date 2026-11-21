// Turns one order row that holds several items ("Dbs + tubet", or an item Grab printed as XXXXXX) into proper Ledger rows:
// one Order row per item, plus a Recipe row for every pasta, the way the nightly Grab task writes them.
//
//   Dark Beer Stew + Tubetti, total ฿350  ->  Order "Dark Beer Stew" ฿295, Order "Tubetti" ฿55, Recipe "Tubetti"
//
// Stews, braises and soups never get a Recipe row (their cost comes from the batch). Pasta prices follow the house rules:
// standalone or with a stew 55 for Radiatori and Tubetti, 50 for the others; bundled with Bolognese or Ragu 5, or 0 for the others.
// The one item that is not a pasta gets whatever is left of the total, and the total never changes.
const { PASTAS, batchDishOf, normName } = require('./dishes');
const { defaultShorthand } = require('./aliases');

const pretty = (p) => p.charAt(0).toUpperCase() + p.slice(1);
const BIG_PASTA = new Set(['radiatori', 'tubetti']);
const round2 = (n) => Math.round(n * 100) / 100;

function descFor(canon, ledger) {
  // The wording Lily's books already use for this dish, so reports group it with the rest.
  const counts = new Map();
  for (const r of ledger) { if (r.type !== 'Order' || batchDishOf(r.desc) !== canon) continue; const d = r.desc.replace(/\s*\(.*\)\s*$/, '').trim(); if (d) counts.set(d, (counts.get(d) || 0) + 1); }
  let best = null; for (const [d, n] of counts) if (!best || n > best.n) best = { d, n };
  return best ? best.d : canon.replace(/^./, (c) => c.toUpperCase());
}

function resolve(token, shorthand, ledger) {
  const raw = String(token || '').trim();
  const t = normName(raw);
  if (!t) return null;
  const pasta = PASTAS.find((p) => t.length >= 3 && p.startsWith(t.replace(/pasta/, '')));
  if (pasta && !(shorthand.dishes.get(t))) return { kind: 'pasta', pasta, name: pretty(pasta) };
  let canon = shorthand.dishes.get(t) || null;
  if (!canon && t.length >= 3) { for (const [a, full] of shorthand.dishes) if (a.startsWith(t) || normName(full).startsWith(t)) { canon = full; break; } }
  if (canon) { const c = batchDishOf(canon) || canon; return { kind: 'batch', canon: c, name: descFor(c, ledger) }; }
  const known = ledger.find((r) => r.type === 'Order' && normName(r.desc) === t);
  if (known) return { kind: 'other', name: known.desc, price: known.moneyIn };
  return null;
}

// order: the Order row (object). text: what Lily typed. ledger: all ledger objects. Returns { items, error }.
function plan(order, text, ledger, shorthand = defaultShorthand()) {
  const tokens = String(text || '').split(/\s*(?:\+|,|&|\band\b|\bwith\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) return { error: 'Type the items, for example: Dark Beer Stew + Tubetti' };
  const found = [];
  for (const tok of tokens) {
    const it = resolve(tok, shorthand, ledger);
    if (!it) return { error: `I don't know "${tok}". Use the dish name or its shorthand, one item for each +.` };
    found.push(it);
  }
  const qty = order.qty || 1;
  const total = round2((order.moneyIn || 0) * qty);
  const bundleWith = found.find((i) => i.kind === 'batch' && /bolognese|ragu/i.test(i.canon));
  const hasPartner = found.some((i) => i.kind !== 'pasta');
  const items = found.map((it) => {
    if (it.kind !== 'pasta') return { ...it, price: it.price ?? null };
    const bundled = bundleWith && hasPartner;
    const price = bundled ? (BIG_PASTA.has(it.pasta) ? 5 : 0) : (BIG_PASTA.has(it.pasta) ? 55 : 50);
    return { ...it, price, desc: bundled ? `${it.name} (${/ragu/i.test(bundleWith.canon) ? 'Ragu' : 'Bolognese'} bundle)` : it.name };
  });
  const open = items.filter((i) => i.kind !== 'pasta');
  const fixed = items.filter((i) => i.kind === 'pasta').reduce((s, i) => s + i.price * qty, 0);
  if (open.length === 1) open[0].price = round2((total - fixed) / qty);
  else if (open.some((i) => i.price == null)) return { error: 'With more than one dish I need each dish to have sold before, so I can copy its price. Add them one at a time.' };
  for (const i of items) if (i.kind !== 'pasta') i.desc = i.name;
  const sum = round2(items.reduce((s, i) => s + i.price * qty, 0));
  if (Math.abs(sum - total) > 0.009 || items.some((i) => !(i.price >= 0))) return { error: `These items add up to ฿${sum} but the order is ฿${total} (qty ${qty}). Check the items, or fix the amount in Numbers first.` };
  return { items, total, qty };
}

// orderKeys: keys of the rows to rebuild (the Order row and any Recipe rows). raw: raw ledger sheet rows. Returns the writes.
function rowsToWrite(order, recipes, p, rawOrder, COL) {
  const edits = []; const adds = []; const deletes = [];
  const [first, ...rest] = p.items;
  edits.push({ key: order.key, changes: { desc: first.desc, moneyIn: first.price, net: round2(first.price * p.qty) } });
  const mk = (i, type, over) => { const r = new Array(14).fill(''); r[COL.date] = rawOrder[COL.date]; r[COL.channel] = order.channel; r[COL.type] = type; r[COL.qty] = p.qty; r[COL.key] = `${order.key}|s${i}`; return Object.assign(r, over); };
  rest.forEach((it, n) => adds.push(mk(n + 1, 'Order', { [COL.desc]: it.desc, [COL.moneyIn]: it.price, [COL.net]: round2(it.price * p.qty) })));
  const pastas = p.items.filter((i) => i.kind === 'pasta');
  const spare = [...recipes];
  pastas.forEach((it, n) => {
    const r = spare.shift();
    if (r) edits.push({ key: r.key, changes: { desc: it.name, cost: '', net: '' } });
    else adds.push(mk(`r${n}`, 'Recipe', { [COL.desc]: it.name }));
  });
  for (const r of spare) deletes.push(r.key); // leftover placeholder Recipe rows
  return { edits, adds, deletes };
}

module.exports = { plan, rowsToWrite, resolve };
