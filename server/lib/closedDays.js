// Closed days: the shop was shut, so the reports say "Closed" instead of just showing a day with no sales.
//
//   close 12/11                    one day (past, today or coming up)
//   close 12/11 rain, no riders    one day, with the reason
//   close 12/11-14/11 holiday      a run of days
//   close today sick day
//   unclose 12/11                  takes a closed day back out (a run works too: unclose 12/11-14/11)
//
// The order app reads the same message and stops right away orders for the days still to come. This side keeps the record,
// so a past day is remembered after the order app has cleared it. Rows go to the "Closed Days" tab, latest row for a date wins.

const { parseDate, formatDMY, bangkokNow } = require('./dates');

const TAB = 'Closed Days';
const HEADERS = ['Date', 'Reason', 'Logged at'];
const DAY = 86400000;
const MAX_DAYS = 31;
const D = '\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?';
const CLOSE = new RegExp(`^close\\s+(today|${D})(?:\\s*-\\s*(${D}))?(?:[\\s:,]+(.+))?$`, 'i');

const UNCLOSE = new RegExp(`^(?:unclose|reopen)\\s+(today|${D})(?:\\s*-\\s*(${D}))?\\s*$`, 'i');

const iso = (d) => d.toISOString().slice(0, 10);

// A date with no year is the one nearest today: this year, unless that is more than six months away.
function dayOf(token, today) {
  if (/^today$/i.test(token)) return today;
  const m = token.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/);
  if (!m) return null;
  if (m[3]) return parseDate(token, today);
  let d = parseDate(`${m[1]}/${m[2]}/${today.getUTCFullYear()}`, today);
  if (d && today.getTime() - d.getTime() > 183 * DAY) d = parseDate(`${m[1]}/${m[2]}/${today.getUTCFullYear() + 1}`, today);
  else if (d && d.getTime() - today.getTime() > 183 * DAY) d = parseDate(`${m[1]}/${m[2]}/${today.getUTCFullYear() - 1}`, today);
  return d;
}

// Sheet rows (header first) to Map of YYYY-MM-DD to reason. The latest row for a date wins.
function closedFrom(rows) {
  const out = new Map();
  for (const r of (rows || []).slice(1)) {
    const d = parseDate(r[0]);
    if (d) out.set(iso(d), String(r[1] || '').trim());
  }
  return out;
}

// "unclose 12/11": deletes that day's rows from the Closed Days tab, so the reports show the day as an ordinary day again.
async function processUnclose(t, today, deps) {
  const m = UNCLOSE.exec(t);
  if (!m) return ['Write it like: unclose 12/11 (or a run: unclose 12/11-14/11).'];
  const from = dayOf(m[1], today);
  const to = m[2] ? dayOf(m[2], today) : from;
  if (!from || !to) return ['I could not read that date. Write it like: unclose 12/11'];
  if (to < from) return ['The last day comes before the first day. Nothing was changed.'];
  if (Math.round((to - from) / DAY) + 1 > MAX_DAYS) return [`That is more than ${MAX_DAYS} days. Nothing was changed.`];
  if (!deps.deleteRowsWhere) return ['Removing a closed day is not set up on this server yet. Delete the row in the Closed Days tab.'];
  const gone = await deps.deleteRowsWhere(TAB, (r) => { const d = parseDate(r[0]); return d && d >= from && d <= to; });
  const when = from.getTime() === to.getTime() ? formatDMY(from) : `${formatDMY(from)} to ${formatDMY(to)}`;
  return [gone ? `Took ${when} out of the closed days (${gone} ${gone === 1 ? 'row' : 'rows'}). The reports show it as an ordinary day again.` : `${when} was not marked closed here, so nothing changed.`];
}

// How many of the closed days (Map of YYYY-MM-DD to reason) fall between two dates, both included.
function countClosed(closed, from, to) {
  if (!closed) return 0;
  let n = 0;
  for (const k of closed.keys()) if (k >= iso(from) && k <= iso(to)) n += 1;
  return n;
}

// deps: { ensureTab(name, headers), appendRows(tab, rows, opts), deleteRowsWhere(tab, fn) }. Returns replies, or null when the text is not a dated close.
async function processClose(text, today, deps) {
  const t = String(text || '').trim();
  if (/^(?:unclose|reopen)\s/i.test(t)) return processUnclose(t, today, deps);
  if (!/^close\s/i.test(t)) return null;
  const m = CLOSE.exec(t);
  if (!m) return null; // plain "close", or something the order app handles on its own
  const from = dayOf(m[1], today);
  const to = m[2] ? dayOf(m[2], today) : from;
  if (!from || !to) return [`I could not read that date. Write it like: close 12/11 rain, no riders`];
  if (to < from) return ['The last day comes before the first day. Nothing was saved.'];
  const days = Math.round((to - from) / DAY) + 1;
  if (days > MAX_DAYS) return [`That is ${days} days. Close up to ${MAX_DAYS} days at a time. Nothing was saved.`];
  const reason = (m[3] || '').trim();

  await deps.ensureTab(TAB, HEADERS);
  const stamp = bangkokNow();
  const rows = [];
  for (let i = 0; i < days; i += 1) rows.push([formatDMY(new Date(from.getTime() + i * DAY)), reason, stamp]);
  await deps.appendRows(TAB, rows, { raw: true });
  const when = days === 1 ? formatDMY(from) : `${formatDMY(from)} to ${formatDMY(to)} (${days} days)`;
  return [`Closed ${when} noted${reason ? `: ${reason}` : ''}. The reports show it as Closed instead of no sales.`];
}

module.exports = { processClose, closedFrom, countClosed, dayOf, TAB, HEADERS };
