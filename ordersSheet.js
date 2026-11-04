// READ-ONLY access to the customer bot's "Bot Activity" sheet (Orders tab).
// The scope is spreadsheets.readonly, so nothing here can ever change the bot's sheet or put ordering at risk.
// Set ORDERS_SHEET_ID in Railway to the Bot Activity sheet's id (the bot's own GOOGLE_SHEET_ID value).

const { google } = require('googleapis');

let client = null;
function getClient() {
  if (client) return client;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY');
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  client = google.sheets({ version: 'v4', auth, retryConfig: require('./sheetsRetry').SHEETS_RETRY });
  return client;
}

async function readOrders() {
  const id = process.env.ORDERS_SHEET_ID;
  if (!id) throw new Error('ORDERS_SHEET_ID is not set in Railway. Use the same value as GOOGLE_SHEET_ID in merlins-dish-bot.');
  const res = await getClient().spreadsheets.values.get({
    spreadsheetId: id,
    range: 'Orders!A:M', // read as displayed, exactly like the bot's own reads of this tab
  });
  return res.data.values || [];
}

module.exports = { readOrders };
