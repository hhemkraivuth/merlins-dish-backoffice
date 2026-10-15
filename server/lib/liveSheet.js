// READ-ONLY access to the live Merlin's numbers sheet.
//
// The Google auth here requests the spreadsheets.readonly scope, so even a coding mistake
// cannot edit the living bible. Share the sheet with the service account as Viewer.

const { google } = require('googleapis');

const LIVE_SHEET_ID = process.env.LIVE_SHEET_ID || '1uyJUnNE9K6No8Vxe0tsTjN6pFguRqc0BI5yHU4oHAA8';

let client = null;
function getReadOnlyClient() {
  if (client) return client;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY');
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  client = google.sheets({ version: 'v4', auth });
  return client;
}

// UNFORMATTED_VALUE gives full-precision numbers (0.01708, not "0.017") and dates as serials.
async function readLiveRange(tabName, a1 = 'A:Z') {
  const sheets = getReadOnlyClient();
  const quoted = `'${String(tabName).replace(/'/g, "''")}'`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: LIVE_SHEET_ID,
    range: `${quoted}!${a1}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  return res.data.values || [];
}

module.exports = { readLiveRange, LIVE_SHEET_ID };
