// Closing count of cooked portions, typed in the LINE group or the web note box:
//
//   stock after close 11/11
//   rws 2r 2l
//   dbs 4l 9r
//   tpb 4
//   ragu 0
//   bolog 9
//   sr 6
//   broc s 4
//   chic s 0
//
// The first line says it is a closing count (the words "close" or "stock after close", with an optional date, today if none).
// Each line after it is a dish word and its portions. Several numbers on one line are added up (2r 2l is 4). Everything is
// checked before anything is saved, so one unknown word saves nothing. A count is a row in "Ready Counts"; the latest per dish wins.
//
// The same count can also be typed as the quick "left" message the order app understands, so ONE message updates both:
//
//   left tpb 3, noir 0, bolo 8, brocs 1, rws 2l 2r        (commas, or "left" alone on the first line and one dish per line)
//
// This is dated today (Bangkok), and a later closing count replaces it. Words that are not cooked batch dishes (drinks,
// Bacon Steak, loose pasta) belong to the order app only; they are skipped here and listed, and the rest is saved.

const { parseDate, formatDMY, bangkokNow } = require('./dates');
const { BATCH_DISHES } = require('./dishes');
const { READY_HEADERS } = require('./logViews');

const TAB = 'Ready Counts';
const HEAD = /(?:\b(?:stock|count|counts|left)\s+(?:after|at)\s+close\b|^\s*close\b|^\s*closing\b)/i;
const DATE = /\b(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\b/;


// Sizes are different portions and never merge: "dbs 5r 3l" is 5 Regular and 3 Large. The total (8) is what the stock maths
// uses, but what is saved and shown is as typed. "5r3l", "r5 l3" and "5r 3l" all become "5r 3l". A bare number gives "".
function asTyped(text) {
  const t = String(text || '').trim();
  const letterFirst = /^[a-zA-Z]/.test(t);
  const re = letterFirst ? /([a-zA-Z]{1,8})\s*(\d+)/g : /(\d+)([a-zA-Z]{1,8})/g;
  const parts = [];
  let m;
  while ((m = re.exec(t))) parts.push(letterFirst ? `${m[2]}${m[1].toLowerCase()}` : `${m[1]}${m[2].toLowerCase()}`);
  return parts.join(' ');
}
const shown = (dish, n, typed) => (typed ? `${dish} ${typed} (${n} in total)` : `${dish} ${n}`);

const LEFT = /^(left|setstock)\b[\s:]*([\s\S]*)$/i;
// "r7", "l 4", "2r", "regular 3": a size count that belongs to the dish before it, not a new dish.
const SIZE_PIECE = /^(?:\d|(?:r|l|reg|regular|large)\s*\d)/i;

// "left tpb 3, noir 0, rws 2l, 2r" -> ["tpb 3", "noir 0", "rws 2l 2r"]
function leftLines(body) {
  const out = [];
  for (const piece of String(body || '').split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean)) {
    if (out.length && SIZE_PIECE.test(piece)) out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  }
  return out;
}

async function processLeftCount(body, today, deps) {
  const lines = leftLines(body);
  if (!lines.length) return null;
  const sh = await deps.loadShorthand();
  const counts = new Map();
  const typed = new Map();
  const skipped = [];
  const bad = [];
  for (const raw of lines) {
    // Dish words are everything before the first digit, and every number on the line is added up, so "sr6", "tpb 3",
    // "dbs5r3l", "broc s 4" and "rws r1 l2" all read the way they were typed.
    const at = raw.search(/\d/);
    const numbers = raw.match(/\d+/g);
    if (at <= 0 || !numbers) { bad.push(`Could not read "${raw}".`); continue; }
    const words = raw.slice(0, at).replace(/[:=\s]+$/, '').trim();
    const norm = (t) => t.replace(/[^A-Za-z&]/g, '').toLowerCase();
    const tries = [norm(words), norm(words.split(/\s+/)[0] || '')];
    let dish = null;
    let rest = raw.slice(at);
    for (const [i, key] of tries.entries()) {
      if (!key) continue;
      dish = sh.dishes.get(key);
      if (!dish) { const hit = BATCH_DISHES.find(([n]) => n.toLowerCase().replace(/[^a-z&]/g, '') === key); dish = hit && hit[0]; }
      if (dish) { if (i === 1 && tries[0] !== tries[1]) rest = raw.slice(raw.search(/\s|\d/) > 0 ? raw.search(/\s|\d/) : 0); break; }
    }
    if (!dish) { skipped.push(words.split(/\s+/)[0] || words); continue; }
    counts.set(dish, numbers.reduce((x, n) => x + Number(n), 0));
    typed.set(dish, asTyped(rest));
  }
  if (!counts.size) {
    return [`BOH saved nothing: none of those are cooked batch dishes.${bad.length ? `\n${bad.join('\n')}` : ''}`];
  }
  await deps.ensureTab(TAB, READY_HEADERS);
  const stamp = bangkokNow();
  await deps.appendRows(TAB, [...counts].map(([dish, n]) => [dish, n, formatDMY(today), stamp, typed.get(dish) || '']), { raw: true });
  const extra = [];
  if (skipped.length) extra.push(`Not a batch dish, left to the order app: ${skipped.join(', ')}`);
  if (bad.length) extra.push(...bad);
  return [`BOH counts saved for ${formatDMY(today)}:\n${[...counts].map(([d, n]) => shown(d, n, typed.get(d))).join('\n')}${extra.length ? `\n\n${extra.join('\n')}` : ''}`];
}

async function processReadyCount(text, today, deps) {
  const left = LEFT.exec(String(text || '').trim());
  if (left && left[2].trim()) return processLeftCount(left[2], today, deps);
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // The date may sit on a line of its own above the "stock after close" line, the way a cook note is dated.
  const dateOnly = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/;
  const h = lines.length >= 3 && dateOnly.test(lines[0]) ? 1 : 0;
  if (lines.length < h + 2 || !HEAD.test(lines[h])) return null;

  let day = today;
  const dm = (h ? lines[0] : lines[0].match(DATE) && lines[0].match(DATE)[1]) || null;
  if (dm) {
    day = parseDate(dm, today);
    if (!day) return [`The date "${dm}" does not look valid. Nothing was saved.`];
  }

  const sh = await deps.loadShorthand();
  const counts = new Map();
  const typed = new Map();
  const problems = [];
  for (const raw of lines.slice(h + 1)) {
    const l = raw.replace(/^[-•*–\s]+/, '');
    const m = l.match(/^([A-Za-z&][A-Za-z&\s.]*?)[\s:=]*((?:\d+\s*[a-zA-Z]{0,2}[\s,+]*)+)$/);
    if (!m) { problems.push(`Could not read "${raw}". Write it like: dbs 4l 9r`); continue; }
    const words = m[1].trim();
    const key = words.replace(/[^A-Za-z&]/g, '').toLowerCase();
    let dish = sh.dishes.get(key);
    if (!dish) { const hit = BATCH_DISHES.find(([n]) => n.toLowerCase().replace(/[^a-z&]/g, '') === key); dish = hit && hit[0]; }
    if (!dish) { problems.push(`I don't know the dish "${words}".`); continue; }
    const n = (m[2].match(/\d+/g) || []).reduce((a, x) => a + Number(x), 0);
    counts.set(dish, n);
    typed.set(dish, asTyped(m[2]));
  }
  if (problems.length) return [`Nothing was saved.\n${problems.join('\n')}`];
  if (!counts.size) return null;

  await deps.ensureTab(TAB, READY_HEADERS);
  const stamp = bangkokNow();
  await deps.appendRows(TAB, [...counts].map(([dish, n]) => [dish, n, formatDMY(day), stamp, typed.get(dish) || '']), { raw: true });
  return [`Closing count saved for ${formatDMY(day)}:\n${[...counts].map(([d, n]) => shown(d, n, typed.get(d))).join('\n')}\nAnalysis, Home stock and To Do follow these. Cooking and sales after ${formatDMY(day)} are added on top.`];
}

module.exports = { processReadyCount, processLeftCount, leftLines, TAB };
