// Counted stock (the Stock Counts tab: cans, bottles, tins, packets typed in by hand) turned into what the shopping plan
// understands: an amount in ml, g or pieces. A can, bottle, tin or jar only converts when the size of one is known
// (330 ml, 400 g), which is why those items ask for it. Items without a size are reported, never guessed.
const baseNameOf = (n, normName) => normName(String(n || '').replace(/\s*\([^)]*\)\s*/g, ' '));

function toBase(qty, unit) {
  const u = String(unit || '').trim().toLowerCase();
  if (u === 'ml') return { qty, unit: 'ml' };
  if (u === 'l' || u === 'litre' || u === 'liter') return { qty: qty * 1000, unit: 'ml' };
  if (u === 'g') return { qty, unit: 'g' };
  if (u === 'kg') return { qty: qty * 1000, unit: 'g' };
  if (['pcs', 'pc', 'piece', 'pieces'].includes(u)) return { qty, unit: 'piece' };
  return null;
}

// items: [{ itemName, unit, currentCount }]; sizes: { [normName]: { size, unit } }
function countedToStock(items, sizes, normName, existing = new Map()) {
  const out = new Map(); const warnings = [];
  for (const it of items || []) {
    const name = String(it.itemName || '').trim(); const count = Number(it.currentCount);
    if (!name || !(count > 0)) continue;
    const key = baseNameOf(name, normName);
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
    if (!b) { warnings.push(`${name} is counted in ${it.unit || 'units'} but the size of one is not set, so the shopping plan cannot use it. Tap it on the Stock page and type the ml or g.`); continue; }
    const have = out.get(key);
    if (have && have.unit === b.unit) have.left += b.qty; else if (!have) out.set(key, { left: b.qty, unit: b.unit });
  }
  return { stock: out, warnings };
}

module.exports = { countedToStock, toBase, baseNameOf };
