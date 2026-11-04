// Reads receipts Lily types herself. Examples:
//
//   18/10
//   minced pork 1000g 110thb
//   onion 2kg 90thb
//
//   5/10
//   at Makro
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
  let t = String(line || '').trim();
  // "2 cans, 16thb ea" / "16 each": the price is for one, not for the lot
  let each = false;
  const ea = t.match(/^(.*?)[\s,]*(?:\/\s*)?(?:ea\.?|each)$/i);
  if (ea && /\d/.test(ea[1].slice(-12))) { t = ea[1].trim(); each = true; }
  const m0 = matchItemPlain(t);
  return m0 ? { ...m0, each } : null;
}
function matchItemPlain(line) {
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
  return String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9฀-๿]+/g, ' ').split(' ').filter((t) => t && t !== 'mutti').map((t) => t.replace(/([a-z])\1+/g, '$1'));
}

// Edit distance where swapping two neighbouring letters counts as one slip ("pecroino" -> "pecorino").
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
// One slip is allowed in a word of 4 to 7 letters, two in a longer one. Short words and numbers must be exact.
function slips(a, b) {
  if (a === b) return 0;
  if (Math.min(a.length, b.length) < 4 || /\d/.test(a + b)) return Infinity;
  const allowed = Math.max(a.length, b.length) >= 8 ? 2 : 1;
  const x = distance(a, b);
  return x <= allowed ? x : Infinity;
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

  // Last resort, a spelling slip. Every typed word must be close to a word of the ingredient (or the other way round).
  const cost = (a, b) => {
    let total = 0;
    for (const t of a) {
      const best = Math.min(...b.map((u) => slips(t, u)));
      if (best === Infinity) return Infinity;
      total += best;
    }
    return total;
  };
  const scored = catalogue
    .map((n) => {
      const have = tokens(n);
      // Spaces in the wrong place ("en ziero" for "Eden Zero") are caught by comparing the words run together.
      const joined = slips(want.join(''), have.join(''));
      return { n, c: have.length ? Math.min(cost(want, have), cost(have, want), joined) : Infinity };
    })
    .filter((x) => x.c !== Infinity)
    .sort((a, b) => a.c - b.c);
  if (!scored.length) return {};
  const top = scored.filter((x) => x.c === scored[0].c);
  if (top.length === 1) return { name: top[0].n, fuzzy: true };
  return { ambiguous: top.slice(0, 5).map((x) => x.n) };
}

// "at Makro", "shop: Makro", "shopped at Tops" -> "Makro". Applies to the items below it until the next shop or date line.
const SHOP_LINE = /^(?:shopped\s+at|shop|store|at)\s*[:\-]?\s+(\S.*)$/i;

// Returns { items: [{ date, shop, typedName, qty, unit, purchaseUnit, price, costPerUnit }], problems, undated }
// undated is true when at least one item had no date line above it (the caller decides what date to use).
function parseTypedReceipt(text, today) {
  const items = [];
  const problems = [];
  let currentDate = null;
  let currentShop = '';
  let undated = false;
  let pricesOnly = false;

  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  function addItem(line) {
    const it = matchItem(line);
    if (!it) return false;
    let name = it.name.replace(/[,\s]+$/, '').trim();
    let qtyText = it.qtyText.replace(',', '.');
    let unit = (it.unitText || 'piece').toLowerCase();
    let price = num(it.price);
    let assumed = '';
    if (it.each) { const n = num(qtyText); price = Number((price * n).toFixed(2)); assumed = `${it.price} each x ${qtyText} = ${price}`; }
    // A weight with a decimal point under 10 and the letter g ("0.478g", "0.9g") is a kilo weight, not a fraction of a gram.
    const GRAM = /^(g|gm|grams?)$/;
    if (GRAM.test(unit) && /\./.test(qtyText) && Number(qtyText) < 10) {
      assumed = `read ${qtyText}${unit} as ${qtyText}kg (${Number((Number(qtyText) * 1000).toFixed(3))}g)`;
      unit = 'kg';
    }
    // "pecorino 0.60g 2pcs, 180": a kilo weight in the name followed by a count means that weight each.
    const each = name.match(/^(.*?)[\s,]+(\d+\.\d+)\s*(?:g|gm|grams?|kg)$/i);
    if (each && /^(pieces?|pcs?|p)$/.test(unit) && Number(each[2]) < 10) {
      const grams = Number(each[2]) * 1000 * Number(qtyText);
      assumed = `read ${each[2]}kg each x ${qtyText} as ${Number(grams.toFixed(3))}g`;
      name = each[1].trim();
      qtyText = String(Number(grams.toFixed(3)));
      unit = 'g';
    }
    // "pecorino 60g 2pcs, 180": a weight in the name followed by a count. Two pieces of 60g is 120g, unless the ingredient is
    // counted in pieces (Knorr cube 20g 48pcs is 48 pieces). The caller checks the ingredient's usual unit.
    let eachWeight = null;
    const plain = name.match(/^(.*?)[\s,]+(\d+)\s*(?:g|gm|grams?)$/i);
    if (plain && /^(pieces?|pcs?|p)$/.test(unit) && !assumed.startsWith('read')) {
      eachWeight = { grams: Number(plain[2]), count: Number(qtyText), baseName: plain[1].trim(), fullName: name };
      name = plain[1].trim();
      qtyText = String(Number((eachWeight.grams * eachWeight.count).toFixed(3)));
      unit = 'g';
      assumed = `read ${eachWeight.grams}g x ${eachWeight.count} as ${qtyText}g`;
    }
    const qty = num(qtyText);
    const pu = parsePurchaseUnit(`${qtyText}${unit}`);
    if (!pu || !(pu.qty > 0)) { problems.push(`Couldn't read the quantity in "${line}"`); return true; }
    if (!currentDate) undated = true;
    items.push({
      date: currentDate,
      shop: currentShop,
      typedName: name,
      qty,
      unit,
      purchaseUnit: `${qtyText}${unit}`,
      assumed,
      kiloGuess: Boolean(assumed) && !eachWeight && !it.each,
      eachWeight,
      pricesOnly,
      price,
      costPerUnit: Number((price / pu.qty).toFixed(5)),
    });
    return true;
  }

  for (const line of lines) {
    if (/^(prices only|no stock)$/i.test(line)) { pricesOnly = true; continue; }
    if (DATE_LINE.test(line)) {
      pricesOnly = false;
      const d = parseDate(line, today);
      if (!d) problems.push(`"${line}" doesn't look like a valid date`);
      else { currentDate = d; currentShop = ''; }
      continue;
    }
    const firstSpace = line.search(/\s/);
    if (firstSpace > 0 && DATE_LINE.test(line.slice(0, firstSpace))) {
      const d = parseDate(line.slice(0, firstSpace), today);
      if (!d) { problems.push(`"${line.slice(0, firstSpace)}" doesn't look like a valid date`); continue; }
      currentDate = d;
      currentShop = '';
      pricesOnly = false;
      const rest = line.slice(firstSpace).trim();
      if (addItem(rest)) continue;
      const sh = rest.match(SHOP_LINE);
      if (sh) { currentShop = sh[1].trim(); continue; }
      problems.push(`Couldn't read "${rest}"`);
      continue;
    }
    if (addItem(line)) continue;
    const sh = line.match(SHOP_LINE);
    if (sh) { currentShop = sh[1].trim(); continue; }
    problems.push(`Couldn't read "${line}"`);
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
