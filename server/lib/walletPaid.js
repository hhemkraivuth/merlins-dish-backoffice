// Purchases paid straight from the Merlin's account, not from Lily's own money. They are still costs, but they are not
// money to take out, because Lily never paid them. Source:
//   1. The "Wallet Paid" tab of the Claude Log (columns: Date | Amount | Note). One row per payment taken from the account.
//   2. For months the tab does not cover, the figures below, found on the bank statement and matched to the Expense Log.
const { parseDate } = require('./dates');
const { num } = require('./ledger');

const TAB = 'Wallet Paid';
const HEADERS = ['Date', 'Amount', 'Note'];

const KNOWN = [
  ['23/10/2026', 730.5, 'CP Extra, the ten cooking ingredient lines of the 23/10 receipts'],
];

const monthKey = (d) => `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;

// tabRows: the Wallet Paid tab as read (header first, or empty). Returns [{ date, name, amount, kind: 'walletpaid' }]
function walletPaidFrom(tabRows) {
  const fromTab = [];
  (tabRows || []).forEach((r, i) => {
    if (i === 0 && /date/i.test(String(r[0] || ''))) return;
    const date = parseDate(r[0]);
    const amount = num(r[1]);
    if (!date || amount === null) return;
    fromTab.push({ date, name: String(r[2] || 'Paid from account').trim() || 'Paid from account', amount: Math.abs(amount), kind: 'walletpaid' });
  });
  const covered = new Set(fromTab.map((x) => monthKey(x.date)));
  const known = KNOWN.map(([d, amount, name]) => ({ date: parseDate(d), name, amount, kind: 'walletpaid' })).filter((x) => !covered.has(monthKey(x.date)));
  return [...fromTab, ...known];
}

module.exports = { walletPaidFrom, TAB, HEADERS, KNOWN };
