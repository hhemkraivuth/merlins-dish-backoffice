// Writes costed batches to the Claude Log (never the live sheet).
//
//   Cook Log        one row per batch
//   Cook Log Lines  one row per ingredient / packaging / utility line (audit trail)
//   Shorthand       Lily's editable keyword table (created with the defaults on first use)

const crypto = require('crypto');
const { appendRows, readTab, getSheetsClient, CLAUDE_LOG_SHEET_ID } = require('./sheets');
const { formatDMY } = require('./dates');
const { seedRows } = require('./aliases');

const COOK_LOG = 'Cook Log';
const COOK_LINES = 'Cook Log Lines';
const COOK_SIZES = 'Cook Log Sizes';
const SHORTHAND = 'Shorthand';

const COOK_LOG_HEADERS = ['Batch Key', 'Date Cooked', 'Dish', 'Yield', 'Ingredient Cost', 'Packaging Cost', 'Utility Cost', 'Total Batch Cost', 'Cost per Portion', 'Flags', 'Logged At', 'Source'];
const COOK_LINES_HEADERS = ['Batch Key', 'Date Cooked', 'Dish', 'Type', 'Line', 'Qty', 'Unit', 'Unit Cost', 'Price Date', 'Price Source', 'Line Cost', 'Qty From'];

const COOK_SIZES_HEADERS = ['Batch Key', 'Date Cooked', 'Dish', 'Size', 'Portion Weight (g)', 'Count Packed', 'Cost per Portion', 'Total Cooked Weight (g)', 'Cost per Gram'];

const ensured = new Set();
async function ensureTab(name, headers, seed = []) {
  if (ensured.has(name)) return;
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CLAUDE_LOG_SHEET_ID, fields: 'sheets.properties.title' });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === name);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CLAUDE_LOG_SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: name } } }] },
    });
    await appendRows(name, [headers, ...seed]);
  }
  ensured.add(name);
}

function batchKey(dishTab, date, yieldN, noteLines) {
  const sig = noteLines.map((l) => `${l.token.toLowerCase()}=${l.qty}`).sort().join(',');
  const h = crypto.createHash('sha1').update(`${dishTab}|${formatDMY(date)}|${yieldN}|${sig}`).digest('hex').slice(0, 10);
  return `${dishTab.replace(/[^A-Za-z0-9]+/g, '')}-${formatDMY(date).split('/').reverse().join('')}-${h}`;
}

async function isLogged(key) {
  await ensureTab(COOK_LOG, COOK_LOG_HEADERS);
  const rows = await readTab(COOK_LOG);
  return rows.some((r) => r[0] === key);
}

async function writeBatch(result, key, source = 'LINE') {
  await ensureTab(COOK_LOG, COOK_LOG_HEADERS);
  await ensureTab(COOK_LINES, COOK_LINES_HEADERS);
  const d = formatDMY(result.date);
  await appendRows(COOK_LOG, [[
    key, d, result.dish, result.yield, result.ingredientCost, result.packagingCost, result.utilityCost,
    result.total, result.perPortion, result.flags.join(' | '), new Date().toISOString(), source,
  ]]);
  await appendRows(COOK_LINES, result.lines.map((l) => [
    key, d, result.dish, l.type, l.name, l.qty, l.unit, Number(l.unitCost.toFixed(5)), l.priceDate, l.priceSource, Number(l.lineCost.toFixed(2)), l.qtySource,
  ]));
  if (result.sizes && result.sizes.length) {
    await ensureTab(COOK_SIZES, COOK_SIZES_HEADERS);
    await appendRows(COOK_SIZES, result.sizes.map((z) => [
      key, d, result.dish, z.name, z.weight, z.count, z.costPerPortion, result.cookedWeight, result.costPerGram,
    ]));
  }
}

async function readShorthandRows() {
  await ensureTab(SHORTHAND, ['Type', 'Short', 'Full name'], seedRows());
  return readTab(SHORTHAND);
}

module.exports = { writeBatch, isLogged, batchKey, readShorthandRows, ensureTab, COOK_LOG, COOK_LINES, COOK_SIZES, SHORTHAND };
