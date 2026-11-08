// Counted stock (the Stock Counts tab: cans, bottles, tins, packets typed in by hand) turned into what the shopping plan
// understands: an amount in ml, g or pieces. A can, bottle, tin or jar only converts when the size of one is known
// (330 ml, 400 g), which is why those items ask for it. Items without a size are reported, never guessed.
// A brand in brackets is dropped ("Stout (Chiangmai Winter)" is Stout). A size in brackets stays ("Packaging Cup (12oz)" is its own item).
const baseNameOf = (n, normName) => normName(String(n || '').replace(/\s*\(([^)]*)\)\s*/g, (m, inner) => (/\d/.test(inner) ? m : ' ')));
const COUNT_WORDS = ['tin', 'tins', 'can', 'cans', 'bottle', 'bottles', 'bag', 'bags', 'pack', 'packs', 'packet', 'packets', 'jar', 'jars', 'box', 'boxes', 'sachet', 'sachets', 'set', 'sets'];

function toBase(qty, unit) {
  const u = String(unit || '').trim().toLowerCase();
  if (u === 'ml') return { qty, unit: 'ml' };
  if (u === 'l' || u === 'litre' || u === 'liter') return { qty: qty * 1000, unit: 'ml' };
  if (u === 'g') return { qty, unit: 'g' };
  if (u === 'kg') return { qty: qty * 1000, unit: 'g' };
  if (['pcs', 'pc', 'piece', 'pieces', 'set', 'sets'].includes(u)) return { qty, unit: 'piece' };
  return null;
}

// items: [{ itemName, unit, currentCount }]; sizes: { [normName]: { size, unit } }
function countedToStock(items, sizes, normName, existing = new Map()) {
  const out = new Map(); const warnings = [];
  const loose = new Map(); // counted in tins, cans, bags... with no size set: usable only by a recipe that counts pieces
  const names = new Map(); // key -> the name as typed on the Stock page
  for (const it of items || []) {
    const name = String(it.itemName || '').trim(); const count = Number(it.currentCount);
    if (!name || !(count > 0)) continue;
    const key = baseNameOf(name, normName);
    names.set(key, name);
    if (existing.has(key)) continue; // receipts based stock wins
    // Pieces with a known weight (bacon steak, 100 g each) become grams so the plan can use them.
    const pcsSize = ['pcs', 'pc', 'piece', 'pieces'].includes(String(it.unit || '').toLowerCase()) ? (sizes || {})[normName(name)] : null;
    const pcsPer = pcsSize && toBase(Number(pcsSize.size), pcsSize.unit);
    let b = pcsPer && pcsPer.unit !== 'piece' ? { qty: count * pcsPer.qty, unit: pcsPer.unit } : toBase(count, it.unit);
    if (!b) {
      const sz = (sizes || {})[normName(name)];
      const per = sz && toBase(Number(sz.size), sz.unit);
      if (per && per.unit !== 'piece') b = { qty: count * per.qty, unit: per.unit };
    }
    if (!b && COUNT_WORDS.includes(String(it.unit || '').trim().toLowerCase())) { const l = loose.get(key); if (l) l.left += count; else loose.set(key, { left: count, unit: 'piece', word: String(it.unit).trim().toLowerCase() }); }
    if (!b) { warnings.push(`${name} is counted in ${it.unit || 'units'} but the size of one is not set, so the shopping plan cannot use it. Tap it on the Stock page and type the ml or g.`); continue; }
    const have = out.get(key);
    if (have && have.unit === b.unit) have.left += b.qty; else if (!have) out.set(key, { left: b.qty, unit: b.unit });
  }
  return { stock: out, loose, names, warnings };
}

module.exports = { countedToStock, toBase, baseNameOf };
