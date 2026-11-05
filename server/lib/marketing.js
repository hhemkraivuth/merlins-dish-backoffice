// Marketing: sales this week and month, plus the notes the team keeps (competitors, inspo, trends, ad drafts).
// Notes live in the "Marketing Notes" tab: Date | Kind | Title | Note | Status. Ad drafts are only ever drafts here.
// Nothing here publishes or spends. Festival dates are fixed calendar dates only, lunar ones are added by hand as notes.

const { formatDMY, daysBetween } = require('./dates');
const { summarise, periodOf } = require('./reports');

const TAB = 'Marketing Notes';
const HEADERS = ['Date', 'Kind', 'Title', 'Note', 'Status'];
const KINDS = ['Competitor', 'Inspo', 'Trend', 'Ad draft', 'Date'];

// month (1-12), day, label
const FIXED_DATES = [
  [2, 14, "Valentine's Day"], [4, 13, 'Songkran starts'], [5, 11, "Mother's Day (Thailand is 12/08, this is AU/US)"],
  [8, 12, "Mother's Day (Thailand)"], [10, 31, 'Halloween'], [12, 5, "Father's Day (Thailand)"],
  [12, 24, 'Christmas Eve'], [12, 25, 'Christmas Day'], [12, 31, "New Year's Eve"],
].filter((d) => !d[2].includes('AU/US'));

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
      if (away >= 0 && away <= within) out.push({ date: formatDMY(date), label, away });
    }
  }
  return out.sort((a, b) => a.away - b.away);
}

function line(p) {
  if (!p) return { orders: 0, gross: 0, text: 'No orders yet' };
  const orders = p.grab.orders + p.line.orders;
  return { orders, grab: p.grab.orders, line: p.line.orders, text: plural(orders, 'order'), grabText: `${plural(p.grab.orders, 'order')}, ${baht(p.grab.gross)}`, lineText: `${plural(p.line.orders, 'order')}, ${baht(p.line.net)}` };
}

function buildMarketing({ today, ledger = [], noteRows = [] }) {
  const find = (grain) => summarise(ledger, [], [], grain, { through: today }).find((p) => p.key === periodOf(today, grain).key) || null;
  const notes = notesFrom(noteRows);
  const byKind = {};
  for (const k of KINDS) byKind[k] = notes.filter((n) => n.kind === k);
  const last = notes.find((n) => n.kind === 'Competitor');
  const audit = last ? daysBetween(today, parseNoteDate(last.date)) : null;
  return {
    today: formatDMY(today),
    week: line(find('week')),
    month: line(find('month')),
    notes: byKind,
    kinds: KINDS,
    dates: upcomingDates(today),
    auditDue: audit === null || audit >= 14,
    auditNote: audit === null ? 'No competitor check logged yet.' : `Last competitor check ${audit} day${audit === 1 ? '' : 's'} ago.`,
  };
}

function parseNoteDate(text) {
  const m = String(text).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : new Date(0);
}

module.exports = { buildMarketing, notesFrom, upcomingDates, TAB, HEADERS, KINDS };
