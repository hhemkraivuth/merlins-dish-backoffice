// Delivery cost per LINE order: what the customer paid for delivery (often nothing, free delivery) against what you
// actually paid the rider. Read from the Ledger rows, so it never needs its own storage. Saving a fee uses the same
// Rider rows as the "rider 001 55" LINE command, so both ways land in the same place and the Numbers page picks them up.

const { daysBetween } = require('./dates');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const monthOf = (dmy) => String(dmy).slice(3); // "11/11/2026" -> "11/2026"

// ledger: ledgerObjects() result. today: Date. days: how far back to list (default 21).
// Returns { orders, missing, month } where orders are newest first.
function riderView(ledger, today, days = 21) {
  const by = new Map();
  for (const r of ledger || []) {
    if (r.channel !== 'LINE' || !String(r.orderNo || '').startsWith('#')) continue;
    if (!['Order', 'Delivery', 'Discount', 'Rider'].includes(r.type)) continue;
    const k = `${r.dmy}|${r.orderNo}`;
    if (!by.has(k)) by.set(k, { dmy: r.dmy, date: r.date, orderNo: r.orderNo, customer: '', time: '', items: 0, discount: 0, delivery: 0, rider: null, riderNote: '' });
    const o = by.get(k);
    if (r.customer && !o.customer) o.customer = r.customer;
    if (r.time && !o.time) o.time = r.time;
    if (r.type === 'Order') o.items += Number(r.net) || 0;
    else if (r.type === 'Discount') o.discount += Math.abs(Number(r.net) || 0);
    else if (r.type === 'Delivery') o.delivery += Math.abs(Number(r.net) || 0);
    else if (r.type === 'Rider') { o.rider = (o.rider || 0) + Math.abs(Number(r.net) || 0); if (r.flags) o.riderNote = r.flags; }
  }
  const all = [...by.values()].filter((o) => o.items > 0 || o.delivery > 0).map((o) => ({
    ...o, items: r2(o.items), discount: r2(o.discount), delivery: r2(o.delivery), rider: o.rider === null ? null : r2(o.rider),
    free: o.delivery === 0,
  }));
  const list = all
    .filter((o) => daysBetween(today, o.date) <= days)
    .sort((a, b) => b.date - a.date || String(b.time).localeCompare(String(a.time)) || b.orderNo.localeCompare(a.orderNo))
    .map(({ date, ...o }) => o);

  // This month: what free delivery cost you against what paid delivery brought in.
  const thisMonth = monthOf(`${String(today.getUTCDate()).padStart(2, '0')}/${String(today.getUTCMonth() + 1).padStart(2, '0')}/${today.getUTCFullYear()}`);
  const mine = all.filter((o) => monthOf(o.dmy) === thisMonth);
  const freeLogged = mine.filter((o) => o.free && o.rider !== null);
  const month = {
    label: thisMonth,
    orders: mine.length,
    freeOrders: mine.filter((o) => o.free).length,
    freeLogged: freeLogged.length,
    freeRiderCost: r2(freeLogged.reduce((s, o) => s + o.rider, 0)),
    deliveryCharged: r2(mine.reduce((s, o) => s + o.delivery, 0)),
    riderPaid: r2(mine.reduce((s, o) => s + (o.rider || 0), 0)),
  };
  // Today's orders are still open, so only finished days count as missing.
  const todayDmy = `${String(today.getUTCDate()).padStart(2, '0')}/${String(today.getUTCMonth() + 1).padStart(2, '0')}/${today.getUTCFullYear()}`;
  const missing = list.filter((o) => o.rider === null && o.dmy !== todayDmy).length;
  return { orders: list, missing, month };
}

// Rows to save for a rider fee typed on the web. Works with any order number ("#001", "#MF174"), unlike the LINE command
// which only reads numbers. orders: [{ orderNo, customer }] found for that day. Several orders on one trip split the fee evenly.
// Returns { rows, keys, shares, nos }.
function buildRiderRows({ dmy, orderNos, fee }, orders) {
  const { riderRow } = require('./ledger');
  const { splitEvenly } = require('./riderCommand');
  const nos = [...new Set((Array.isArray(orderNos) ? orderNos : [orderNos]).map((n) => String(n || '').trim().replace(/^#?/, '#')).filter((n) => n !== '#'))];
  if (!nos.length) throw Object.assign(new Error('Pick the order the rider fee is for.'), { status: 400 });
  const amount = String(fee ?? '').replace(/[฿,\s]/g, '').replace(/thb|baht/i, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw Object.assign(new Error('Type the rider fee as a number, for example 55. Type 0 if there was no rider (pickup).'), { status: 400 });
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(dmy || ''))) throw Object.assign(new Error('That order has no date.'), { status: 400 });
  const byNo = new Map((orders || []).map((o) => [String(o.orderNo).toUpperCase(), o]));
  const found = nos.map((n) => byNo.get(n.toUpperCase()));
  const missing = nos.filter((n, i) => !found[i]);
  if (missing.length) throw Object.assign(new Error(`I can't find LINE order ${missing.join(', ')} on ${dmy}. Nothing was saved. Press "Fetch new LINE orders" and try again.`), { status: 400 });
  const shares = splitEvenly(Number(amount), nos.length);
  const rows = nos.map((n, i) => riderRow({ dmy, orderNo: found[i].orderNo, customer: found[i].customer, fee: shares[i], note: nos.length > 1 ? `Shared trip ${nos.join(' + ')}, ฿${Number(amount)} split evenly` : '' }));
  return { rows, keys: rows.map((r) => r[12]), shares, nos: found.map((o) => o.orderNo) };
}

module.exports = { riderView, buildRiderRows };
