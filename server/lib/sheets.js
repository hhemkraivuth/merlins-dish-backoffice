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

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

// CLAUDE_LOG_SHEET_ID = the accounting safety file (1LppBqlumD7H112QyJfORiXSxCprH21mjBYarxlaFzvo)
// All new tabs (Expense Log, Recipe Templates, Batch Lots, Batch Lot Ingredients) live here —
// NEVER the live Merlin's numbers file (1uyJUnNE9K6No8Vxe0tsTjN6pFguRqc0BI5yHU4oHAA8).
const CLAUDE_LOG_SHEET_ID = process.env.CLAUDE_LOG_SHEET_ID;

async function appendRows(tabName, rows) {
  const sheets = await getSheetsClient();
  return sheets.spreadsheets.values.append({
    spreadsheetId: CLAUDE_LOG_SHEET_ID,
    range: `${tabName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

async function readTab(tabName) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CLAUDE_LOG_SHEET_ID,
    range: `${tabName}!A:Z`,
  });
  return res.data.values || [];
}

async function updateRow(tabName, rowIndex, values) {
  // rowIndex is 1-based sheet row number (including header)
  const sheets = await getSheetsClient();
  return sheets.spreadsheets.values.update({
    spreadsheetId: CLAUDE_LOG_SHEET_ID,
    range: `${tabName}!A${rowIndex}:Z${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

module.exports = { appendRows, readTab, updateRow, CLAUDE_LOG_SHEET_ID };
