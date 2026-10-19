// Stock lot commands from the LINE group.
//
//   lots                              what is left of each tracked ingredient, by purchase
//   opening 19/10                     starting stock you hold today, one lot per line:
//   minced pork 2000g 220thb          name, quantity, total price paid for that quantity
//   count minced pork 3000g           set the real quantity on the shelf (fixes drift from waste)
//
// Purchases after that come in through the typed receipt, which creates lots automatically.

const { parseTypedReceipt } = require('./typedReceipt');
const { matchIngredient } = require('./typedReceipt');
const { toBaseQty } = require('./ingredientLots');
const { parseDate, formatDMY } = require('./dates');
const { normName } = require('./priceBook');

const baht = (n) => `฿${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = (n, unit) => `${Number(n.toFixed(2)).toLocaleString('en-AU')}${unit}`;

const COUNT = /^count\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(kg|g|gm|grams?|ml|l|ltr|pcs?|pieces?)?$/i;

const USAGE = 'Stock lot commands:\nlots (what is left)\nopening 19/10 then lines like: minced pork 2000g 220thb\ncount minced pork 3000g (set the real quantity)';

// deps: { loadLotBook(), saveLots(book, usage), addLots(items), loadCatalogue(), loadUntracked() }
// Returns an array of replies, or null when the text is not a lot command.
async function processLots(text, messageDate, deps) {
  const raw = String(text || '').trim();
  const first = raw.split(/\r?\n/)[0].trim();

  if (/^lots?$/i.test(first) && raw === first) {
    const book = await deps.loadLotBook();
    const names = book.names().filter((n) => book.totalRemaining(n) > 0).sort();
    if (!names.length) return ['No stock lots yet. Send "opening" with what you hold today, or a typed receipt.'];
    const out = ['Stock lots (oldest first):'];
    for (const n of names) {
      const live = book.lotsFor(n).filter((l) => l.remaining > 1e-6);
      out.push(`${n}: ${qtyText(book.totalRemaining(n), live[0].unit)}`);
      for (const l of live.slice(0, 4)) out.push(`  ${formatDMY(l.date)}  ${qtyText(l.remaining, l.unit)} left @ ${baht(l.unitCost * (l.unit === 'piece' ? 1 : 1000))} per ${l.unit === 'piece' ? 'piece' : l.unit === 'ml' ? 'litre' : 'kg'}`);
      if (live.length > 4) out.push(`  plus ${live.length - 4} more lots`);
    }
    return [out.join('\n')];
  }

  const op = first.match(/^opening(?:\s+(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?))?$/i);
  if (op) {
    const date = op[1] ? parseDate(op[1], messageDate) : messageDate;
    if (!date) return [`"${op[1]}" doesn't look like a valid date.`];
    const body = raw.split(/\r?\n/).slice(1).join('\n');
    const { items, problems } = parseTypedReceipt(`${formatDMY(date)}\n${body}`, messageDate);
    if (!items.length) return [`I couldn't read any item lines. Each line needs a quantity and total price, for example:\nopening ${formatDMY(date)}\nminced pork 2000g 220thb`];

    const book = await deps.loadLotBook();
    let catalogue = [];
    try { catalogue = await deps.loadCatalogue(); } catch (err) { /* names stay as typed */ }
    const skip = new Set((deps.loadUntracked ? await deps.loadUntracked().catch(() => []) : []).map(normName));

    const toAdd = []; const added = []; const unmatched = []; const condiments = []; const already = [];
    for (const it of items) {
      const m = matchIngredient(it.typedName, catalogue);
      if (!m.name) { unmatched.push(m.ambiguous ? `${it.typedName} (could be ${m.ambiguous.join(' or ')})` : it.typedName); continue; }
      if (skip.has(normName(m.name))) { condiments.push(m.name); continue; }
      if (book.hasLots(m.name)) { already.push(`${m.name} (${qtyText(book.totalRemaining(m.name), book.lotsFor(m.name)[0].unit)} on the books)`); continue; }
      const base = toBaseQty(it.purchaseUnit);
      if (!base) { unmatched.push(it.typedName); continue; }
      toAdd.push({ date, name: m.name, qty: base.qty, unit: base.unit, price: it.price, source: 'Opening' });
      added.push(`${m.name} ${qtyText(base.qty, base.unit)}, ${baht(it.price)}`);
    }
    if (toAdd.length) await deps.addLots(toAdd);

    const out = [];
    if (added.length) out.push(`Opening stock added (${formatDMY(date)}):\n${added.map((a) => `• ${a}`).join('\n')}`);
    if (already.length) out.push(`Skipped, these already have stock lots. Use "count" to correct them:\n${already.map((a) => `• ${a}`).join('\n')}`);
    if (condiments.length) out.push(`Not stock tracked (condiments): ${condiments.join(', ')}.`);
    if (unmatched.length) out.push(`Not matched to a known ingredient, nothing added for:\n${unmatched.map((a) => `• ${a}`).join('\n')}`);
    if (problems.length) out.push(`Couldn't use these lines:\n${problems.slice(0, 6).map((p) => `• ${p}`).join('\n')}`);
    return out.length ? out : ['Nothing was added.'];
  }

  const ct = first.match(COUNT);
  if (ct && raw === first) {
    const book = await deps.loadLotBook();
    const m = matchIngredient(ct[1], book.names());
    if (!m.name) {
      return [m.ambiguous
        ? `Nothing changed. "${ct[1]}" could be:\n${m.ambiguous.map((n) => `• ${n}`).join('\n')}\nSend the full name.`
        : `Nothing changed. "${ct[1]}" has no stock lots. Send "lots" to see what is tracked.`];
    }
    const unit = book.lotsFor(m.name)[0].unit;
    const base = toBaseQty(`${ct[2].replace(',', '.')}${ct[3] || (unit === 'piece' ? 'piece' : unit)}`);
    if (!base || base.unit !== unit) return [`Nothing changed. ${m.name} is counted in ${unit}.`];
    const r = book.countTo(m.name, base.qty, messageDate);
    await deps.saveLots(book, []);
    const note = r.after < r.before ? 'Oldest lots reduced.' : r.after > r.before ? 'Extra added as an adjustment lot at the newest price.' : 'No change.';
    return [`${r.name}: ${qtyText(r.before, r.unit)} on the books, now ${qtyText(r.after, r.unit)}. ${note}`];
  }

  if (/^(count|opening)\b/i.test(first)) return [USAGE];
  return null;
}

module.exports = { processLots, USAGE };
