const { google } = require('googleapis');

// Same service account pattern as merlins-dish-bot: sheet-logger@merlins-dish-bot.iam.gserviceaccount.com
// Credentials passed via env var (Railway shared env, same project as the LINE bot)
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
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
