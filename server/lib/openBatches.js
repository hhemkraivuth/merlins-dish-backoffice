// Two step batch logging.
//   Step 1  When the batch is cooked: date, dish and the ingredients used. Saved as an OPEN batch (tab "Open Batches"), no yield yet.
//   Step 2  After the portions are packed for the freezer: "bolo yield 21" (or "ragu 7/10 yield 21", "dbs 7r 4l portions").
//           The open batch is costed with the yield and logged to the Cook Log exactly like a normal batch, then removed from Open Batches.
// The Cook Log is the record. An open batch costs nothing and takes nothing off stock until it is completed.
//
// io: { ensure(), readTab(tab), appendRows(tab, rows, opts), deleteRowsWhere(tab, fn) }  (real sheets by default)

const { parseDate, formatDMY, bangkokNow } = require('./dates');

const TAB = 'Open Batches';
const HEADERS = ['Open Key', 'Date Cooked', 'Dish', 'Cook Note (JSON)', 'Source', 'Logged At'];

function realIo() {
  const s = require('./sheets'); const c = require('./cookLog');
  return { ensure: () => c.ensureTab(TAB, HEADERS), readTab: s.readTab, appendRows: s.appendRows, deleteRowsWhere: s.deleteRowsWhere };
}

const compact = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '');
const sigOf = (payload) => JSON.stringify({ l: (payload.lines || []).map((x) => `${String(x.token).toLowerCase()}=${x.qty}${x.unit || ''}`).sort(), p: payload.packagingQty || {}, s: (payload.sizes || []).map((z) => `${z.name}${z.count}${z.weight}`) });

// Rows as { key, rowIndex, date, dishTab, payload, source, loggedAt }. A row that cannot be read is skipped, never fatal.
async function listOpen(io = realIo()) {
  await io.ensure();
  const rows = await io.readTab(TAB).catch(() => []);
  const out = [];
  rows.forEach((r, i) => {
    if (i === 0 || !r[0]) return;
    try {
      const payload = JSON.parse(r[3]);
      const date = parseDate(payload.date);
      if (!date) return;
      out.push({ key: String(r[0]), rowIndex: i + 1, date, dishTab: String(r[2] || '').trim(), payload, source: String(r[4] || ''), loggedAt: String(r[5] || '') });
    } catch (err) { /* skip */ }
  });
  return out.sort((a, b) => a.date - b.date || a.loggedAt.localeCompare(b.loggedAt));
}

// batch: the parsed cook note { dishTab, date, lines, packagingQty?, sizes?, cookedWeight? }. The same batch sent twice is saved once.
async function parkBatch(batch, { source = 'LINE' } = {}, io = realIo()) {
  const payload = {
    date: formatDMY(batch.date), dishTab: batch.dishTab,
    lines: (batch.lines || []).map((l) => ({ token: l.token, qty: l.qty, unit: l.unit || '' })),
    packagingQty: batch.packagingQty || null, sizes: batch.sizes || [], cookedWeight: batch.cookedWeight || null,
  };
  const open = await listOpen(io);
  const same = open.filter((o) => o.dishTab === batch.dishTab && formatDMY(o.date) === payload.date);
  if (same.some((o) => sigOf(o.payload) === sigOf(payload))) return { status: 'same', key: same.find((o) => sigOf(o.payload) === sigOf(payload)).key };
  const key = `OPEN-${compact(batch.dishTab)}-${formatDMY(batch.date).split('/').reverse().join('')}-${same.length + 1}-${Date.now().toString(36).slice(-4)}`;
  await io.appendRows(TAB, [[key, payload.date, batch.dishTab, JSON.stringify(payload), source, bangkokNow()]], { raw: true });
  return { status: 'saved', key, sameDay: same.length };
}

// Open batches for a dish. With a date, only that day. Newest first.
async function findOpen(dishTab, date, io = realIo()) {
  const all = (await listOpen(io)).filter((o) => o.dishTab === dishTab);
  const hit = date ? all.filter((o) => formatDMY(o.date) === formatDMY(date)) : all;
  return { matches: hit.slice().reverse(), others: all.filter((o) => !hit.includes(o)) };
}

const removeOpen = async (key, io = realIo()) => io.deleteRowsWhere(TAB, (r) => r[0] === key);

// Turns a stored open batch back into a batch object for runBatch.
function toBatch(open, extra = {}) {
  const p = open.payload;
  return { dishTab: open.dishTab, dishWord: open.dishTab, date: open.date, yield: null, lines: p.lines || [], packagingQty: p.packagingQty || undefined, sizes: p.sizes || [], sizeCounts: [], cookedWeight: p.cookedWeight || null, ...extra };
}

const describe = (o) => `${o.dishTab}, cooked ${formatDMY(o.date)}${o.payload.lines && o.payload.lines.length ? ` (${o.payload.lines.slice(0, 3).map((l) => `${l.token} ${l.qty}${l.unit || ''}`).join(', ')}${o.payload.lines.length > 3 ? ', ...' : ''})` : ' (recipe quantities)'}`;

// "open" lists what is waiting for portions. "drop bolo 7/10" throws one away. deps: { openBatches: io-like or null, loadShorthand() }
async function processOpenCommand(text, deps) {
  const t = String(text || '').trim();
  if (!deps || !deps.listOpen) return null;
  if (/^(open|waiting|pending)(\s+batches)?$/i.test(t)) {
    const open = await deps.listOpen();
    if (!open.length) return ['No batches are waiting for portions.'];
    return [`Waiting for portions (${open.length}):\n${open.map((o) => `• ${describe(o)}`).join('\n')}\nWhen packed, send for example: bolo yield 21`];
  }
  const m = t.match(/^drop\s+(.+?)(?:\s+(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?))?$/i);
  if (m && deps.loadShorthand && deps.removeOpen) {
    const sh = await deps.loadShorthand();
    const tab = sh.dishes.get(m[1].toLowerCase().replace(/\s+/g, ''));
    if (!tab) return null;
    const date = m[2] ? parseDate(m[2]) : null;
    const { matches } = await deps.findOpen(tab, date);
    if (!matches.length) return [`No open ${tab} batch${m[2] ? ` on ${m[2]}` : ''}. Nothing was changed.`];
    if (matches.length > 1 && !date) return [`More than one open ${tab} batch (${matches.map((o) => formatDMY(o.date)).join(', ')}). Add the date, for example: drop ${m[1]} ${formatDMY(matches[0].date).slice(0, 5)}`];
    await deps.removeOpen(matches[0].key);
    return [`Dropped: ${describe(matches[0])}. Nothing was logged.`];
  }
  return null;
}

// What the cook deps hold: the same functions, on the real sheets.
const api = () => ({ find: findOpen, park: parkBatch, remove: removeOpen, list: listOpen, toBatch });

module.exports = { api, listOpen, parkBatch, findOpen, removeOpen, toBatch, describe, processOpenCommand, TAB, HEADERS };
