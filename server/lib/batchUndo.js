// Takes a logged batch back out: the Cook Log rows are deleted and the grams it took are returned to the stock lots,
// so the same cook note can be sent again (after fixing a price or a pack size).
//
//   undo noir ragu 6/10
//
// io: { readTab(tab), updateRow(tab, rowIndex, values), deleteRowsWhere(tab, fn) }  (real sheets by default)

const { parseDate, formatDMY, bangkokNow } = require('./dates');
const { tokens } = require('./typedReceipt');

const COOK_LOG = 'Cook Log';
const COOK_LINES = 'Cook Log Lines';
const COOK_SIZES = 'Cook Log Sizes';
const USAGE = 'Lot Usage';
const LOTS = 'Ingredient Lots';

function realIo() {
  const s = require('./sheets');
  return { readTab: s.readTab, updateRow: s.updateRow, deleteRowsWhere: s.deleteRowsWhere };
}

// Returns { status: 'undone' | 'none' | 'many', text }
async function undoBatch(dishWords, date, io = realIo()) {
  const want = tokens(dishWords);
  const rows = await io.readTab(COOK_LOG).catch(() => []);
  const dmy = formatDMY(date);
  const hits = rows.filter((r, i) => i > 0 && formatDMY(parseDate(r[1], date) || date) === dmy && (want.length === 0 || want.every((t) => tokens(r[2]).includes(t))));
  if (!hits.length) return { status: 'none', text: `I can't find a logged batch for "${dishWords || 'any dish'}" on ${dmy}. Nothing was changed.` };
  if (hits.length > 1) {
    return { status: 'many', text: `More than one batch matches (${hits.map((h) => `${h[2]}, ${h[3]} serves`).join('; ')}). Nothing was changed. Add the dish name to be exact.` };
  }
  const key = hits[0][0];
  const dish = hits[0][2];

  // Give the grams back to the lots they came from.
  const usage = (await io.readTab(USAGE).catch(() => [])).filter((r, i) => i > 0 && r[0] === key);
  const back = new Map();
  for (const u of usage) back.set(u[3], (back.get(u[3]) || 0) + Number(u[5] || 0));
  let restored = 0;
  if (back.size) {
    const lots = await io.readTab(LOTS);
    for (let i = 1; i < lots.length; i++) {
      const add = back.get(lots[i][0]);
      if (!add) continue;
      const row = lots[i].slice();
      while (row.length < 12) row.push('');
      row[6] = Math.round((Number(row[6] || 0) + add) * 1000) / 1000;
      row[9] = 'Active';
      row[10] = bangkokNow();
      await io.updateRow(LOTS, i + 1, row);
      restored++;
    }
  }

  const lines = await io.readTab(COOK_LINES).catch(() => []);
  const hadPackaging = lines.some((r, i) => i > 0 && r[0] === key && /packag/i.test(String(r[3] || '')));

  for (const tab of [COOK_LOG, COOK_LINES, COOK_SIZES, USAGE]) {
    try { await io.deleteRowsWhere(tab, (r) => r[0] === key); } catch (err) { /* a tab that never existed has nothing to remove */ }
  }
  const parts = [`Undone: ${dish}, ${dmy}, ${hits[0][3]} serves. It is out of the Cook Log${restored ? ` and ${restored} stock lot${restored === 1 ? ' has' : 's have'} got its quantity back` : ''}.`, 'Send the cook note again to log it.'];
  if (hadPackaging) parts.push('Packaging stock counts were not put back. Send "stock" to check them.');
  return { status: 'undone', text: parts.join('\n') };
}

module.exports = { undoBatch };
