// Reads receipts Lily types herself. Examples:
//
//   18/10
//   minced pork 1000g 110thb
//   onion 2kg 90thb
//
//   5/10
//   celery 2kg, 138thb
//   pelati, 2550g, 275
//   campbells - mushroom 4 cans, 520
//
// A date line applies to the lines below it until the next date line. "18/10 minced pork 1000g 110thb"
// on one line also works. The price either ends in thb, baht or ฿, or comes after a comma. That is what
// tells a receipt apart from a cook note (cook notes have no price and no commas).

const { parseDate } = require('./dates');
const { parsePurchaseUnit } = require('./priceBook');

const DATE_LINE = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/;
const NUM = '(\\d+(?:[.,]\\d+)?)';
// kg, g, ml, litres, pieces, and things counted by the container (cans, bottles, bags and so on)
const UNIT = '(kg|gm|grams?|g|ml|ltr|l|pieces?|pcs?|packs?|sets?|cans?|tins?|bottles?|jars?|bags?|boxes|box|sachets?|cartons?|bunch|heads?|trays?|rolls?|loaves|loaf|p)(?![a-z])';
// Price either carries thb / baht / ฿, or comes after a comma ("celery 2kg, 138"). Commas around the quantity are fine.
const WITH_MARK = new RegExp(`^(.+?)[,\\s]+${NUM}\\s*${UNIT}?[,\\s]+(?:฿\\s*${NUM}|${NUM}\\s*(?:thb|baht|฿))$`, 'i');
const WITH_COMMA = new RegExp(`^(.+?)[,\\s]+${NUM}\\s*${UNIT}?\\s*,\\s*${NUM}$`, 'i');

// "minced pork 1000g 110thb" / "pelati, 2550g, 275" -> { name, qtyText, unitText, price } or null
function matchItem(line) {
  const t = String(line || '').trim();
  let m = t.match(WITH_MARK);
  if (m) return { name: m[1], qtyText: m[2], unitText: m[3] || '', price: m[4] !== undefined ? m[4] : m[5] };
  m = t.match(WITH_COMMA);
  if (m) return { name: m[1], qtyText: m[2], unitText: m[3] || '', price: m[4] };
  return null;
}

const num = (s) => Number(String(s).replace(',', '.'));

// "minced pork" and "Pork - minced" are the same words in a different order.
function tokens(s) {
  // Apostrophes are dropped, not turned into a gap, so "Campbell's" and "campbells" are the same word.
  return String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9฀-๿]+/g, ' ').split(' ').filter((t) => t && t !== 'mutti');
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
    const it = matchItem(line);
    if (!it) return false;
    const name = it.name.replace(/[,\s]+$/, '').trim();
    const qty = num(it.qtyText);
    const unit = (it.unitText || 'piece').toLowerCase();
    const price = num(it.price);
    const pu = parsePurchaseUnit(`${it.qtyText.replace(',', '.')}${unit}`);
    if (!pu || !(pu.qty > 0)) { problems.push(`Couldn't read the quantity in "${line}"`); return true; }
    if (!currentDate) undated = true;
    items.push({
      date: currentDate,
      typedName: name,
      qty,
      unit,
      purchaseUnit: `${it.qtyText.replace(',', '.')}${unit}`,
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
    if (matchItem(t)) return true;
    const sp = t.search(/\s/);
    return sp > 0 && DATE_LINE.test(t.slice(0, sp)) && !!matchItem(t.slice(sp).trim());
  });
}

module.exports = { parseTypedReceipt, looksLikeTypedReceipt, matchIngredient, tokens };
