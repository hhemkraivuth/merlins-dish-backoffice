// Marketing: sales this week and month, plus the notes the team keeps (competitors, inspo, trends, ad drafts, weekly moves).
// Notes live in the "Marketing Notes" tab: Date | Kind | Title | Note | Status. Ad drafts are only ever drafts here.
// Nothing here publishes or spends. Festival dates are fixed calendar dates only, lunar ones are added by hand as notes.

const { formatDMY, daysBetween } = require('./dates');
const { summarise, periodOf } = require('./reports');

const TAB = 'Marketing Notes';
const HEADERS = ['Date', 'Kind', 'Title', 'Note', 'Status'];
const KINDS = ['Competitor', 'Inspo', 'Trend', 'Ad draft', 'Date', 'Move', 'Bet'];

// month (1-12), day, label
const FIXED_DATES = [
  [2, 14, "Valentine's Day"], [4, 13, 'Songkran starts'], [5, 11, "Mother's Day (Thailand is 12/08, this is AU/US)"],
  [8, 12, "Mother's Day (Thailand)"], [10, 31, 'Halloween'], [12, 5, "Father's Day (Thailand)"],
  [12, 24, 'Christmas Eve'], [12, 25, 'Christmas Day'], [12, 31, "New Year's Eve"],
].filter((d) => !d[2].includes('AU/US'));

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const baht = (n) => `฿${Math.round(n || 0).toLocaleString('en-AU')}`;

function notesFrom(rows) {
  return (rows || []).slice(1).filter((r) => r && (r[2] || r[3])).map((r, i) => ({
    row: i + 2, date: String(r[0] || ''), kind: String(r[1] || ''), title: String(r[2] || ''), note: String(r[3] || ''), status: String(r[4] || ''),
  })).reverse();
}

// Next fixed dates inside the coming 60 days, nearest first.
function upcomingDates(today, within = 60) {
  const out = [];
  for (const y of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
    for (const [m, d, label] of FIXED_DATES) {
      const date = new Date(Date.UTC(y, m - 1, d));
      const away = daysBetween(date, today);
      if (away >= 0 && away <= within) out.push({ date: formatDMY(date), day: DAYS[date.getUTCDay()], label, away });
    }
  }
  return out.sort((a, b) => a.away - b.away);
}

// Orders marked "Instagram" in the Order from column (channel stays LINE). One order is one order number.
function igIn(ledger, per) {
  const orders = new Set(); let net = 0;
  for (const r of ledger) {
    if (r.channel !== 'LINE' || !/^instagram$/i.test(r.orderFrom) || r.date < per.from || r.date > per.to) continue;
    net += r.net || 0;
    if (r.type === 'Order') orders.add(r.orderNo || `${r.dmy}|${r.customer}`);
  }
  return { orders: orders.size, net };
}

function line(p, ig) {
  if (!p) return { orders: 0, text: '0 orders', grabText: '0 orders, ฿0', lineText: '0 orders, ฿0', igText: '0 orders, ฿0' };
  const lineOrders = Math.max(p.line.orders - ig.orders, 0);
  const lineNet = p.line.net - ig.net;
  const orders = p.grab.orders + p.line.orders;
  return { orders, grab: p.grab.orders, line: lineOrders, ig: ig.orders, text: plural(orders, 'order'), grabText: `${plural(p.grab.orders, 'order')}, ${baht(p.grab.gross)}`, lineText: `${plural(lineOrders, 'order')}, ${baht(lineNet)}`, igText: `${plural(ig.orders, 'order')}, ${baht(ig.net)}` };
}


const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const DATE_RANGE_RE = /\s*\d{1,2}\/\d{1,2}\/\d{4}(\s+to\s+\d{1,2}\/\d{1,2}\/\d{4})?/g;

// First dd/mm/yyyy found in a note title, as a UTC date, or null.
function titleDate(title) {
  const m = String(title || '').match(DATE_RE);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
}

// One note per account (or per topic). A re-run of the Sunday check replaces the earlier summary on screen.
// Every row stays in the sheet and in the download, so history is never lost.
function noteKey(n) {
  const title = String(n.title || '');
  const handle = title.match(/@[\w.]+/);
  if (handle && (n.kind === 'Competitor' || n.kind === 'Inspo')) return `${n.kind}|${handle[0].toLowerCase()}`;
  return `${n.kind}|${title.replace(DATE_RANGE_RE, '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

function latestOnly(list) {
  const seen = new Set();
  return list.filter((n) => { const k = noteKey(n); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Date notes, soonest first. Dates already passed go to the bottom.
function sortDateNotes(list, today) {
  const rank = (n) => { const d = titleDate(n.title); if (!d) return 2e15; const away = daysBetween(d, today); return away >= 0 ? away : 1e15 - away; };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

// "Coming up": the fixed festival dates plus every Date note, so the box and the Dates section always agree.
function comingUp(today, dateNotes, within = 60) {
  const byDate = new Map();
  for (const d of upcomingDates(today, within)) byDate.set(d.date, d);
  for (const n of dateNotes) {
    const date = titleDate(n.title);
    if (!date) continue;
    const away = daysBetween(date, today);
    if (away < 0 || away > within) continue;
    const label = String(n.title).replace(DATE_RANGE_RE, '').replace(/\s+/g, ' ').trim();
    byDate.set(formatDMY(date), { date: formatDMY(date), day: DAYS[date.getUTCDay()], label: label || n.title, away });
  }
  return [...byDate.values()].sort((a, b) => a.away - b.away);
}

// Merlin's own price range. Direct prices come from the order bot's public menu. Grab prices are what Grab orders were
// actually charged (the most common unit price per dish in the ledger over the last 60 days, which mirrors the Master Log),
// because Grab's price is not a flat markup on the direct price. A dish with no Grab order yet falls back to direct + 25.
// Drinks, sides and extras are left out so the range compares with the competitors' mains and soups.
const GRAB_MARKUP = 25;
const baseName = (name) => String(name || '').replace(/\s*\+\s*pasta.*$/i, '').trim();

function grabPrices(ledger, today, within = 60) {
  const counts = new Map();
  for (const r of ledger || []) {
    if (r.channel !== 'Grab' || r.type !== 'Order' || !(r.qty > 0) || !(r.moneyIn > 0) || !r.date) continue;
    if (daysBetween(today, r.date) > within) continue;
    const name = baseName(r.desc);
    const price = Math.round((r.moneyIn / r.qty) * 100) / 100;
    const byPrice = counts.get(name) || new Map();
    byPrice.set(price, (byPrice.get(price) || 0) + 1);
    counts.set(name, byPrice);
  }
  const out = {};
  for (const [name, byPrice] of counts) out[name] = [...byPrice.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0][0];
  return out;
}

function merlinRange(menu, grab = {}) {
  const items = (menu && Array.isArray(menu.items) ? menu.items : []).filter((i) => Number(i.price) > 0 && !/drink|beverage|side|extra|add.?on|dessert/i.test(String(i.category || '')));
  if (!items.length) return null;
  const prices = items.map((i) => Number(i.price));
  const onGrab = items.map((i) => (grab[baseName(i.name)] > 0 ? grab[baseName(i.name)] : Number(i.price) + GRAB_MARKUP));
  const seen = items.filter((i) => grab[baseName(i.name)] > 0).length;
  return { direct: { lo: Math.min(...prices), hi: Math.max(...prices) }, grab: { lo: Math.min(...onGrab), hi: Math.max(...onGrab) }, count: items.length, grabSeen: seen };
}

// The month's bet when it is about moving Grab customers to direct. Counts direct (LINE or Instagram) orders placed from the start of the
// bet month to its deadline under a name that had already ordered on Grab. Names are matched ignoring case, spaces and punctuation.
// Masked names (XXXX or stars) are skipped because they could be anyone.
const nameKey = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const masked = (v) => /^[x*\s.]+$/i.test(String(v || '')) || /\*/.test(String(v || ''));

function betDeadline(title) {
  const all = [...String(title || '').matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)];
  if (!all.length) return null;
  const m = all[all.length - 1];
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
}

function grabToDirect(ledger, bet) {
  if (!bet || !/direct/i.test(bet.title) || !/grab/i.test(bet.title)) return null;
  const until = betDeadline(bet.title);
  if (!until) return null;
  const since = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), 1));
  const t = String(bet.title).match(/target\s+(\d+)/i) || String(bet.title).match(/(\d+)\s+direct orders/i);
  const target = t ? +t[1] : 5;
  const firstGrab = new Map();
  for (const r of ledger || []) {
    if (r.channel !== 'Grab' || r.type !== 'Order' || masked(r.customer)) continue;
    const k = nameKey(r.customer);
    if (k && (!firstGrab.has(k) || r.date < firstGrab.get(k))) firstGrab.set(k, r.date);
  }
  const orders = new Set();
  for (const r of ledger || []) {
    if (r.channel !== 'LINE' || r.type !== 'Order' || r.date < since || r.date > until || masked(r.customer)) continue;
    const k = nameKey(r.customer);
    if (k && firstGrab.has(k) && firstGrab.get(k) <= r.date) orders.add(r.orderNo || `${r.dmy}|${k}`);
  }
  return { count: orders.size, target, since: formatDMY(since), until: formatDMY(until) };
}

// Of the Bet notes, the headline is the one that starts with the month ("November: ..."). Falls back to the newest.
function headlineBet(list) { return (list || []).find((n) => /^[A-Za-z]+:\s/.test(n.title)) || (list || [])[0]; }

function buildMarketing({ today, ledger = [], noteRows = [], menu = null }) {
  const find = (grain) => summarise(ledger, [], [], grain, { through: today }).find((p) => p.key === periodOf(today, grain).key) || null;
  const notes = notesFrom(noteRows);
  const byKind = {};
  for (const k of KINDS) byKind[k] = latestOnly(notes.filter((n) => n.kind === k));
  byKind.Date = sortDateNotes(byKind.Date, today);
  const last = notes.find((n) => n.kind === 'Competitor');
  const audit = last ? daysBetween(today, parseNoteDate(last.date)) : null;
  return {
    today: formatDMY(today),
    week: line(find('week'), igIn(ledger, periodOf(today, 'week'))),
    month: line(find('month'), igIn(ledger, periodOf(today, 'month'))),
    notes: byKind,
    bet: grabToDirect(ledger, headlineBet(byKind.Bet)),
    merlin: merlinRange(menu, grabPrices(ledger, today)),
    kinds: KINDS,
    dates: comingUp(today, byKind.Date),
    history: [...notes].reverse(),
    auditDue: audit === null || audit >= 9,
    auditNote: audit === null ? 'First Sunday check is pending.' : `Last check ${last.date}, ${audit === 0 ? 'today' : `${audit} day${audit === 1 ? '' : 's'} ago`}.`,
  };
}

function parseNoteDate(text) {
  const m = String(text).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : new Date(0);
}

module.exports = { buildMarketing, grabToDirect, headlineBet, merlinRange, grabPrices, notesFrom, upcomingDates, comingUp, latestOnly, sortDateNotes, titleDate, TAB, HEADERS, KINDS };
