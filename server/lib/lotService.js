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
const { parseDate, formatDMY, bangkokNow } = require('./dates');
const { normName, looseKey } = require('./priceBook');
const { isContainerWord } = require('./packSizes');
const { lowItems, parseLevels } = require('./reorderLevels');

const baht = (n) => `฿${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = (n, unit) => `${Number(n.toFixed(2)).toLocaleString('en-AU')}${unit}`;


const INGREDIENT_WASTE = /^waste\s+(?:(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\s+)?(.+?)\s+(\d+(?:[.,]\d+)?)\s*(kg|g|gm|grams?|ml|l|ltr|pcs?|pieces?)\b\s*(.*)$/i;
const WASTE_TAB = 'Ingredient Waste';
const WASTE_HEADERS = ['Date', 'Ingredient', 'Qty', 'Unit', 'Reason', 'Cost', 'Bought at', 'Logged At'];

// Takes qty (base units) of an ingredient off the oldest lots and prices it at what those lots cost.
// Returns { cost, short, shop, usage, row } or null when the ingredient has no lots at all.
function wasteIngredient(book, name, qty, unit, date, reason) {
  const lots = book.lotsFor(name);
  if (!lots.length) return null;
  const a = book.allocate(name, qty, unit, date);
  let cost = a.parts.reduce((t, p) => t + p.qty * p.unitCost, 0);
  const last = lots[lots.length - 1];
  if (a.short > 1e-6) cost += a.short * last.unitCost;
  const first = (a.parts[0] && a.parts[0].lot) || last;
  const shop = String(first.note || '').split(/\s+/)[0] || '';
  const usage = a.parts.map((p) => ['WASTE', formatDMY(date), name, p.lot.id, formatDMY(p.lot.date), Number(p.qty.toFixed(3)), Number(p.unitCost.toFixed(5)), Number((p.qty * p.unitCost).toFixed(2)), bangkokNow()]);
  const row = [formatDMY(date), name, Number(qty.toFixed(3)), unit, reason, Number(cost.toFixed(2)), shop, bangkokNow()];
  return { cost, short: a.short, shop, usage, row };
}

const COUNT = /^count\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(kg|g|gm|grams?|ml|l|ltr|pcs?|pieces?)?$/i;

const USAGE = 'Stock lot commands:\nwaste mushroom 500g mould (an ingredient thrown away)\nlots (what is left)\nfree 4/11 then lines like: knorr cube 2 boxes of 6 (free samples and gifts)\nopening 19/10 then lines like: minced pork 2000g 220thb\ncount minced pork 3000g (set the real quantity)\nlow (what is running low) and low salt 500g (alert me when it drops below that)\nsize worcestershire sauce 290ml (how much is in one bottle or can)\nundo noir ragu 6/10 (take a logged batch back out)';

const LOW_SET = /^low\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(kg|g|gm|grams?|ml|l|ltr|pcs?|pieces?)$/i;
const SIZE = /^size\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(kg|g|gm|grams?|ml|l|ltr)$/i;
const UNDO = /^undo\s+(.*?)\s*(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)$/i;

// ---- free samples and gifts ------------------------------------------------------------------------------
//   free 4/11                       (the date is optional, it defaults to the day you send it)
//   knorr cube 2 boxes of 6         "2 boxes of 6" is worked out as 12 pieces
//   minced pork 500g
// One line works too: "free 4/11 knorr cube 12 pieces".
// The stock goes straight into the stock lots. It is NEVER written to the Expense Log, so it can never become "the latest
// price" of an ingredient. What the lot is worth is set by FREE_STOCK_VALUE in Railway:
//   last (default)  valued at the last price you paid, so margins are not flattered by free stock
//   zero            valued at ฿0, because it cost you nothing
const DATE_ONLY = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/;
const OF = /(\d+(?:[.,]\d+)?)\s*(?:boxes|box|packs?|bags?|sets?|bottles?|cans?|tins?|jars?|sachets?|cartons?)\s+of\s+(\d+(?:[.,]\d+)?)\s*(kg|gm|grams?|g|ml|ltr|l|pieces?|pcs?|p)?(?![a-z])/i;

function expandOf(line) {
  const m = OF.exec(line);
  if (!m) return line;
  const total = Number(m[1].replace(',', '.')) * Number(m[2].replace(',', '.'));
  return line.replace(OF, `${Number(total.toFixed(3))}${m[3] || 'pieces'}`);
}

async function processFree(raw, messageDate, deps) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let rest = lines[0].replace(/^free\b[\s:]*/i, '').trim();
  let date = messageDate;
  const firstTok = rest.split(/\s+/)[0] || '';
  if (DATE_ONLY.test(firstTok)) {
    date = parseDate(firstTok, messageDate);
    if (!date) return [`"${firstTok}" doesn't look like a valid date. Nothing was added.`];
    rest = rest.slice(firstTok.length).trim();
  }
  const itemLines = [...(rest ? [rest] : []), ...lines.slice(1)].map(expandOf);
  if (!itemLines.length) return [USAGE];

  const { items, problems } = parseTypedReceipt(`${formatDMY(date)}\n${itemLines.map((l) => `${l}, 0`).join('\n')}`, messageDate);
  if (!items.length) return [`I couldn't read any item lines. Each line needs a name and a quantity, for example:\nfree ${formatDMY(date)}\nknorr cube 2 boxes of 6`];

  const book = await deps.loadLotBook();
  let catalogue = [];
  try { catalogue = await deps.loadCatalogue(); } catch (err) { /* names stay as typed */ }
  const skip = new Set((deps.loadUntracked ? await deps.loadUntracked().catch(() => []) : []).map(looseKey));
  let priceBook = null;
  if (deps.loadPriceBook) { try { priceBook = await deps.loadPriceBook(); } catch (err) { /* valued at 0 below, and said so */ } }
  const zero = String(process.env.FREE_STOCK_VALUE || '').toLowerCase() !== 'last';   // free means ฿0 unless FREE_STOCK_VALUE=last

  const toAdd = []; const added = []; const unmatched = []; const condiments = []; const noSize = []; const noPrice = []; const firstLots = [];
  for (const it of items) {
    const m = matchIngredient(it.typedName, catalogue);
    if (!m.name) { unmatched.push(m.ambiguous ? `${it.typedName} (could be ${m.ambiguous.join(' or ')})` : it.typedName); continue; }
    if (skip.has(looseKey(m.name))) { condiments.push(m.name); continue; }
    if (isContainerWord(it.unit)) { noSize.push(`${it.typedName} ${it.qty} ${it.unit}`); continue; }  // "2 boxes" alone has no size, say "2 boxes of 6"
    const base = toBaseQty(it.purchaseUnit);
    if (!base) { unmatched.push(it.typedName); continue; }
    let unitCost = 0;
    let how = 'valued at ฿0';
    if (!zero) {
      const last = priceBook ? priceBook.lookup(m.name, date) : null;
      if (last && last.cost > 0) { unitCost = last.cost; how = `valued at the last price, ${baht(last.cost * (base.unit === 'piece' ? 1 : 1000))} per ${base.unit === 'piece' ? 'piece' : base.unit === 'ml' ? 'litre' : 'kg'}`; }
      else { noPrice.push(m.name); how = 'no price on record, so valued at ฿0'; }
    }
    if (!book.hasLots(m.name)) firstLots.push(m.name);
    toAdd.push({ date, name: m.name, qty: base.qty, unit: base.unit, price: Number((unitCost * base.qty).toFixed(2)), source: 'Free sample', note: 'free' });
    added.push(`${m.name} ${qtyText(base.qty, base.unit)}, ${how}`);
  }
  if (toAdd.length) await deps.addLots(toAdd);

  const out = [];
  if (added.length) out.push(`Free stock added (${formatDMY(date)}):\n${added.map((a) => `• ${a}`).join('\n')}\nNot in the Expense Log, so the price book is untouched. Batches that use this stock are costed at ฿0 for it.`);
  if (firstLots.length) out.push(`${[...new Set(firstLots)].join(', ')} had no stock lots before, so this is now the only lot. Send an "opening" count for any other stock you hold.`);
  if (noPrice.length) out.push(`No price on record for ${[...new Set(noPrice)].join(', ')}.`);
  if (noSize.length) out.push(`Not added, I need the amount in each container. Say "2 boxes of 6" or "12 pieces":\n${noSize.map((a) => `• ${a}`).join('\n')}`);
  if (condiments.length) out.push(`Not stock tracked (condiments): ${condiments.join(', ')}.`);
  if (unmatched.length) out.push(`Not matched to a known ingredient, nothing added for:\n${unmatched.map((a) => `• ${a}`).join('\n')}`);
  if (problems.length) out.push(`Couldn't use these lines:\n${problems.slice(0, 6).map((a) => `• ${a}`).join('\n')}`);
  return out.length ? out : ['Nothing was added.'];
}

// deps: { loadLotBook(), saveLots(book, usage), addLots(items), loadCatalogue(), loadUntracked(), loadPriceBook() }
// Returns an array of replies, or null when the text is not a lot command.
async function processLots(text, messageDate, deps) {
  const raw = String(text || '').trim();
  const first = raw.split(/\r?\n/)[0].trim();

  if (/^lots?$/i.test(first) && raw === first) {
    const book = await deps.loadLotBook();
    const names = book.names().filter((n) => book.totalRemaining(n) > 0).sort();
    if (!names.length) return ['No stock lots yet. Send "opening" with what you hold today, or a typed receipt.'];
    const out = ['Stock lots (oldest first):'];
    let lowSet = new Set();
    if (deps.loadLevels) { try { lowSet = new Set(lowItems(book, await deps.loadLevels()).map((x) => x.name)); } catch (err) { /* no alerts */ } }
    for (const n of names) {
      const live = book.lotsFor(n).filter((l) => l.remaining > 1e-6);
      out.push(`${n}: ${qtyText(book.totalRemaining(n), live[0].unit)}${lowSet.has(n) ? ' LOW' : ''}`);
      for (const l of live.slice(0, 4)) out.push(`  ${formatDMY(l.date)}  ${qtyText(l.remaining, l.unit)} left @ ${baht(l.unitCost * (l.unit === 'piece' ? 1 : 1000))} per ${l.unit === 'piece' ? 'piece' : l.unit === 'ml' ? 'litre' : 'kg'}`);
      if (live.length > 4) out.push(`  plus ${live.length - 4} more lots`);
    }
    return [out.join('\n')];
  }

  // waste mushroom 500g mould   (an ingredient thrown away: rotten, spilt, expired)   waste 18/11 mushroom 500g mould
  const wm = first.match(INGREDIENT_WASTE);
  if (wm && raw === first) {
    if (!deps.appendRows) return null;
    const date = wm[1] ? parseDate(wm[1], messageDate) : messageDate;
    if (!date) return [`"${wm[1]}" doesn't look like a valid date. Nothing was logged.`];
    const base = toBaseQty(`${wm[3].replace(',', '.')}${wm[4]}`);
    if (!base) return ['I could not read that quantity. Nothing was logged. Example: waste mushroom 500g mould'];
    const book = await deps.loadLotBook();
    const m = matchIngredient(wm[2], book.names());
    if (!m.name) return [m.ambiguous ? `"${wm[2]}" could be ${m.ambiguous.join(' or ')}. Say which one. Nothing was logged.` : `I don't know the ingredient "${wm[2]}". Nothing was logged.`];
    const reason = wm[5].trim() || 'wasted';
    const r = wasteIngredient(book, m.name, base.qty, base.unit, date, reason);
    if (!r) return [`${m.name} has no stock lots, so there is no price to cost it at. Nothing was logged.`];
    await deps.saveLots(book, r.usage);
    await deps.ensureTab(WASTE_TAB, WASTE_HEADERS);
    await deps.appendRows(WASTE_TAB, [r.row]);
    return [`Logged ${qtyText(base.qty, base.unit)} ${m.name} (${reason}) on ${formatDMY(date)}, cost ${baht(r.cost)}${r.shop ? `, bought at ${r.shop}` : ''}. Taken off stock.${r.short > 1e-6 ? ` The books only held ${qtyText(base.qty - r.short, base.unit)}, so the rest is costed at the latest price.` : ''}`];
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
    const skip = new Set((deps.loadUntracked ? await deps.loadUntracked().catch(() => []) : []).map(looseKey));

    const toAdd = []; const added = []; const unmatched = []; const condiments = []; const already = [];
    for (const it of items) {
      const m = matchIngredient(it.typedName, catalogue);
      if (!m.name) { unmatched.push(m.ambiguous ? `${it.typedName} (could be ${m.ambiguous.join(' or ')})` : it.typedName); continue; }
      if (skip.has(looseKey(m.name))) { condiments.push(m.name); continue; }
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

  if (/^low$/i.test(first) && raw === first && deps.loadLevels) {
    const book = await deps.loadLotBook();
    const levels = await deps.loadLevels();
    if (!levels.size) return ['No alert levels yet. Set one like this: low salt 500g'];
    const low = lowItems(book, levels);
    if (!low.length) return ['Nothing is below its alert level.'];
    return [`Running low:\n${low.map((x) => `• ${x.name}: ${qtyText(x.left, x.unit)} left, alert below ${qtyText(x.level, x.unit)}`).join('\n')}`];
  }

  const lw = first.match(LOW_SET);
  if (lw && raw === first && deps.setLevel) {
    const book = await deps.loadLotBook();
    const m = matchIngredient(lw[1], book.names());
    if (!m.name) {
      return [m.ambiguous
        ? `Nothing changed. "${lw[1]}" could be:\n${m.ambiguous.map((n) => `• ${n}`).join('\n')}\nSend the full name.`
        : `Nothing changed. "${lw[1]}" has no stock lots yet. Send an "opening" count first.`];
    }
    const text = `${lw[2].replace(',', '.')}${lw[3].toLowerCase()}`;
    const base = toBaseQty(text);
    if (!base || base.unit !== book.lotsFor(m.name)[0].unit) return [`Nothing changed. ${m.name} is counted in ${book.lotsFor(m.name)[0].unit}.`];
    const done = await deps.setLevel(m.name, text);
    return [`${m.name}: I will flag it when less than ${qtyText(base.qty, base.unit)} is left (${done}). It shows as LOW in "lots", "low" and the huddle.`];
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
    await require('./stockGaps').recordLot(r, 'LINE count');
    const note = r.after < r.before ? 'Oldest lots reduced.' : r.after > r.before ? 'Extra added as an adjustment lot at the newest price.' : 'No change.';
    return [`${r.name}: ${qtyText(r.before, r.unit)} on the books, now ${qtyText(r.after, r.unit)}. ${note}`];
  }

  const sz = first.match(SIZE);
  if (sz && raw === first && deps.setPackSize) {
    let catalogue = [];
    try { catalogue = await deps.loadCatalogue(); } catch (err) { /* falls through to not found */ }
    const m = matchIngredient(sz[1], catalogue);
    if (!m.name) {
      return [m.ambiguous
        ? `Nothing changed. "${sz[1]}" could be:\n${m.ambiguous.map((n) => `• ${n}`).join('\n')}\nSend the full name.`
        : `Nothing changed. I don't know an ingredient called "${sz[1]}".`];
    }
    const text = `${sz[2].replace(',', '.')}${sz[3].toLowerCase()}`;
    const done = await deps.setPackSize(m.name, text);
    return [`${m.name}: one bottle, can or bag is now ${text} (${done}). Receipts that say "2 bottles" will be stored as ${Number((2 * (toBaseQty(text) || { qty: 0 }).qty).toFixed(3))}${(toBaseQty(text) || {}).unit || ''}.`];
  }

  const un = first.match(UNDO);
  if (un && raw === first && deps.undoBatch) {
    const date = parseDate(un[2], messageDate);
    if (!date) return [`"${un[2]}" doesn't look like a valid date. Nothing was changed.`];
    return [(await deps.undoBatch(un[1], date)).text];
  }

  if (/^free\b/i.test(first)) return processFree(raw, messageDate, deps);

  if (/^(count|opening|size|undo|free|low)\b/i.test(first)) return [USAGE];
  return null;
}

module.exports = { processLots, USAGE, wasteIngredient, INGREDIENT_WASTE, WASTE_TAB, WASTE_HEADERS };
