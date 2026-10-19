// Reads receipts Lily types herself. Example:
//
//   18/10
//   minced pork 1000g 110thb
//   onion 2kg 90thb
//
// A date line applies to the lines below it until the next date line. "18/10 minced pork 1000g 110thb"
// on one line also works. Every item line needs a price with thb, baht or ฿ on it, which is what
// tells a receipt apart from a cook note (cook notes never carry a price).

const { parseDate } = require('./dates');
const { parsePurchaseUnit } = require('./priceBook');

const DATE_LINE = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/;
const NUM = '(\\d+(?:[.,]\\d+)?)';
const UNIT = '(kg|g|gm|grams?|ml|l|ltr|pcs?|pieces?|p|pack|set)';
const ITEM_LINE = new RegExp(`^(.+?)\\s+${NUM}\\s*${UNIT}?\\s+(?:฿\\s*${NUM}|${NUM}\\s*(?:thb|baht|฿))$`, 'i');

const num = (s) => Number(String(s).replace(',', '.'));

// "minced pork" and "Pork - minced" are the same words in a different order.
function tokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9฀-๿]+/g, ' ').split(' ').filter((t) => t && t !== 'mutti');
}

// Maps what Lily typed to the exact ingredient name in the Price Tracker, or says why it could not.
// Returns { name } on a match, { ambiguous: [names] } when several fit, {} when none do.
function matchIngredient(typed, catalogue = []) {
  const want = tokens(typed);
  if (!want.length) return {};
  const sig = (t) => [...t].sort().join(' ');
  const wantSig = sig(want);

  const exact = catalogue.filter((n) => sig(tokens(n)) === wantSig);
  if (exact.length) return { name: exact[0] };

  const subset = (a, b) => a.every((t) => b.includes(t));
  const near = catalogue.filter((n) => {
    const have = tokens(n);
    return have.length && (subset(want, have) || subset(have, want));
  });
  if (near.length === 1) return { name: near[0] };
  if (near.length > 1) return { ambiguous: near.slice(0, 5) };
  return {};
}

// Returns { items: [{ date, typedName, qty, unit, purchaseUnit, price, costPerUnit }], problems, undated }
// undated is true when at least one item had no date line above it (the caller decides what date to use).
function parseTypedReceipt(text, today) {
  const items = [];
  const problems = [];
  let currentDate = null;
  let undated = false;

  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  function addItem(line) {
    const m = line.match(ITEM_LINE);
    if (!m) return false;
    const name = m[1].trim();
    const qty = num(m[2]);
    const unit = (m[3] || 'pc').toLowerCase();
    const price = num(m[4] !== undefined ? m[4] : m[5]);
    const pu = parsePurchaseUnit(`${m[2].replace(',', '.')}${unit}`);
    if (!pu || !(pu.qty > 0)) { problems.push(`Couldn't read the quantity in "${line}"`); return true; }
    if (!currentDate) undated = true;
    items.push({
      date: currentDate,
      typedName: name,
      qty,
      unit,
      purchaseUnit: `${m[2].replace(',', '.')}${m[3] ? m[3].toLowerCase() : 'piece'}`,
      price,
      costPerUnit: Number((price / pu.qty).toFixed(5)),
    });
    return true;
  }

  for (const line of lines) {
    if (DATE_LINE.test(line)) {
      const d = parseDate(line, today);
      if (!d) problems.push(`"${line}" doesn't look like a valid date`);
      else currentDate = d;
      continue;
    }
    const firstSpace = line.search(/\s/);
    if (firstSpace > 0 && DATE_LINE.test(line.slice(0, firstSpace))) {
      const d = parseDate(line.slice(0, firstSpace), today);
      if (!d) { problems.push(`"${line.slice(0, firstSpace)}" doesn't look like a valid date`); continue; }
      currentDate = d;
      if (addItem(line.slice(firstSpace).trim())) continue;
      problems.push(`Couldn't read "${line.slice(firstSpace).trim()}"`);
      continue;
    }
    if (!addItem(line)) problems.push(`Couldn't read "${line}"`);
  }

  return { items, problems, undated };
}

// True only when at least one line is an item with a price. Ordinary chat and cook notes return false.
function looksLikeTypedReceipt(text) {
  return String(text || '').split(/\r?\n/).some((l) => {
    const t = l.trim();
    if (ITEM_LINE.test(t)) return true;
    const sp = t.search(/\s/);
    return sp > 0 && DATE_LINE.test(t.slice(0, sp)) && ITEM_LINE.test(t.slice(sp).trim());
  });
}

module.exports = { parseTypedReceipt, looksLikeTypedReceipt, matchIngredient, tokens };
