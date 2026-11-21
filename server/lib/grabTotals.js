// Grab Daily Business Report totals, one row a day, kept to check the Ledger against.
//
// The 16:05 task reads each day's Grab PDF and saves a second small file next to the CSV in "Ready for BOH":
//   grab_totals_DD_MM_YYYY.csv    Date,Orders,Gross,Store promo,Commission,Marketing fee,Net,Advertising fee
// BOH stores it in the "Grab Day Totals" tab (a re-sent day replaces its old row) and the Audit compares each day with the
// Ledger's Grab rows: gross against the Order rows, net against Order plus Grab rows. Money is in plain baht numbers.

const { parseCsv } = require('./csv');
const { parseDate, formatDMY, bangkokNow } = require('./dates');

const TAB = 'Grab Day Totals';
const HEADERS = ['Date', 'Orders', 'Gross', 'Store promo', 'Commission', 'Marketing fee', 'Net', 'Advertising fee', 'Logged At'];
const TOLERANCE = 0.5; // baht
const num = (v) => { const n = Number(String(v ?? '').replace(/[฿,\s]/g, '')); return Number.isFinite(n) ? n : null; };
const isTotalsFile = (name) => /^grab_totals_/i.test(String(name || ''));
const r2 = (x) => Math.round(x * 100) / 100;

// CSV text -> { rows: [{ date, orders, gross, promo, commission, marketing, net, adFee }], problems }
function parseTotalsCsv(text) {
  const table = parseCsv(text);
  const problems = [];
  if (!table.length) return { rows: [], problems: ['The totals file is empty.'] };
  const head = table[0].map((h) => String(h || '').trim().toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const idx = { date: col(/^date/), orders: col(/order/), gross: col(/gross/), promo: col(/promo|discount/), commission: col(/commission/), marketing: col(/marketing/), net: col(/^net/), adFee: col(/advertis|ad fee/) };
  if (idx.date < 0 || idx.gross < 0 || idx.net < 0) return { rows: [], problems: ['The totals file needs Date, Gross and Net columns.'] };
  const rows = [];
  table.slice(1).forEach((r, i) => {
    const date = parseDate(r[idx.date]);
    const gross = num(r[idx.gross]); const net = num(r[idx.net]);
    if (!date || gross === null || net === null) { problems.push(`Row ${i + 2}: no date, gross or net, skipped.`); return; }
    const get = (k) => (idx[k] >= 0 ? num(r[idx[k]]) : null);
    rows.push({ date, orders: get('orders'), gross, promo: get('promo'), commission: get('commission'), marketing: get('marketing'), net, adFee: get('adFee') });
  });
  return { rows, problems };
}

// Tab rows (header first) -> [{ date, orders, gross, ..., net }]. The newest row for a day wins.
function totalsFrom(sheetRows) {
  const byDay = new Map();
  for (const r of (sheetRows || []).slice(1)) {
    const date = parseDate(r[0]); if (!date) continue;
    byDay.set(formatDMY(date), { date, orders: num(r[1]), gross: num(r[2]), promo: num(r[3]), commission: num(r[4]), marketing: num(r[5]), net: num(r[6]), adFee: num(r[7]) });
  }
  return [...byDay.values()];
}

// deps: { ensureTab(name, headers), appendRows(tab, rows), deleteRowsWhere(tab, pred) }. Returns an import result like importGrabCsv's.
async function importTotals(text, deps) {
  const { rows, problems } = parseTotalsCsv(text);
  if (!rows.length) return { imported: 0, problems };
  await deps.ensureTab(TAB, HEADERS);
  const days = new Set(rows.map((r) => formatDMY(r.date)));
  if (deps.deleteRowsWhere) await deps.deleteRowsWhere(TAB, (row) => { const d = parseDate(row[0]); return d && days.has(formatDMY(d)); });
  await deps.appendRows(TAB, rows.map((r) => [formatDMY(r.date), r.orders ?? '', r.gross, r.promo ?? '', r.commission ?? '', r.marketing ?? '', r.net, r.adFee ?? '', bangkokNow()]));
  return { imported: rows.length, replaced: 0, orders: rows.reduce((t, r) => t + (r.orders || 0), 0), flagged: 0, days: [...days], problems, totals: true };
}

// Audit findings: each day with a PDF total whose Ledger rows differ. ledger: ledgerObjects. totals: totalsFrom.
function checkTotals(ledger, totals) {
  const out = [];
  for (const t of totals) {
    const day = formatDMY(t.date);
    const rows = ledger.filter((r) => r.channel === 'Grab' && formatDMY(r.date) === day && (r.type === 'Order' || r.type === 'Grab'));
    if (!rows.length) { out.push({ day, t, missing: true }); continue; }
    const gross = rows.filter((r) => r.type === 'Order').reduce((s, r) => s + (r.qty || 1) * (r.moneyIn || 0), 0);
    const net = rows.reduce((s, r) => s + (r.net || 0), 0);
    const orders = new Set(rows.map((r) => r.orderNo).filter(Boolean)).size;
    const dGross = r2(gross - t.gross); const dNet = r2(net - t.net);
    if (Math.abs(dGross) > TOLERANCE || Math.abs(dNet) > TOLERANCE || (t.orders !== null && t.orders !== orders)) out.push({ day, t, gross: r2(gross), net: r2(net), orders, dGross, dNet });
  }
  return out;
}

module.exports = { TAB, HEADERS, isTotalsFile, parseTotalsCsv, totalsFrom, importTotals, checkTotals };
