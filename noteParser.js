// Reads Lily's cook-note shorthand. Example:
//
//   7/10
//   Bolo
//   Meat 1000
//   O 446
//   G 60
//   Cl 234
//   C 230
//   yield 21
//
// A message can hold several batches. A new batch starts at each dish keyword.
// A date line applies to the batches below it until the next date line.

const { parseDate, bangkokToday } = require('./dates');

const DATE_LINE = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/;
const YIELD_A = /^(?:yielded|yield|yields|y|portions?|servings?|serves)\s*[:=]?\s*(\d+)\s*(?:portions?|servings?|serves)?$/i;
const YIELD_B = /^(\d+)\s*(?:portions?|servings?|serves)$/i;
// Stew pack-out: "regular 12 @ 380g", "large 8 @ 525g". Optional measured total: "cooked 7000g".
const SIZE_LINE = /^(regular|reg|large|lg)\s+(\d+)\s*(?:@|x|at)\s*(\d+(?:[.,]\d+)?)\s*g?$/i;
const COOKED_LINE = /^(?:cooked|cooked weight|weight)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(kg|g)?$/i;
const NUM = '\\d+(?:[.,]\\d+)?';
// "C 309+115" is 424: two amounts added up, typed as a sum.
const ING_LINE = new RegExp(`^(.+?)\\s*[:=]?\\s+(${NUM}(?:\\s*\\+\\s*${NUM})*)\\s*(kg|g|gm|grams?|ml|l|ltr|pcs?|pieces?|p)?$`, 'i');
const sumOf = (txt) => String(txt).split('+').reduce((a, n) => a + Number(n.trim().replace(',', '.')), 0);
// Stew pack-out shorthand: "7r 4l portions", "R6 l5 portions" = 7 regular and 4 large. Weights come from the recipe tab.
const SIZE_SHORT_WORD = /\s*(?:portions?|servings?)$/i;
const SIZE_SHORT_BODY = /^(?:(?:\d+\s*[rl]|[rl]\s*\d+)(?:\s+|$)){1,2}$/i;
const SIZE_SHORT_ITEM = /(\d+)\s*([rl])\b|\b([rl])\s*(\d+)/gi;
function parseSizeShort(line) {
  const hadWord = SIZE_SHORT_WORD.test(line);
  const body = line.replace(SIZE_SHORT_WORD, '').trim();
  if (!SIZE_SHORT_BODY.test(`${body} `)) return null;
  const out = [];
  for (const m of body.matchAll(SIZE_SHORT_ITEM)) {
    const letter = (m[2] || m[3]).toLowerCase();
    out.push({ name: letter === 'l' ? 'Large' : 'Regular', count: Number(m[1] || m[4]) });
  }
  if (!out.length || (!hadWord && out.length < 2)) return null;
  if (new Set(out.map((z) => z.name)).size !== out.length) return null;
  return out;
}

function dishKey(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

function toBase(qty, unit) {
  const u = String(unit || '').toLowerCase();
  if (u === 'kg') return { qty: qty * 1000, unit: 'g' };
  if (u === 'l' || u === 'ltr') return { qty: qty * 1000, unit: 'ml' };
  if (u.startsWith('g')) return { qty, unit: 'g' };
  if (u === 'ml') return { qty, unit: 'ml' };
  if (u.startsWith('p')) return { qty, unit: 'piece' };
  return { qty, unit: '' };
}

// shorthand: { dishes: Map(alias -> tab name), ingredients: Map }
function parseNote(text, shorthand, today = bangkokToday()) {
  const batches = [];
  const problems = [];
  let currentDate = null;
  let current = null;

  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim());
  for (let line of lines) {
    if (!line) continue;

    // "7/10 bolo" on one line
    const firstSpace = line.search(/\s/);
    if (firstSpace > 0) {
      const head = line.slice(0, firstSpace);
      const rest = line.slice(firstSpace).trim();
      if (DATE_LINE.test(head) && shorthand.dishes.has(dishKey(rest))) {
        currentDate = parseDate(head, today);
        current = { dishTab: shorthand.dishes.get(dishKey(rest)), dishWord: rest, date: currentDate, yield: null, lines: [], sizes: [], sizeCounts: [], cookedWeight: null };
        batches.push(current);
        continue;
      }
    }

    if (DATE_LINE.test(line)) {
      const d = parseDate(line, today);
      if (!d) { problems.push(`"${line}" doesn't look like a valid date`); continue; }
      currentDate = d;
      current = null; // lines after a new date belong to the next dish keyword
      continue;
    }

    if (shorthand.dishes.has(dishKey(line))) {
      current = { dishTab: shorthand.dishes.get(dishKey(line)), dishWord: line, date: currentDate, yield: null, lines: [], sizes: [], sizeCounts: [], cookedWeight: null };
      batches.push(current);
      continue;
    }

    const sz = line.match(SIZE_LINE);
    if (sz) {
      if (!current) { problems.push(`"${line}" has no dish above it`); continue; }
      const name = /^l/i.test(sz[1]) ? 'Large' : 'Regular';
      current.sizes.push({ name, count: Number(sz[2]), weight: Number(sz[3].replace(',', '.')) });
      continue;
    }

    const cw = line.match(COOKED_LINE);
    if (cw) {
      if (!current) { problems.push(`"${line}" has no dish above it`); continue; }
      current.cookedWeight = Number(cw[1].replace(',', '.')) * (String(cw[2] || '').toLowerCase() === 'kg' ? 1000 : 1);
      continue;
    }

    const ss = parseSizeShort(line);
    if (ss) {
      if (!current) { problems.push(`"${line}" has no dish above it`); continue; }
      current.sizeCounts = ss;
      continue;
    }

    const y = line.match(YIELD_A) || line.match(YIELD_B);
    if (y) {
      if (current) current.yield = Number(y[1]);
      else problems.push(`Yield "${line}" has no dish above it`);
      continue;
    }

    const m = line.match(ING_LINE);
    if (m) {
      if (!current) { problems.push(`"${line}" has no dish above it`); continue; }
      const q = toBase(sumOf(m[2]), m[3]);
      current.lines.push({ token: m[1].trim(), qty: q.qty, unit: q.unit, raw: line });
      continue;
    }

    // A line of words only is most likely a dish word that is not in the shorthand ("Tucan" for Tuscan). Stop here, so the lines
    // under it are not quietly added to the dish above.
    if (/^[a-z][a-z .&'’-]*$/i.test(line)) {
      problems.push(`"${line}" is not a dish word I know, so the lines under it were skipped. Add it in the Shorthand tab: Dish | ${line.toLowerCase().replace(/\s+/g, '')} | the recipe tab name.`);
      current = null;
      continue;
    }

    problems.push(`Couldn't read "${line}"`);
  }

  return { batches, problems };
}

// True when the text looks like an attempted cook note (so a typo'd dish word gets a reply,
// while ordinary chat in the group is ignored).
function looksLikeAttempt(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hasDate = lines.some((l) => DATE_LINE.test(l.split(/\s+/)[0]));
  const hasIng = lines.some((l) => ING_LINE.test(l));
  return hasDate && hasIng;
}

module.exports = { parseNote, looksLikeAttempt };
