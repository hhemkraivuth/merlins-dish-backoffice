const { google } = require('googleapis');

// Same service account as merlins-dish-bot — but that bot stores credentials as TWO
// separate variables (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY), not one
// combined JSON blob. Matching that shape here so both apps can share the same
// underlying Railway variables via Shared Variable, rather than needing a
// differently-formatted duplicate.
function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Private keys stored as env vars usually have their real newlines escaped as
  // the two characters "\n" — this converts them back to actual line breaks,
  // which the key parser requires. (Matches how the LINE bot must handle this too.)
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!email || !privateKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY environment variables');
  }

  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// One client for the life of the app (until the credentials change), so Google is not asked for a fresh token on every call.
let cachedClient = null;
let cachedClientKey = '';
async function getSheetsClient() {
  const key = `${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}|${process.env.GOOGLE_PRIVATE_KEY}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;
  const auth = getAuth();
  cachedClient = google.sheets({ version: 'v4', auth, retryConfig: require('./sheetsRetry').SHEETS_RETRY });
  cachedClientKey = key;
  return cachedClient;
}

// Short read cache. A page often needs the same tab several times in a few seconds (the Home page asks for the Pit twice),
// so reads inside SHEETS_READ_CACHE_MS (default 15 seconds, 0 turns it off) share one trip to Google, and several callers
// asking at once share a single request. Every write through this file forgets that tab at once, so the app never
// reads back stale rows after its own change. Edits made by hand in the sheet show up within the window.
const READ_TTL_MS = () => { const v = process.env.SHEETS_READ_CACHE_MS; return v === undefined || v === '' ? 15000 : Math.max(0, Number(v) || 0); };
const readCache = new Map(); // tab -> { at, rows }
const inflight = new Map(); // tab -> Promise
const copyRows = (rows) => rows.map((r) => (Array.isArray(r) ? r.slice() : r));
function forgetTab(tabName) { readCache.delete(tabName); inflight.delete(tabName); }
function clearReadCache() { readCache.clear(); inflight.clear(); }

// CLAUDE_LOG_SHEET_ID = the accounting safety file (1LppBqlumD7H112QyJfORiXSxCprH21mjBYarxlaFzvo)
// All new tabs (Expense Log, Recipe Templates, Batch Lots, Batch Lot Ingredients) live here —
// NEVER the live Merlin's numbers file (1uyJUnNE9K6No8Vxe0tsTjN6pFguRqc0BI5yHU4oHAA8).
const CLAUDE_LOG_SHEET_ID = process.env.CLAUDE_LOG_SHEET_ID;

// opts.raw = true stores text exactly as given (used by the Ledger so DD/MM/YYYY dates are never reinterpreted).
async function appendRows(tabName, rows, opts = {}) {
  const sheets = await getSheetsClient();
  try {
    return await sheets.spreadsheets.values.append({
      spreadsheetId: CLAUDE_LOG_SHEET_ID,
      range: `${tabName}!A:Z`,
      valueInputOption: opts.raw ? 'RAW' : 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    });
  } finally { forgetTab(tabName); }
}

// Always asks Google. Used where a change is worked out from row positions, so it must see the sheet exactly as it is.
async function readTabFresh(tabName) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CLAUDE_LOG_SHEET_ID,
    range: `${tabName}!A:Z`,
  });
  return res.data.values || [];
}

async function readTab(tabName) {
  const ttl = READ_TTL_MS();
  if (!ttl) return readTabFresh(tabName);
  const hit = readCache.get(tabName);
  if (hit && Date.now() - hit.at < ttl) return copyRows(hit.rows);
  let pending = inflight.get(tabName);
  if (!pending) {
    pending = readTabFresh(tabName).then((rows) => {
      // A write that landed while we were reading has already forgotten this tab, so only keep the rows if we are still the current read.
      if (inflight.get(tabName) === pending) { readCache.set(tabName, { at: Date.now(), rows }); inflight.delete(tabName); }
      return rows;
    }, (err) => { if (inflight.get(tabName) === pending) inflight.delete(tabName); throw err; });
    inflight.set(tabName, pending);
  }
  return copyRows(await pending);
}

// Replaces the whole contents of a tab (used for the Weekly Report and Monthly Report tabs, which are rebuilt each time).
async function writeTab(tabName, rows) {
  const sheets = await getSheetsClient();
  try {
    await sheets.spreadsheets.values.clear({ spreadsheetId: CLAUDE_LOG_SHEET_ID, range: `${tabName}!A:Z` });
    if (!rows.length) return;
    return await sheets.spreadsheets.values.update({
      spreadsheetId: CLAUDE_LOG_SHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });
  } finally { forgetTab(tabName); }
}

async function updateRow(tabName, rowIndex, values) {
  // rowIndex is 1-based sheet row number (including header)
  const sheets = await getSheetsClient();
  try {
    return await sheets.spreadsheets.values.update({
      spreadsheetId: CLAUDE_LOG_SHEET_ID,
      range: `${tabName}!A${rowIndex}:Z${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
  } finally { forgetTab(tabName); }
}

// Deletes every data row (never the header) of a tab where predicate(row) is true. Returns how many went.
async function deleteRowsWhere(tabName, predicate) {
  const rows = await readTabFresh(tabName);
  const at = [];
  rows.forEach((r, i) => { if (i > 0 && predicate(r)) at.push(i); });
  if (!at.length) return 0;
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CLAUDE_LOG_SHEET_ID, fields: 'sheets.properties(sheetId,title)' });
  const tab = (meta.data.sheets || []).find((x) => x.properties.title === tabName);
  if (!tab) return 0;
  const requests = at.reverse().map((i) => ({ deleteDimension: { range: { sheetId: tab.properties.sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } } }));
  try { await sheets.spreadsheets.batchUpdate({ spreadsheetId: CLAUDE_LOG_SHEET_ID, requestBody: { requests } }); } finally { forgetTab(tabName); }
  return at.length;
}

// Sorts the data rows (never the header) of a tab on the server, so formats are kept. keys: [{ col: 0-based column, asc }]
async function sortTab(tabName, columnCount, keys) {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CLAUDE_LOG_SHEET_ID, fields: 'sheets.properties(sheetId,title)' });
  const tab = (meta.data.sheets || []).find((x) => x.properties.title === tabName);
  if (!tab) return false;
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CLAUDE_LOG_SHEET_ID,
      requestBody: { requests: [{ sortRange: {
        range: { sheetId: tab.properties.sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
        sortSpecs: keys.map((k) => ({ dimensionIndex: k.col, sortOrder: k.asc === false ? 'DESCENDING' : 'ASCENDING' })),
      } }] },
    });
  } finally { forgetTab(tabName); }
  return true;
}

// Writes only the given cells of one row, as typed (RAW), so dates and the other cells are never reinterpreted.
// cells: [{ col: 0-based column, value }]. rowIndex is the 1-based sheet row.
function colLetter(i) { let n = i; let s = ''; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; }
async function updateCells(tabName, rowIndex, cells) {
  const sheets = await getSheetsClient();
  try {
    return await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: CLAUDE_LOG_SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: cells.map((c) => ({ range: `${tabName}!${colLetter(c.col)}${rowIndex}`, values: [[c.value]] })),
      },
    });
  } finally { forgetTab(tabName); }
}

module.exports = { updateCells, sortTab, deleteRowsWhere, appendRows, writeTab, readTab, readTabFresh, clearReadCache, updateRow, getSheetsClient, CLAUDE_LOG_SHEET_ID };
