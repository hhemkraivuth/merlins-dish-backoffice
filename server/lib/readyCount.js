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

const { parseDate, formatDMY, bangkokNow } = require('./dates');
const { BATCH_DISHES } = require('./dishes');
const { READY_HEADERS } = require('./logViews');

const TAB = 'Ready Counts';
const HEAD = /(?:\b(?:stock|count|counts|left)\s+(?:after|at)\s+close\b|^\s*close\b|^\s*closing\b)/i;
const DATE = /\b(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\b/;

async function processReadyCount(text, today, deps) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || !HEAD.test(lines[0])) return null;

  let day = today;
  const dm = lines[0].match(DATE);
  if (dm) {
    day = parseDate(dm[1], today);
    if (!day) return [`The date "${dm[1]}" does not look valid. Nothing was saved.`];
  }

  const sh = await deps.loadShorthand();
  const counts = new Map();
  const problems = [];
  for (const raw of lines.slice(1)) {
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
  }
  if (problems.length) return [`Nothing was saved.\n${problems.join('\n')}`];
  if (!counts.size) return null;

  await deps.ensureTab(TAB, READY_HEADERS);
  const stamp = bangkokNow();
  await deps.appendRows(TAB, [...counts].map(([dish, n]) => [dish, n, formatDMY(day), stamp]), { raw: true });
  return [`Closing count saved for ${formatDMY(day)}:\n${[...counts].map(([d, n]) => `${d} ${n}`).join('\n')}\nAnalysis, Home stock and To Do follow these. Cooking and sales after ${formatDMY(day)} are added on top.`];
}

module.exports = { processReadyCount, TAB };
