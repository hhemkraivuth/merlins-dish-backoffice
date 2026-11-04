// Short names for receipts: "alias en ziero = EN Ziero - Golden Apple and Yuzu". Stored as Ingredient rows in the Shorthand tab,
// the same table the cook notes use, so the short name works in both.
const { matchIngredient } = require('./typedReceipt');

const key = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const COMMAND = /^alias\s+(.+?)\s*(?:=|->|→|\bis\b)\s*(.+)$/i;

// rows: Shorthand tab rows -> Map(short without spaces -> full name). Single letters (o, g, c) are cook note shorthand only.
function receiptAliases(rows = []) {
  const map = new Map();
  for (const r of rows) {
    if (String(r[0] || '').trim().toLowerCase() !== 'ingredient') continue;
    const short = key(r[1]);
    const full = String(r[2] || '').trim();
    if (short.length >= 3 && full) map.set(short, full);
  }
  return map;
}

// deps: { readRows(), save(short, full), loadCatalogue() }
async function processAlias(text, deps) {
  const t = String(text || '').trim();
  if (/^aliases$/i.test(t)) {
    const map = receiptAliases(await deps.readRows());
    return map.size ? [`Receipt short names:\n${[...map].map(([s, f]) => `• ${s} = ${f}`).join('\n')}`] : ['No short names yet. Send: alias en ziero = EN Ziero - Golden Apple and Yuzu'];
  }
  const m = t.match(COMMAND);
  if (!m) return null;
  const short = m[1].trim();
  let full = m[2].trim();
  let note = '';
  try {
    const hit = matchIngredient(full, await deps.loadCatalogue());
    if (hit.name) full = hit.name;
    else if (hit.ambiguous) return [`"${full}" could be ${hit.ambiguous.join(' or ')}. Send the alias again with the full name.`];
    else note = `\n"${full}" is not in the Price Tracker, so receipts using it will still show as not matched. Add it to column B of the Price Tracker.`;
  } catch (err) { note = '\nI could not check the Price Tracker, so the name was saved as typed.'; }
  if (key(short).length < 3) return ['A short name needs at least 3 letters.'];
  await deps.save(short, full);
  return [`Saved: when a receipt says "${short}" I will log ${full}.${note}`];
}

module.exports = { receiptAliases, processAlias };
