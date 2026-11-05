// Grab advertisement fees. Merlin's numbers takes them off "Net Grab earning" (Aug and Sep do), so the app does the same.
// They are not in the nightly Grab rows, so they come from here:
//   1. The "Grab Ads" tab of the Claude Log (columns: Date | Amount | Note). Amount is what Grab took, VAT included. Add a row per day or one per month.
//   2. For months the tab does not cover, the figures below, taken from the Grab Reports sheet ("ทั้งหมด" column of the advertisement rows).
// They count as a Grab fee in "Other Grab fees". They never count as money to take out, because Grab keeps them before paying you.
const { parseDate } = require('./dates');
const { num } = require('./ledger');

const TAB = 'Grab Ads';
const HEADERS = ['Date', 'Amount', 'Note'];

const KNOWN = [
  ['01/10/2026', 379.06], ['05/10/2026', 150.71], ['06/10/2026', 28.42], ['07/10/2026', 28.42], ['08/10/2026', 135.92],
  ['12/10/2026', 162], ['14/10/2026', 53.75], ['15/10/2026', 28.42], ['19/10/2026', 189.67], ['20/10/2026', 225.8],
  ['21/10/2026', 189.67], ['22/10/2026', 331.06], ['23/10/2026', 216], ['26/10/2026', 119.42], ['29/10/2026', 69.91],
]; // 2,308.23 for October, the same as Grab's statement (46,537.42 net earnings less 44,229.19 paid out)

const monthKey = (d) => `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;

// tabRows: the Grab Ads tab as read (header first, or empty). Returns [{ date, name, amount, kind: 'grabads' }]
function grabAdsFrom(tabRows) {
  const fromTab = [];
  (tabRows || []).forEach((r, i) => {
    if (i === 0 && /date/i.test(String(r[0] || ''))) return;
    const date = parseDate(r[0]);
    const amount = num(r[1]);
    if (!date || amount === null) return;
    fromTab.push({ date, name: String(r[2] || 'Grab ads').trim() || 'Grab ads', amount: Math.abs(amount), kind: 'grabads' });
  });
  const covered = new Set(fromTab.map((x) => monthKey(x.date)));
  const known = KNOWN.map(([d, amount]) => ({ date: parseDate(d), name: 'Grab ads', amount, kind: 'grabads' })).filter((x) => !covered.has(monthKey(x.date)));
  return [...fromTab, ...known];
}

module.exports = { grabAdsFrom, TAB, HEADERS, KNOWN };
