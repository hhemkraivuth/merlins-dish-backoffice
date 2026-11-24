// Stock gaps. Every time a count is typed, the number the system believed is compared with the number Lily counted.
// The difference is a gap. It is written to the "Stock Gaps" tab and stays Open on the Audit desk until she says why.
//
// Only items whose movements the app really follows can have a real gap: packaging that comes off on each cook (last
// changed by Auto), and ingredient lots (receipts in, cooks out). Anything else (drinks, carb boxes, items sold but not
// tracked) is recorded as "Untracked": the count change is kept for history, but it is not called a loss.
//
// Reply to an Audit gap in the LINE group:  gap <item> <reason>
// Reasons: cook (a cook was not logged), bought (a purchase was not logged), wasted, free (given away or sampled),
// miscount (an earlier count was wrong) and lost (unexplained). Lost is the only reason that counts as lost cost.

const { formatDMY, bangkokNow } = require('./dates');

const TAB = 'Stock Gaps';
const HEADERS = ['Logged At', 'Item', 'Unit', 'System Said', 'Counted', 'Gap', 'Unit Price', 'Gap Baht', 'Source', 'Tracked', 'Status', 'Reason', 'Closed At'];
const REASONS = { cook: 'a cook was not logged', bought: 'a purchase was not logged', wasted: 'wasted', free: 'given away or sampled', miscount: 'an earlier count was wrong', lost: 'lost, no explanation' };
const EPS = 1e-6;
const round = (n, d = 2) => { const f = 10 ** d; return Math.round((Number(n) || 0) * f) / f; };
const baht = (n) => `฿${Math.round(n || 0).toLocaleString('en-AU')}`;
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const loose = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9฀-๿]+/g, '');

// before: what the system said. counted: what Lily counted. tracked: the app follows this item's movements.
// Returns the row to store, or null when nothing differs.
function buildGap({ item, unit = '', before, counted, unitPrice = 0, source = 'Stock page', tracked = false, now = bangkokNow() }) {
  if (!item || !Number.isFinite(before) || !Number.isFinite(counted)) return null;
  const gap = round(counted - before, 3);
  if (Math.abs(gap) < EPS) return null;
  const price = Number(unitPrice) || 0;
  return [now, item, unit, round(before, 3), round(counted, 3), gap, price ? round(price, 5) : '', price ? round(gap * price, 2) : '', source, tracked ? 'Yes' : 'No', tracked ? 'Open' : 'Untracked', '', ''];
}

// Rows from the tab (header first) to [{ at, item, unit, before, counted, gap, price, baht, source, tracked, status, reason, rowIndex }]
function gapsFrom(rows) {
  return (rows || []).map((r, i) => ({ r, i })).filter(({ r, i }) => !(i === 0 && /logged/i.test(String(r[0] || ''))) && r[1])
    .map(({ r, i }) => ({ rowIndex: i + 1, at: String(r[0] || ''), item: String(r[1] || '').trim(), unit: String(r[2] || ''), before: num(r[3]), counted: num(r[4]), gap: num(r[5]), price: num(r[6]), baht: num(r[7]), source: String(r[8] || ''), tracked: /^yes$/i.test(String(r[9] || '')), status: String(r[10] || '').trim(), reason: String(r[11] || '').trim() }));
}
const openGaps = (gaps) => gaps.filter((g) => g.status === 'Open');
// Lost cost: money in gaps Lily called lost. A shortfall only (counted less than the system said).
const lostCost = (gaps) => gaps.filter((g) => g.reason === 'lost' && g.gap < 0).reduce((s, g) => s + Math.abs(g.baht), 0);

const qty = (n, unit) => `${Number(round(Math.abs(n), 2))}${unit ? ' ' + unit : ''}`;
function gapLine(g) {
  const more = g.gap > 0;
  return `${g.item}: the system said ${qty(g.before, g.unit)}, you counted ${qty(g.counted, g.unit)}. ${qty(g.gap, g.unit)} ${more ? 'more' : 'less'} than expected${g.baht ? ` (${baht(Math.abs(g.baht))})` : ''}.`;
}
// Audit findings, one per open gap.
function auditFindings(gaps) {
  return openGaps(gaps).map((g) => ({
    id: `stockgap:${g.at}:${loose(g.item)}`, check: 'Stock gap', line: gapLine(g), baht: g.gap < 0 ? Math.abs(g.baht) : 0,
    action: { type: 'gap', at: g.at, item: g.item }, how: 'Pick why. Lost is the only one that counts as lost cost.', fix: '/#stock', fixLabel: 'Open Stock',
  }));
}

// Closes the open gap logged at `at` for `item`. Used by the Audit buttons. Returns the reply text.
async function closeGap(at, item, reason, deps = defaultDeps()) {
  if (!REASONS[reason]) throw new Error('Pick one of: ' + Object.keys(REASONS).join(', ') + '.');
  const g = openGaps(gapsFrom(await deps.readRows())).find((x) => x.at === String(at) && x.item === String(item));
  if (!g) throw new Error('That gap is already closed or no longer there.');
  await deps.closeRow(g.rowIndex, g, reason);
  return `${g.item}: gap of ${qty(g.gap, g.unit)} closed as ${REASONS[reason]}.${reason === 'lost' && g.baht ? ` It counts as ${baht(Math.abs(g.baht))} lost.` : ''}`;
}

// "gap tomato paste lost" closes the newest open gap for that item. "gap" alone lists what is open.
async function processGap(text, deps) {
  const m = String(text || '').trim().match(/^gaps?(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const rest = (m[1] || '').trim();
  const rows = await deps.readRows();
  const open = openGaps(gapsFrom(rows));
  if (!rest || /^(list|open)$/i.test(rest)) {
    if (!open.length) return ['No open stock gaps.'];
    return [`Open stock gaps:\n${open.map((g) => `• ${gapLine(g)}`).join('\n')}\nSay why: gap <item> cook, bought, wasted, free, miscount or lost.`];
  }
  const words = rest.split(/\s+/);
  const last = words.pop().toLowerCase();
  const reason = Object.keys(REASONS).find((k) => k === last || (k === 'bought' && /^(purchase|purchased|buy)$/.test(last)) || (k === 'miscount' && /^(wrong|counted)$/.test(last)));
  if (!reason || !words.length) return [`I need an item and a reason.\nFor example: gap tomato paste lost\nReasons: ${Object.keys(REASONS).join(', ')}.`];
  const key = loose(words.join(' '));
  const hits = open.filter((g) => loose(g.item) === key);
  const loosely = hits.length ? hits : open.filter((g) => loose(g.item).includes(key) || key.includes(loose(g.item)));
  if (!loosely.length) return [`Nothing changed. No open gap for "${words.join(' ')}". Send "gap" to see what is open.`];
  const names = [...new Set(loosely.map((g) => g.item))];
  if (names.length > 1) return [`Nothing changed. "${words.join(' ')}" could be:\n${names.map((n) => `• ${n}`).join('\n')}\nSend the full name.`];
  const g = loosely[loosely.length - 1];
  await deps.closeRow(g.rowIndex, g, reason);
  return [`${g.item}: gap of ${qty(g.gap, g.unit)} closed as ${REASONS[reason]}.${reason === 'lost' && g.baht ? ` It counts as ${baht(Math.abs(g.baht))} lost.` : ''}`];
}

function defaultDeps() {
  const cookLog = require('./cookLog'); const sheets = require('./sheets');
  return {
    ensure: () => cookLog.ensureTab(TAB, HEADERS),
    readRows: async () => { await cookLog.ensureTab(TAB, HEADERS); return sheets.readTab(TAB); },
    append: (row) => sheets.appendRows(TAB, [row]),
    closeRow: async (rowIndex, g, reason) => {
      const rows = await sheets.readTab(TAB); const cur = rows[rowIndex - 1] || [];
      const next = HEADERS.map((_, c) => cur[c] ?? ''); next[10] = 'Closed'; next[11] = reason; next[12] = bangkokNow();
      await sheets.updateRow(TAB, rowIndex, next);
    },
  };
}

// Never throws. A gap that cannot be saved must not block a count.
async function record(entry, deps = defaultDeps()) {
  try {
    const row = buildGap(entry);
    if (!row) return null;
    await deps.ensure(); await deps.append(row);
    return row;
  } catch (err) { console.error('Stock gap not saved:', err.message); return null; }
}

// Count made on the Stock Counts tab. existing: the row before the change. Packaging that comes off on each cook is tracked.
const isTracked = (existing) => Boolean(existing && existing.lastUpdatedBy === 'Auto');

// A drink: before is the last hand count minus the cans sold since (from the Ledger). Runs after the count is saved and never
// blocks it. With an unmatched sale name, or after a receipt, the change is kept as history only.
async function recordDrink(existing, counted, source, deps, io) {
  try {
    const ds = require('./drinkSales');
    const svc = require('./ledgerService'); const sc = require('./stockCounts');
    const [all, d, links] = await Promise.all([io && io.drinks ? io.drinks() : sc.getAllStock(), io && io.ledger ? io.ledger() : svc.loadAll(), io && io.links ? io.links() : ds.loadLinks()]);
    const drinks = all.filter(ds.isDrinkItem);
    const exp = await ds.expectedFor(existing, { ledger: d.ledger || d, drinks, links });
    if (!exp) return record({ item: existing.itemName, unit: existing.unit, before: existing.currentCount, counted, source, tracked: false }, deps);
    return record({ item: existing.itemName, unit: existing.unit, before: exp.before, counted, source: `${source}, ${exp.sold} sold since`, tracked: true }, deps);
  } catch (err) { console.error('Drink gap not saved:', err.message); return null; }
}
const recordStock = (existing, counted, source = 'Stock page', deps, io) => (existing && (existing.category || existing.guess) === 'Drinks' && !(deps && deps.noDrinks)
  ? recordDrink(existing, counted, source, deps, io) : existing
  ? record({ item: existing.itemName, unit: existing.unit, before: existing.currentCount, counted, source, tracked: isTracked(existing) }, deps) : null);
// Count made on ingredient lots. r: { name, before, after, unit }. price: latest unit price in baht per base unit.
const recordLot = (r, source = 'Lots count', deps) => (r ? record({ item: r.name, unit: r.unit, before: r.before, counted: r.after, unitPrice: r.price || 0, source, tracked: true }, deps) : null);

module.exports = { closeGap, TAB, HEADERS, REASONS, buildGap, gapsFrom, openGaps, lostCost, gapLine, auditFindings, processGap, defaultDeps, record, recordStock, recordDrink, recordLot, isTracked };
