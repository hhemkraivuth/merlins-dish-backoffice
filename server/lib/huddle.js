// The daily huddle: one short message for the back of house LINE group.
// Pure text building. Grab data arrives a day or more late (the CSV is pasted in after the 03:00 run),
// so every channel states how far its data goes.

const { formatDMY, daysBetween } = require('./dates');
const { summarise, periodOf, addDays } = require('./reports');

const baht = (n) => `฿${Math.round(n).toLocaleString('en-AU')}`;

function lastDate(ledger, channel) {
  let best = null;
  for (const r of ledger) if (r.channel === channel && (!best || r.date > best)) best = r.date;
  return best;
}

function dayLine(ledger, date) {
  const day = ledger.filter((r) => r.date.getTime() === date.getTime());
  const p = summarise(day, [], [], 'week')[0];
  if (!p) return 'no sales recorded';
  const bits = [];
  if (p.grab.orders) bits.push(`Grab ${p.grab.orders} orders, ${baht(p.grab.gross)} gross, ${baht(p.grab.net)} after fees`);
  if (p.line.orders) bits.push(`LINE ${p.line.orders} orders, ${baht(p.line.net)}`);
  return bits.length ? bits.join('. ') : 'no sales recorded';
}

function weekLine(periods, today) {
  const wk = periodOf(today, 'week');
  const p = periods.find((x) => x.key === wk.key);
  if (!p) return null;
  return `This week so far: ${baht(p.revenue)} net income, ${baht(p.foodCost)} food cost, ${baht(p.margin)} margin after overheads and ads${p.marginPct === null ? '' : ` (${p.marginPct}% of gross)`}.`;
}

// { today, ledger, cookBatches, purchases, stock, open }
function buildHuddle({ today, ledger, cookBatches, purchases, stock, open, lowPacks = [] }) {
  const yesterday = addDays(today, -1);
  const out = [`Daily huddle, ${formatDMY(today)}`, ''];
  out.push(`Yesterday (${formatDMY(yesterday)}): ${dayLine(ledger, yesterday)}.`);

  const wk = weekLine(summarise(ledger, cookBatches, purchases, 'week'), today);
  if (wk) out.push(wk);

  const g = lastDate(ledger, 'Grab');
  const l = lastDate(ledger, 'LINE');
  const notes = [];
  if (g) notes.push(`Grab data runs to ${formatDMY(g)}${daysBetween(today, g) > 2 ? ' (import the latest CSV)' : ''}`);
  else notes.push('No Grab data imported yet');
  if (l) notes.push(`LINE data runs to ${formatDMY(l)}`);
  out.push(notes.join('. ') + '.');

  if (stock.length) {
    out.push('', 'Stock left:');
    for (const s of stock) {
      const age = s.remaining > 0 ? `, oldest ${s.oldestAgeDays} days` : '';
      out.push(`• ${s.dish}: ${s.remaining}${age}${s.oversold ? ` (${s.oversold} sold beyond cook notes)` : ''}`);
    }
  }

  if (lowPacks.length) out.push('', `Running low: ${lowPacks.join(', ')}`);

  if (open.length) {
    out.push('', `Open handoffs (${open.length}):`);
    for (const h of open.slice(0, 8)) out.push(`• ${h.from} to ${h.to}: ${h.message}`);
    if (open.length > 8) out.push(`• plus ${open.length - 8} more in the Handoffs tab`);
  } else out.push('', 'No open handoffs.');
  return out.join('\n');
}

function buildPeriodText(periods, type, today) {
  if (!periods.length) return 'No sales in the Ledger yet. Import the Grab CSV and sync LINE orders first.';
  const cur = periodOf(today, type);
  const p = periods.find((x) => x.key === cur.key) || periods[periods.length - 1];
  const out = [`${type === 'month' ? 'Month' : 'Week'} ${p.label}`];
  out.push(`Grab: ${p.grab.orders} orders, ${baht(p.grab.gross)} gross, fees and discounts ${baht(p.grab.discount + p.grab.commission + p.grab.marketing + p.grab.otherFees)}, ${baht(p.grab.net)} net`);
  out.push(`LINE: ${p.line.orders} orders, ${baht(p.line.gross)} gross, ${baht(p.line.net)} net, plus ${baht(p.line.delivery)} delivery charged`);
  out.push(`Net income: ${baht(p.revenue)}`);
  out.push(`Food cost: ${baht(p.foodCost)} (batches ${baht(p.cookCost)}, recipe items ${baht(p.recipeCost + p.lineEstCost)})`);
  out.push(`Rider fees paid: ${baht(p.line.rider)}`);
  out.push(`Overheads bought (pots, bags, knives): ${baht(p.overheads)}`);
  out.push(`Ads spend: Meta ${baht(p.adsMeta)}, Grab ${baht(p.adsGrab)}`);
  out.push(`Margin after overheads and ads: ${baht(p.margin)}${p.marginPct === null ? '' : ` (${p.marginPct}% of gross)`}`);
  out.push(`Ingredient purchases (memo): ${baht(p.purchases)}`);
  if (p.missingCosts.length) out.push(`No cost found for: ${p.missingCosts.slice(0, 5).join(', ')}`);
  return out.join('\n');
}

module.exports = { buildHuddle, buildPeriodText };
