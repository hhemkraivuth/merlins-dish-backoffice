// Sheets glue for the Ledger, the reports, the Handoffs inbox and the huddle.
// All the logic lives in the pure modules; this file only reads and writes tabs.

const { appendRows, readTab, deleteRowsWhere, writeTab, updateRow, updateCells } = require('./sheets');
const { ensureTab } = require('./cookLog');
const { LEDGER_TAB, LEDGER_HEADERS, COL, num, grabCsvToLedger, lineOrdersToLedger, ledgerObjects, rowInRange, cellsFor } = require('./ledger');
const { overheadsFrom } = require('./overheads');
const { grabAdsFrom } = require('./grabAds');
const { walletPaidFrom } = require('./walletPaid');
const { lowItems, parseLevels } = require('./reorderLevels');
const { LotBook } = require('./ingredientLots');
const { dayDetail, summarise, reportRows, REPORT_HEADERS, sellThrough, priceMoves, riderGaps } = require('./reports');
const { HANDOFF_TAB, HANDOFF_HEADERS, currentHandoffs, reconcile, openHandoffs } = require('./handoffs');
const { buildHuddle, buildPeriodText } = require('./huddle');
const { buildPit } = require('./pit');
const { buildReadyStock } = require('./logViews');
const { buildSpend, buildCooking } = require('./summaries');
const marketingLib = require('./marketing');
const { parseDate, formatDMY, bangkokToday } = require('./dates');

const WEEKLY_TAB = 'Weekly Report';
const MONTHLY_TAB = 'Monthly Report';
const CHUNK = 400;

async function appendChunks(tab, rows, opts) {
  for (let i = 0; i < rows.length; i += CHUNK) await appendRows(tab, rows.slice(i, i + CHUNK), opts);
}

// A tab that does not exist yet counts as empty. Any other failure (no access, no network) stops the run with a clear
// error, because a silent empty read would show as zero sales or zero cost and look like a real result.
async function readOrEmpty(tab) {
  try { return await readTab(tab); } catch (err) {
    if (/unable to parse range|not found/i.test(String(err && err.message))) return [];
    throw new Error(`Could not read the "${tab}" tab: ${err.message}`);
  }
}

// ---- imports ---------------------------------------------------------------------------------
// A Grab CSV is a complete record of its days, so importing replaces any Grab rows already stored for those dates.
// That makes re-importing a corrected CSV safe: nothing doubles up.
async function importGrabCsv(csvText) {
  const { rows, dates, problems } = grabCsvToLedger(csvText);
  if (!rows.length) return { imported: 0, replaced: 0, days: [], problems };
  await ensureTab(LEDGER_TAB, LEDGER_HEADERS);
  const replaced = await deleteRowsWhere(LEDGER_TAB, (r) => String(r[COL.channel]).trim() === 'Grab' && dates.has(formatDMY(parseDate(r[COL.date]) || new Date(0))));
  await appendChunks(LEDGER_TAB, rows, { raw: true });
  const orders = new Set(rows.filter((r) => r[COL.type] === 'Order' && r[COL.orderNo]).map((r) => `${r[COL.date]}|${r[COL.orderNo]}`)).size;
  const flagged = rows.filter((r) => r[COL.flags]).length;
  return { imported: rows.length, replaced, orders, flagged, days: [...dates].sort(), problems };
}

// LINE orders only ever get added, never rewritten. Rows already in the Ledger are skipped by their key.
async function syncLineOrders() {
  const { readOrders } = require('./ordersSheet');
  const { rows, problems } = lineOrdersToLedger(await readOrders());
  await ensureTab(LEDGER_TAB, LEDGER_HEADERS);
  const have = new Set((await readTab(LEDGER_TAB)).filter((r) => String(r[COL.channel]).trim() === 'LINE').map((r) => String(r[COL.key]).trim()));
  const fresh = rows.filter((r) => !have.has(r[COL.key]));
  if (fresh.length) await appendChunks(LEDGER_TAB, fresh, { raw: true });
  return { read: rows.length, added: fresh.length, problems };
}

// Direct orders typed in by hand (the bot was down). Typing the same order again adds nothing.
async function addManualOrders(text) {
  const { parseManualOrders } = require('./manualOrder');
  const { orders, problems } = parseManualOrders(text, bangkokToday());
  await ensureTab(LEDGER_TAB, LEDGER_HEADERS);
  const have = new Set((await readTab(LEDGER_TAB)).filter((r) => String(r[COL.channel]).trim() === 'LINE').map((r) => String(r[COL.key]).trim()));
  const added = []; const skipped = [];
  for (const o of orders) {
    if (o.rows.every((r) => have.has(r[COL.key]))) { skipped.push(o); continue; }
    added.push(o);
  }
  const rows = added.flatMap((o) => o.rows.filter((r) => !have.has(r[COL.key])));
  if (rows.length) await appendChunks(LEDGER_TAB, rows, { raw: true });
  return { added: added.map((o) => ({ date: o.dmy, name: o.name, ref: o.ref, total: o.total })), skipped: skipped.map((o) => ({ date: o.dmy, name: o.name, total: o.total })), problems };
}

// ---- rider fees ------------------------------------------------------------------------------
// LINE orders on one day, so a typed fee can be matched to a real order (the Ledger is synced first, best effort).
async function findLineOrders(dmy) {
  try { await syncLineOrders(); } catch (err) { /* fall back to what the Ledger already holds */ }
  const seen = new Map();
  for (const r of ledgerObjects(await readOrEmpty(LEDGER_TAB))) {
    if (r.channel === 'LINE' && r.type === 'Order' && r.dmy === dmy && r.orderNo.startsWith('#') && !seen.has(r.orderNo)) seen.set(r.orderNo, { orderNo: r.orderNo, customer: r.customer });
  }
  return [...seen.values()];
}

// The delivery cost list for the Index page: every LINE order of the last three weeks with what the customer paid for
// delivery (free delivery shows 0) and what the rider was paid. Read only.
async function riderOrders({ sync = false } = {}) {
  if (sync) { try { await syncLineOrders(); } catch (err) { /* show what the Ledger already holds */ } }
  const { riderView } = require('./riderFees');
  return riderView(ledgerObjects(await readOrEmpty(LEDGER_TAB)), bangkokToday(), 21);
}

// Saves a rider fee typed on the web. Same Rider rows as the "rider 001 55" LINE command, but any order number works.
async function saveRiderFee({ dmy, orderNos, fee }) {
  const { buildRiderRows } = require('./riderFees');
  let orders = await findLineOrders(dmy); // syncs the newest LINE orders first
  const built = buildRiderRows({ dmy, orderNos, fee }, orders);
  const { replaced } = await saveRider(built.rows, built.keys);
  const money = (n) => `฿${Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 })}`;
  const lines = built.nos.map((n, i) => `${n}: ${money(built.shares[i])}`);
  return { ok: true, message: `Rider fee logged for ${dmy}${replaced ? ` (replaced ${replaced})` : ''}:\n${lines.join('\n')}` };
}

// Sending a fee again for the same order replaces the earlier one.
async function saveRider(rows, keys) {
  await ensureTab(LEDGER_TAB, LEDGER_HEADERS);
  const k = new Set(keys);
  const replaced = await deleteRowsWhere(LEDGER_TAB, (r) => k.has(String(r[COL.key]).trim()));
  await appendRows(LEDGER_TAB, rows, { raw: true });
  return { replaced };
}

// ---- delete and edit rows ----------------------------------------------------------------------
// Delete every Ledger row in a date range, for one channel (Grab, LINE) or all. dryRun only counts.
async function deleteLedgerRange({ from, to, channel = 'All', dryRun = false }) {
  const rows = await readOrEmpty(LEDGER_TAB);
  const count = rows.slice(1).filter((r) => rowInRange(r, from, to, channel)).length;
  if (dryRun || !count) return { count, deleted: 0 };
  const deleted = await deleteRowsWhere(LEDGER_TAB, (r) => rowInRange(r, from, to, channel));
  return { count, deleted };
}

// Other tabs can be cleared by date too: the Expense Log and the Overheads tab both keep the date in column A.
// Stock lots are not touched, so this only takes the rows out of the numbers.
const DATE_TABS = { expense: 'Expense Log', overheads: 'Overheads' };
async function deleteTabRange({ target, from, to, dryRun = false }) {
  const tab = DATE_TABS[target];
  if (!tab) throw new Error('Choose Ledger, Expense Log or Overheads.');
  const inRange = (r) => { const d = parseDate(r[0]); return !!d && d.getTime() >= from.getTime() && d.getTime() <= to.getTime(); };
  const rows = await readOrEmpty(tab);
  const count = rows.slice(1).filter(inRange).length;
  if (dryRun || !count) return { count, deleted: 0 };
  const deleted = await deleteRowsWhere(tab, inRange);
  return { count, deleted };
}

async function deleteLedgerRow(key) {
  const k = String(key || '').trim();
  if (!k) throw new Error('No row key was sent.');
  const deleted = await deleteRowsWhere(LEDGER_TAB, (r) => String(r[COL.key] || '').trim() === k);
  return { deleted };
}

async function updateLedgerRow(key, changes) {
  const k = String(key || '').trim();
  if (!k) throw new Error('No row key was sent.');
  const cells = cellsFor(changes);
  if (cells.error) throw new Error(cells.error);
  const rows = await readOrEmpty(LEDGER_TAB);
  const at = rows.findIndex((r, i) => i > 0 && String(r[COL.key] || '').trim() === k);
  if (at < 0) throw new Error('That row is no longer in the Ledger. Reload the page.');
  await updateCells(LEDGER_TAB, at + 1, cells.cells);
  return { updated: cells.cells.length };
}

// ---- loading the other teams' data -------------------------------------------------------------
function cookBatchesFrom(logRows, sizeRows) {
  const sizes = new Map();
  for (const r of (sizeRows || []).slice(1)) sizes.set(r[0], (sizes.get(r[0]) || 0) + (num(r[5]) || 0));
  const out = [];
  for (const r of (logRows || []).slice(1)) {
    const date = parseDate(r[1]);
    if (!date || !r[0]) continue;
    out.push({ key: String(r[0]), date, dish: String(r[2] || '').trim(), portions: sizes.get(r[0]) || num(r[3]) || 0, cost: num(r[7]) || 0 });
  }
  return out;
}
function purchasesFrom(rows) {
  return (rows || []).slice(1).map((r) => ({ date: parseDate(r[0]), name: String(r[1] || '').trim(), amount: num(r[2]), unitCost: num(r[4]) })).filter((x) => x.date);
}

async function loadAll() {
  const [ledgerRows, cookLog, cookSizes, expense, handoffs, overheadRows, stockCounts, lotRows, levelRows, grabAdRows, walletRows, wasteRows] = await Promise.all([
    readOrEmpty(LEDGER_TAB), readOrEmpty('Cook Log'), readOrEmpty('Cook Log Sizes'), readOrEmpty('Expense Log'), readOrEmpty(HANDOFF_TAB), readOrEmpty('Overheads'), readOrEmpty('Stock Counts'), readOrEmpty('Ingredient Lots'), readOrEmpty('Reorder Levels'), readOrEmpty('Grab Ads'), readOrEmpty('Wallet Paid'), readOrEmpty('Waste Log'),
  ]);
  const purchases = purchasesFrom(expense);
  const lotBook = new LotBook(lotRows, [], bangkokToday());
  return {
    lotBook,
    ledger: ledgerObjects(ledgerRows),
    cookBatches: cookBatchesFrom(cookLog, cookSizes),
    waste: require('./wasteLog').wasteFrom(wasteRows),
    purchases: [...purchases.map((p) => ({ date: p.date, name: p.name, amount: p.amount || 0 })), ...overheadsFrom(overheadRows), ...grabAdsFrom(grabAdRows), ...walletPaidFrom(walletRows)],
    expense: purchases.map((p) => ({ date: p.date, name: p.name, unitCost: p.unitCost })),
    handoffRows: handoffs,
    lowIngredients: lowItems(lotBook, parseLevels(levelRows)).map((x) => `${x.name}: ${Math.round(x.left)}${x.unit} left`),
    lowPacks: (stockCounts || []).slice(1).filter((r) => String(r[1] || '').toLowerCase() === 'pack' && Number(r[2]) <= 1).map((r) => `${r[0]}: ${Number(r[2])}`),
  };
}

// ---- reports, handoffs, huddle ----------------------------------------------------------------
async function computeReports(data) {
  const d = data || await loadAll();
  return {
    daily: summarise(d.ledger, d.cookBatches, d.purchases, 'day', { through: bangkokToday() }),
    weekly: summarise(d.ledger, d.cookBatches, d.purchases, 'week', { through: bangkokToday() }),
    monthly: summarise(d.ledger, d.cookBatches, d.purchases, 'month', { through: bangkokToday() }),
  };
}

async function dayDetailFor(date, toDate = null) {
  const d = await loadAll();
  return dayDetail(d.ledger, d.cookBatches, d.purchases, date, toDate);
}

async function refreshReports() {
  const data = await loadAll();
  const { weekly, monthly } = await computeReports(data);
  await ensureTab(WEEKLY_TAB, REPORT_HEADERS);
  await ensureTab(MONTHLY_TAB, REPORT_HEADERS);
  await writeTab(WEEKLY_TAB, [REPORT_HEADERS, ...reportRows(weekly)]);
  await writeTab(MONTHLY_TAB, [REPORT_HEADERS, ...reportRows(monthly)]);
  return { weeks: weekly.length, months: monthly.length, ledgerRows: data.ledger.length };
}

async function refreshHandoffs(data, today = bangkokToday()) {
  const d = data || await loadAll();
  const countRows = await readOrEmpty('Ready Counts');
  const stock = require('./logViews').applyCounts(sellThrough(d.ledger, d.cookBatches, today, d.waste), { today, ledger: d.ledger, cookBatches: d.cookBatches, countRows });
  const current = currentHandoffs({ stock, moves: priceMoves(d.expense), today, gaps: riderGaps(d.ledger, today) });
  await ensureTab(HANDOFF_TAB, HANDOFF_HEADERS);
  const existing = d.handoffRows.length ? d.handoffRows : [HANDOFF_HEADERS];
  const { add, update } = reconcile(existing, current, today);
  if (add.length) await appendRows(HANDOFF_TAB, add, { raw: true });
  for (const u of update) await updateRow(HANDOFF_TAB, u.rowIndex, u.row);
  return { raised: add.length, cleared: update.length, stock };
}

// One pass: refresh reports and handoffs, return the huddle text.
async function huddle({ sync = true } = {}) {
  const today = bangkokToday();
  const notes = [];
  if (sync) {
    try { const s = await syncLineOrders(); notes.push(`LINE sync: ${s.added} new rows`); } catch (err) { notes.push(`LINE sync failed (${err.message})`); }
  }
  const data = await loadAll();
  await refreshReports().catch((err) => notes.push(`Report tabs not updated (${err.message})`));
  const h = await refreshHandoffs(data, today);
  const after = await readOrEmpty(HANDOFF_TAB);
  const text = buildHuddle({ today, ledger: data.ledger, cookBatches: data.cookBatches, purchases: data.purchases, lowPacks: [...data.lowPacks, ...data.lowIngredients], stock: h.stock, open: openHandoffs(after) });
  return { text: notes.length ? `${text}\n\n${notes.join('. ')}.` : text, notes };
}

// The home page: one card per team. Read only, it never writes a tab.
async function pit() {
  const today = bangkokToday();
  const d = await loadAll();
  const estimated = sellThrough(d.ledger, d.cookBatches, today, d.waste);
  // A count Lily typed beats the cooked minus sold estimate, for the dishes she counted.
  const countRows = await readOrEmpty('Ready Counts');
  const counted = new Map(buildReadyStock({ today, ledger: d.ledger, cookBatches: d.cookBatches, countRows }).items.filter((i) => i.basis === 'counted').map((i) => [i.dish.toLowerCase(), i]));
  const stock = estimated.map((e) => { const c = counted.get(String(e.dish).toLowerCase()); return c ? { ...e, remaining: c.left, oldestAgeDays: c.ageDays } : e; });
  counted.forEach((c, key) => { if (!estimated.some((e) => String(e.dish).toLowerCase() === key)) stock.push({ dish: c.dish, remaining: c.left, oldestAgeDays: c.ageDays, live: [] }); });
  const noteRows = await readOrEmpty(marketingLib.TAB);
  return buildPit({ noteRows, today, ledger: d.ledger, cookBatches: d.cookBatches, purchases: d.purchases, expense: d.expense, stock, handoffRows: d.handoffRows, lowIngredients: d.lowIngredients, lowPacks: d.lowPacks });
}

// The order bot's public menu feed (read only), for Merlin's own price range. Never blocks the page if the bot is slow or away.
async function botMenu() {
  try {
    const base = require('./botStock').botUrl();
    if (!base) return null;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(`${base}/api/menu`, { headers: { Accept: 'application/json' }, signal: ctl.signal });
    clearTimeout(t);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function marketing() {
  const today = bangkokToday();
  const d = await loadAll();
  const noteRows = await readOrEmpty(marketingLib.TAB);
  return marketingLib.buildMarketing({ today, ledger: d.ledger, noteRows, menu: await botMenu() });
}
async function addMarketingNote({ kind, title, note, status }) {
  if (!marketingLib.KINDS.includes(kind)) throw Object.assign(new Error(`Kind must be one of ${marketingLib.KINDS.join(', ')}.`), { status: 400 });
  if (!String(title || '').trim()) throw Object.assign(new Error('Add a short title.'), { status: 400 });
  await ensureTab(marketingLib.TAB, marketingLib.HEADERS);
  await appendRows(marketingLib.TAB, [[formatDMY(bangkokToday()), kind, String(title).trim(), String(note || '').trim(), String(status || (kind === 'Ad draft' ? 'Draft' : '')).trim()]]);
}

// A note from one marketing desk to another, shown as team chatter on the home page. Key is left empty on purpose.
const CHATTER_TEAMS = ['Marketing', 'Strategy', 'Creative', 'Paid Media', 'Lily'];
async function addHandoff({ from, to, message }) {
  if (!CHATTER_TEAMS.includes(from) || !CHATTER_TEAMS.includes(to)) throw Object.assign(new Error(`From and To must be one of ${CHATTER_TEAMS.join(', ')}.`), { status: 400 });
  const text = String(message || '').trim();
  if (!text) throw Object.assign(new Error('Add a short message.'), { status: 400 });
  await ensureTab(HANDOFF_TAB, HANDOFF_HEADERS);
  await appendRows(HANDOFF_TAB, [[formatDMY(bangkokToday()), from, to, text, 'Open', '', '']], { raw: true });
}

// Summaries above the Weekly Receipts and Batch Cook boxes. Read only, each reads just the tabs it needs.
async function spendSummary() {
  const [expenseRows, overheadRows] = await Promise.all([readOrEmpty('Expense Log'), readOrEmpty('Overheads')]);
  return buildSpend({ today: bangkokToday(), expenseRows, overheadRows });
}
async function cookingSummary() {
  const [cookRows, sizeRows] = await Promise.all([readOrEmpty('Cook Log'), readOrEmpty('Cook Log Sizes')]);
  return buildCooking({ today: bangkokToday(), batches: cookBatchesFrom(cookRows, sizeRows) });
}

async function periodText(type) {
  const { weekly, monthly } = await computeReports();
  return buildPeriodText(type === 'month' ? monthly : weekly, type, bangkokToday());
}

module.exports = { cookBatchesFrom, readOrEmpty, marketing, addMarketingNote, addHandoff, addManualOrders, deleteLedgerRange, deleteTabRange, deleteLedgerRow, updateLedgerRow, dayDetailFor, findLineOrders, saveRider, riderOrders, saveRiderFee, importGrabCsv, syncLineOrders, loadAll, computeReports, refreshReports, refreshHandoffs, huddle, pit, spendSummary, cookingSummary, periodText, cookBatchesFrom, purchasesFrom };
