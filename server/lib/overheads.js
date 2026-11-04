// Overheads: paper bags, knives, pots and other things that are not ingredients.
//
//   13/10
//   at paragon
//   overhead
//   pot 7lt, 2575thb
//   paper bag 100pcs, 120thb
//
// A line saying "overhead" (or "overhead packaging", "overhead equipment" to tag a category) makes the lines below it
// overheads, until the next date line or a line saying "ingredients". They go to the Overheads tab in the Claude Log and
// nowhere else: not the Expense Log, not stock lots, not the price book, so ingredient prices and food cost stay clean.

const { parseDate, formatDMY } = require('./dates');

const TAB = 'Overheads';
const HEADERS = ['Date', 'Item', 'Category', 'Price', 'Shopped at', 'Remarks'];

const DATE_LINE = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/;
const SHOP_LINE = /^(?:shopped\s+at|shop|store|at)\s*[:\-]?\s+(\S.*)$/i;
const MARKER = /^overheads?\b[\s:\-]*(.*)$/i;
// Ads (Meta only; Grab ads are already inside the Grab figures): "ads", "meta ads" on a line of their own starts an ads block. "meta ads, 1200thb" on one line is a single ad spend.
const PLATFORM = 'meta|facebook|instagram|google';
const ADS = new RegExp(`^(?:(${PLATFORM})\\s+)?(?:ads?|advertising)(?:\\s+(${PLATFORM})\\b)?[\\s:\\-]*(.*)$`, 'i');
const adsCategory = (m) => { const w = m[1] || m[2]; return `Ads${w ? ' ' + w[0].toUpperCase() + w.slice(1).toLowerCase() : ''}`; };
const isAds = (category) => /^ads\b/i.test(String(category || ''));
const BACK_TO_FOOD = /^(ingredients?|food)$/i;
const num = (s) => Number(String(s).replace(/[,฿\s]/g, ''));

// "pot 7lt, 2575thb" / "paper bag 100pcs 120thb" -> { name, price } or null. The quantity stays in the name as typed.
function overheadItem(line) {
  let m = line.match(/^(.+?)\s*,\s*(?:฿\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:thb|baht|฿)?$/i);
  if (!m) m = line.match(/^(.+?)[\s]+(?:฿\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:thb|baht|฿))$/i);
  if (!m) return null;
  const price = num(m[2] !== undefined ? m[2] : m[3]);
  const name = m[1].replace(/[,\s]+$/, '').trim();
  return name && Number.isFinite(price) ? { name, price } : null;
}

// Returns { found, rest, items: [{ date, name, price, shop, category }], problems, undated }.
// rest is the message with the overhead lines and the marker lines taken out, for the ingredient reader.
function splitOverheads(text, today) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isAdsLine = (l) => { const m = l.match(ADS); return !!m && (!m[3] || !!overheadItem(l)); };
  if (!lines.some((l) => MARKER.test(l) || isAdsLine(l))) return { found: false, rest: text, items: [], problems: [], undated: false };
  const rest = []; const items = []; const problems = [];
  let date = null; let shop = ''; let mode = false; let category = ''; let undated = false;
  for (const line of lines) {
    if (DATE_LINE.test(line)) {
      const d = parseDate(line, today);
      if (d) { date = d; shop = ''; mode = false; category = ''; } else problems.push(`"${line}" doesn't look like a valid date`);
      rest.push(line); continue;
    }
    const sh = line.match(SHOP_LINE);
    if (sh && !overheadItem(line)) { shop = sh[1].trim(); rest.push(line); continue; }
    const ad = isAdsLine(line) ? line.match(ADS) : null;
    if (ad) {
      const one = overheadItem(line);
      if (one) { if (!date) undated = true; items.push({ date: date || today, name: one.name, price: one.price, shop, category: adsCategory(ad), ads: true }); continue; }
      if (!ad[3]) { mode = true; category = adsCategory(ad); continue; }
    }
    const mk = line.match(MARKER);
    if (mk) { mode = true; category = mk[1].trim(); continue; }
    if (BACK_TO_FOOD.test(line)) { mode = false; category = ''; continue; }
    if (!mode) { rest.push(line); continue; }
    const it = overheadItem(line);
    if (!it) { problems.push(`Couldn't read "${line}". Write it like: pot 7lt, 2575thb`); continue; }
    if (!date) undated = true;
    items.push({ date: date || today, name: it.name, price: it.price, shop, category, ads: isAds(category) });
  }
  return { found: true, rest: rest.join('\n'), items, problems, undated };
}

function overheadRows(items, receiptId = '') {
  return items.map((it) => [formatDMY(it.date), it.name, it.category, it.price, it.shop, receiptId ? `Typed in LINE; Receipt ${receiptId}` : 'Typed in LINE']);
}

// The Overheads tab as read (header first) -> [{ date, name, amount, kind }] for the reports
function overheadsFrom(rows) {
  const out = [];
  (rows || []).forEach((r, i) => {
    if (i === 0 && /date/i.test(String(r[0] || ''))) return;
    const date = parseDate(r[0]);
    const amount = num(r[3]);
    if (!date || !Number.isFinite(amount)) return;
    out.push({ date, name: String(r[1] || '').trim(), amount, kind: isAds(r[2]) ? 'ads' : 'overhead' });
  });
  return out;
}

module.exports = { isAds, splitOverheads, overheadItem, overheadRows, overheadsFrom, TAB, HEADERS };
