// "rider 001 55"  logs what you paid the rider for order #001 (today), as a cost.
// "rider 001 55 3/11"  same, for an order on another day.
// "rider 001,002 80"   one trip carrying two orders: the fee is split evenly between them.
// Sending a fee again for the same order corrects it. What the customer paid for delivery is income and comes from the
// bot's Orders tab (the Delivery rows), so it is not typed here.
//
// deps: { findOrders(dmy) -> [{ orderNo, customer }] for LINE orders that day, saveRider(rows, keys) }
// Returns an array of replies, or null when the text is not a rider command.

const { parseDate, formatDMY } = require('./dates');
const { riderRow } = require('./ledger');

const RIDER = /^rider\s+([\d,\s+&]+?)\s+(\d+(?:[.,]\d+)?)\s*(?:thb|baht|฿)?(?:\s+(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?))?$/i;
const baht = (n) => `฿${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const ref = (n) => `#${String(n).padStart(3, '0')}`;

function splitEvenly(total, count) {
  const each = Math.floor((total / count) * 100) / 100;
  const out = Array(count).fill(each);
  out[count - 1] = Math.round((total - each * (count - 1)) * 100) / 100;
  return out;
}

async function processRider(text, messageDate, deps) {
  const raw = String(text || '').trim();
  if (!/^rider\b/i.test(raw)) return null;
  const m = RIDER.exec(raw);
  if (!m) return ['Send the rider fee like this:\nrider 001 55\nFor another day: rider 001 55 3/11\nOne trip, two orders: rider 001,002 80'];

  const nos = [...new Set(m[1].split(/[,\s+&]+/).filter(Boolean).map((n) => ref(Number(n))))];
  const fee = Number(m[2].replace(',', '.'));
  const date = m[3] ? parseDate(m[3], messageDate) : messageDate;
  if (!date) return [`"${m[3]}" doesn't look like a valid date.`];
  const dmy = formatDMY(date);

  const found = await deps.findOrders(dmy);
  const byNo = new Map(found.map((o) => [o.orderNo, o]));
  const missing = nos.filter((n) => !byNo.has(n));
  if (missing.length) {
    const have = [...byNo.keys()].sort();
    return [`I can't find LINE order ${missing.join(', ')} on ${dmy}. Nothing was logged.${have.length ? `\nOrders I have for that day: ${have.join(', ')}` : '\nI have no LINE orders for that day yet. Send "sync" and try again.'}`];
  }

  const shares = splitEvenly(fee, nos.length);
  const rows = nos.map((n, i) => riderRow({ dmy, orderNo: n, customer: byNo.get(n).customer, fee: shares[i], note: nos.length > 1 ? `Shared trip ${nos.join(' + ')}, ${baht(fee)} split evenly` : '' }));
  const { replaced } = await deps.saveRider(rows, rows.map((r) => r[12]));
  const lines = nos.map((n, i) => `${n} ${byNo.get(n).customer || ''}: ${baht(shares[i])}`.trim());
  return [`Rider fee logged for ${dmy}${replaced ? ` (replaced ${replaced} earlier entr${replaced === 1 ? 'y' : 'ies'})` : ''}:\n${lines.join('\n')}${nos.length > 1 ? `\nTotal ${baht(fee)}, split evenly.` : ''}`];
}

module.exports = { processRider, splitEvenly };
