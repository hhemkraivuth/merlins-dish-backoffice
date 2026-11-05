// The Pit: one card per team with its latest update and its open handoffs. Pure text and numbers, read only.
// Teams follow the Handoffs tab: App sales (Grab), Direct sales (LINE), Operations (cooking), Purchasing.
// Grab data arrives late (the CSV lags), so every card says how far its own data runs.

const { formatDMY, daysBetween } = require('./dates');
const { summarise, periodOf, riderGaps, priceMoves } = require('./reports');

const baht = (n) => `฿${Math.round(n || 0).toLocaleString('en-AU')}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

function ago(today, date) {
  const d = daysBetween(today, date);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

function lastDateOf(ledger, channel) {
  let best = null;
  for (const r of ledger) if (r.channel === channel && (!best || r.date > best)) best = r.date;
  return best;
}

// Orders and money on one day for one channel.
function dayOf(ledger, channel, date) {
  const rows = ledger.filter((r) => r.channel === channel && r.date.getTime() === date.getTime());
  return summarise(rows, [], [], 'day')[0];
}

function weekOf(periods, today) {
  const key = periodOf(today, 'week').key;
  return periods.find((p) => p.key === key) || null;
}

// open handoffs from the Handoffs tab (header first). Newest first.
function openRows(rows) {
  return (rows || []).slice(1)
    .filter((r) => String(r[4] || '').trim().toLowerCase() === 'open')
    .map((r) => ({ raised: String(r[0] || ''), from: String(r[1] || ''), to: String(r[2] || ''), message: String(r[3] || '') }))
    .reverse();
}

const involves = (team) => (h) => h.from.includes(team) || h.to.includes(team);

// { today, ledger, cookBatches, purchases, expense, stock, handoffRows, lowIngredients, lowPacks }
function buildPit({ today, ledger = [], cookBatches = [], purchases = [], expense = [], stock = [], handoffRows = [], lowIngredients = [], lowPacks = [] }) {
  const weeks = summarise(ledger, cookBatches, purchases, 'week', { through: today });
  const wk = weekOf(weeks, today);
  const open = openRows(handoffRows);

  // App sales (Grab)
  const grabLast = lastDateOf(ledger, 'Grab');
  const app = { name: 'App sales', channel: 'Grab', asOf: grabLast ? formatDMY(grabLast) : null, updates: [] };
  if (grabLast) {
    const d = dayOf(ledger, 'Grab', grabLast);
    const stale = daysBetween(today, grabLast) > 2;
    app.headline = `${plural(d.grab.orders, 'order')}, ${baht(d.grab.gross)}`;
    app.when = `${formatDMY(grabLast)}, ${ago(today, grabLast)}`;
    if (wk) app.sub = `Week: ${plural(wk.grab.orders, 'order')}, ${baht(wk.grab.gross)}`;
    app.updates.push(`Latest Grab day ${formatDMY(grabLast)} (${ago(today, grabLast)}): ${plural(d.grab.orders, 'order')}, ${baht(d.grab.gross)} gross, ${baht(d.grab.net)} after fees.`);
    if (stale) app.updates.push('Grab data is behind. Import the latest CSV on the Numbers page.');
    if (wk) app.updates.push(`This week: ${plural(wk.grab.orders, 'order')}, ${baht(wk.grab.gross)} gross.`);
  } else { app.headline = 'No data yet'; app.updates.push('No Grab data imported yet.'); }

  // Direct sales (LINE)
  const lineLast = lastDateOf(ledger, 'LINE');
  const direct = { name: 'Direct sales', channel: 'LINE', asOf: lineLast ? formatDMY(lineLast) : null, updates: [] };
  if (lineLast) {
    const d = dayOf(ledger, 'LINE', lineLast);
    direct.headline = `${plural(d.line.orders, 'order')}, ${baht(d.line.net)}`;
    direct.when = `${formatDMY(lineLast)}, ${ago(today, lineLast)}`;
    if (wk) direct.sub = `Week: ${plural(wk.line.orders, 'order')}, ${baht(wk.line.net)}`;
    direct.updates.push(`Latest LINE day ${formatDMY(lineLast)} (${ago(today, lineLast)}): ${plural(d.line.orders, 'order')}, ${baht(d.line.net)} net.`);
    if (wk) direct.updates.push(`This week: ${plural(wk.line.orders, 'order')}, ${baht(wk.line.net)} net, ${baht(wk.line.delivery)} delivery charged.`);
    const gaps = riderGaps(ledger, today);
    if (gaps.length) direct.updates.push(`${plural(gaps.length, 'LINE order')} still need a rider fee.`);
  } else { direct.headline = 'No data yet'; direct.updates.push('No LINE orders in the Ledger yet.'); }

  // Operations (cooking and stock)
  const batches = [...cookBatches].sort((a, b) => b.date - a.date);
  const latest = batches[0];
  const ops = { name: 'Operations', channel: null, asOf: latest ? formatDMY(latest.date) : null, updates: [] };
  if (latest) {
    const per = latest.portions ? ` (${baht(latest.cost / latest.portions)} a portion)` : '';
    ops.headline = `${latest.dish}, ${plural(latest.portions, 'portion')}`;
    ops.when = `${formatDMY(latest.date)}, ${ago(today, latest.date)}`;
    if (wk) ops.sub = `Week: ${plural(wk.cookBatches, 'batch', 'batches')}, ${plural(wk.cookPortions, 'portion')}`;
    ops.updates.push(`Last batch ${formatDMY(latest.date)} (${ago(today, latest.date)}): ${latest.dish}, ${plural(latest.portions, 'portion')}${per}.`);
    if (wk) ops.updates.push(`This week: ${plural(wk.cookBatches, 'batch', 'batches')}, ${plural(wk.cookPortions, 'portion')}.`);
    const lowYield = batches.filter((b) => daysBetween(today, b.date) <= 7 && b.portions > 0 && b.portions <= 3);
    if (lowYield.length) ops.updates.push(`Low yield this week: ${lowYield.map((b) => `${b.dish} ${b.portions}`).join(', ')}. Check the margin.`);
  } else { ops.headline = 'No data yet'; ops.updates.push('No batches logged yet.'); }
  const left = stock.filter((s) => s.remaining > 0);
  if (left.length) ops.updates.push(`Stock left: ${left.map((s) => `${s.dish} ${s.remaining}${s.oldestAgeDays ? ` (oldest ${s.oldestAgeDays}d)` : ''}`).join(', ')}.`);

  // Purchasing
  const ingredients = purchases.filter((p) => !p.kind && p.date).sort((a, b) => b.date - a.date);
  const lastBuy = ingredients[0];
  const buy = { name: 'Purchasing', channel: null, asOf: lastBuy ? formatDMY(lastBuy.date) : null, updates: [] };
  if (lastBuy) {
    const day = ingredients.filter((p) => p.date.getTime() === lastBuy.date.getTime());
    buy.headline = `${baht(day.reduce((s, p) => s + (p.amount || 0), 0))}, ${plural(day.length, 'item')}`;
    buy.when = `${formatDMY(lastBuy.date)}, ${ago(today, lastBuy.date)}`;
    if (wk) buy.sub = `Week: ${baht(wk.purchases + wk.overheads)} spent`;
    buy.updates.push(`Last receipt ${formatDMY(lastBuy.date)} (${ago(today, lastBuy.date)}): ${plural(day.length, 'item')}, ${baht(day.reduce((s, p) => s + (p.amount || 0), 0))}.`);
    if (wk) buy.updates.push(`This week: ${baht(wk.purchases)} on ingredients, ${baht(wk.overheads)} on overheads.`);
  } else { buy.headline = 'No data yet'; buy.updates.push('No receipts logged yet.'); }
  const moves = priceMoves(expense).filter((m) => daysBetween(today, m.date) <= 14);
  if (moves.length) buy.updates.push(`Price moves: ${moves.map((m) => `${m.name} ${m.change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(m.change) * 100)}%`).join(', ')}.`);
  const low = [...lowPacks, ...lowIngredients];
  if (low.length) buy.updates.push(`Running low: ${low.join(', ')}.`);

  const teams = [app, direct, ops, buy];
  for (const t of teams) t.open = open.filter(involves(t.name));
  return { today: formatDMY(today), teams, openTotal: open.length };
}

module.exports = { buildPit, openRows };
