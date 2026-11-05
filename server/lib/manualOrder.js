// Direct (LINE or Instagram) orders that came in while the bot was down, typed in by hand.
//
//   23/10 นทิน        (add ig after the date for an Instagram order: 23/10 ig Cee)
//   Red Wine Beef Stew (Regular) 285
//   Tubetti (Extra) 45
//   total 330
//
// A blank line starts the next order. First line: date, an optional time (19:30), then the customer's name(s).
// Item lines end in the price of ONE portion; start with "2x " for more than one. "delivery 50" and "discount 30" are also read.
// "total 330" is optional, and when it is there it has to match or the order is refused, so a typo cannot reach the books.
// Rows look exactly like the ones the bot's own orders make, so every report treats them the same way.

const crypto = require('crypto');
const { parseDate, formatDMY } = require('./dates');

const money = (n) => (n === null || n === undefined ? '' : Math.round(n * 100) / 100);
const PRICE_TAIL = /^(?:(\d+)\s*x\s+)?(.+?)\s+(?:฿\s*)?(\d+(?:\.\d+)?)\s*(?:thb|baht|฿)?$/i;

// Returns { orders: [{ dmy, name, rows, total }], problems }
function parseManualOrders(text, today) {
  const blocks = String(text || '').split(/\r?\n\s*\r?\n/).map((b) => b.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  const orders = []; const problems = [];
  for (const lines of blocks) {
    const head = lines[0].match(/^(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\s+(?:(\d{1,2}:\d{2})\s+)?(?:(ig|instagram)\s+)?(.+)$/i);
    if (!head) { problems.push(`"${lines[0]}" should start with a date and the customer's name, like: 23/10 Cee`); continue; }
    const date = parseDate(head[1], today);
    if (!date) { problems.push(`"${head[1]}" is not a valid date`); continue; }
    const dmy = formatDMY(date); const time = head[2] || ''; const name = head[4].trim(); const from = head[3] ? 'Instagram' : 'LINE';
    const items = []; let delivery = 0; let discount = 0; let stated = null; let bad = null;
    for (const line of lines.slice(1)) {
      let m;
      if ((m = line.match(/^total\s*[:\-]?\s*(?:฿\s*)?(\d+(?:\.\d+)?)\s*(?:thb|baht|฿)?$/i))) { stated = Number(m[1]); continue; }
      if ((m = line.match(/^delivery(?:\s+fee)?\s*[:\-]?\s*(?:฿\s*)?(\d+(?:\.\d+)?)\s*(?:thb|baht|฿)?$/i))) { delivery += Number(m[1]); continue; }
      if ((m = line.match(/^discount\s*[:\-]?\s*(?:฿\s*)?(\d+(?:\.\d+)?)\s*(?:thb|baht|฿)?$/i))) { discount += Number(m[1]); continue; }
      m = line.match(PRICE_TAIL);
      if (!m) { bad = line; break; }
      items.push({ qty: Number(m[1] || 1), name: m[2].trim(), price: Number(m[3]) });
    }
    if (bad) { problems.push(`${dmy} ${name}: couldn't read "${bad}". Write it like: Creamy Chicken Soup 165`); continue; }
    if (!items.length) { problems.push(`${dmy} ${name}: no item lines`); continue; }
    const total = items.reduce((s, i) => s + i.qty * i.price, 0) + delivery - discount;
    if (stated !== null && Math.abs(stated - total) > 0.5) { problems.push(`${dmy} ${name}: the lines add to ${total} but you wrote total ${stated}. Nothing was added for this order.`); continue; }

    const sig = crypto.createHash('sha1').update([dmy, time, name, JSON.stringify(items), delivery, discount, from].join('|')).digest('hex').slice(0, 10);
    const ref = `#M${sig.slice(0, 4).toUpperCase()}`;
    const rows = items.map((it, i) => [dmy, it.name, 'LINE', from, 'Order', it.qty, it.price, '', money(it.qty * it.price), name, ref, time, `L|M${sig}|${i}`, i === 0 ? 'Typed in by hand (bot was down)' : '']);
    if (delivery) rows.push([dmy, 'Delivery fee charged', 'LINE', from, 'Delivery', 1, money(delivery), '', money(delivery), name, ref, time, `L|M${sig}|f`, '']);
    if (discount) rows.push([dmy, 'Promo discount', 'LINE', from, 'Discount', 1, '', money(discount), money(-discount), name, ref, time, `L|M${sig}|d`, '']);
    orders.push({ dmy, name, ref, total, rows });
  }
  return { orders, problems };
}

module.exports = { parseManualOrders };
