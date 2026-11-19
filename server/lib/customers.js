// The CRM (Customers tab of the order app's Bot Activity sheet).
//   Reading: read only, used by the Customers page.
//   Writing: ONLY for orders typed in by hand on the Numbers page. It follows the order app's own rules (one running
//   order count per phone number, same columns found by header text) and never touches the order web or its code.
//   Failures here never stop the order itself from being saved.

const { google } = require('googleapis');
const { readCustomers } = require('./ordersSheet');

const TIER_LOW = 5;
const TIER_HIGH = 10;

// Same rules as the order app: digits only, one leading 0, Thai country code stripped.
function normalisePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('66') && digits.length === 11) digits = '0' + digits.slice(2);
  if (!digits.startsWith('0')) digits = '0' + digits;
  if (digits.length < 9 || digits.length > 10) return null;
  return digits;
}

const HEADERS = {
  phone: ['phone', 'phone number', 'mobile'],
  name: ['customer name', 'name'],
  count: ['order count', 'orders'],
  date: ['last order date'],
  lineId: ['line user id', 'line id', 'line userid'],
  lat: ['last lat'],
  lng: ['last lng'],
  address: ['last address'],
  note: ['last rider note'],
};
const FALLBACK = { phone: 0, name: 1, count: 2, date: 3, lineId: 4 };

function layoutOf(headerRow) {
  const h = (headerRow || []).map((x) => String(x || '').trim().toLowerCase());
  const L = {};
  for (const [key, names] of Object.entries(HEADERS)) {
    const i = h.findIndex((x) => names.includes(x));
    L[key] = i !== -1 ? i : (key in FALLBACK ? FALLBACK[key] : -1);
  }
  L.width = Math.max(h.length, ...Object.values(L).map((i) => i + 1));
  return L;
}

const colLetter = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const cell = (row, i) => (i >= 0 && row[i] !== undefined && row[i] !== null ? String(row[i]).trim() : '');

function dmyToTime(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || '').trim());
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null;
}

function tierInfo(count) {
  const n = Number(count) || 0;
  const status = n >= TIER_HIGH ? 'Free meal ready (10)' : n >= TIER_LOW ? 'Bacon Steak ready (5)' : `${TIER_LOW - n} to Bacon Steak`;
  return { canLow: n >= TIER_LOW && n < TIER_HIGH, canHigh: n >= TIER_HIGH, status };
}

// rows = the whole tab including the header row. today = a UTC date at midnight (ms).
function buildCustomerList(values, todayMs) {
  const L = layoutOf(values[0]);
  const list = [];
  for (const row of values.slice(1)) {
    const phone = normalisePhone(cell(row, L.phone));
    const name = cell(row, L.name);
    if (!phone && !name) continue;
    const orders = Number(cell(row, L.count)) || 0;
    const last = cell(row, L.date);
    const t = dmyToTime(last);
    list.push({
      phone: phone || cell(row, L.phone), name, orders, lastOrder: last,
      daysSince: t === null || todayMs === undefined ? null : Math.max(0, Math.round((todayMs - t) / 86400000)),
      address: cell(row, L.address), note: cell(row, L.note), hasLine: !!cell(row, L.lineId),
      ...tierInfo(orders),
    });
  }
  return list;
}

function summarise(list) {
  const n = list.length;
  const repeat = list.filter((c) => c.orders >= 2).length;
  return {
    customers: n,
    repeat,
    repeatPct: n ? Math.round((repeat / n) * 100) : 0,
    rewardReady: list.filter((c) => c.canLow || c.canHigh).length,
    nearReward: list.filter((c) => c.orders === TIER_LOW - 1 || c.orders === TIER_HIGH - 1).length,
    lapsed: list.filter((c) => c.daysSince !== null && c.daysSince > 30 && c.orders >= 2).length,
    onLine: list.filter((c) => c.hasLine).length,
    withAddress: list.filter((c) => c.address).length,
  };
}

async function loadCustomers(todayMs) {
  const list = buildCustomerList(await readCustomers(), todayMs);
  return { list, summary: summarise(list) };
}

// ---- writing (hand typed orders only) ---------------------------------------------------------
let writeClient = null;
function getWriteClient() {
  if (writeClient) return writeClient;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY');
  const auth = new google.auth.GoogleAuth({ credentials: { client_email: email, private_key: key }, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  writeClient = google.sheets({ version: 'v4', auth });
  return writeClient;
}

// What to write for one hand typed order. Pure, so it can be tested without Google.
// values = whole tab. Returns { action: 'append'|'update'|'skip', ... }.
function planCustomerWrite(values, { phone: rawPhone, name, address, dmy }) {
  const phone = normalisePhone(rawPhone);
  if (!phone) return { action: 'skip', why: rawPhone ? `phone "${rawPhone}" is not a valid number` : 'no phone number typed' };
  const L = layoutOf(values[0]);
  const idx = values.slice(1).findIndex((r) => normalisePhone(cell(r, L.phone)) === phone);
  const orderTime = dmyToTime(dmy);
  if (idx === -1) {
    const row = new Array(L.width).fill('');
    row[L.phone] = "'" + phone;
    row[L.name] = name || '';
    row[L.count] = 1;
    row[L.date] = dmy;
    if (L.address >= 0) row[L.address] = address || '';
    return { action: 'append', phone, row, count: 1 };
  }
  const row = values[idx + 1];
  const prior = Number(cell(row, L.count)) || 0;
  const count = prior + 1;
  const sheetRow = idx + 2;
  const cells = [];
  const put = (key, v) => { if (L[key] >= 0) cells.push({ range: `Customers!${colLetter(L[key])}${sheetRow}`, values: [[v]] }); };
  if (name) put('name', name);
  put('count', count);
  const lastT = dmyToTime(cell(row, L.date));
  if (lastT === null || (orderTime !== null && orderTime >= lastT)) put('date', dmy);
  if (address && address !== cell(row, L.address)) {
    put('address', address);
    put('lat', ''); put('lng', ''); // the old map pin no longer matches the new address
  }
  return { action: 'update', phone, cells, count, prior };
}

// Saves one order's customer details. Never throws: the order is already in the books.
async function recordManualCustomer(info) {
  try {
    const id = process.env.ORDERS_SHEET_ID;
    if (!id) return { saved: false, why: 'ORDERS_SHEET_ID is not set' };
    const values = await readCustomers();
    const plan = planCustomerWrite(values, info);
    if (plan.action === 'skip') return { saved: false, why: plan.why };
    const client = getWriteClient();
    if (plan.action === 'append') {
      await client.spreadsheets.values.append({ spreadsheetId: id, range: 'Customers!A:A', valueInputOption: 'USER_ENTERED', requestBody: { values: [plan.row] } });
    } else {
      await client.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'USER_ENTERED', data: plan.cells } });
    }
    return { saved: true, phone: plan.phone, count: plan.count, isNew: plan.action === 'append' };
  } catch (err) {
    return { saved: false, why: String((err && err.message) || err) };
  }
}

module.exports = { normalisePhone, layoutOf, buildCustomerList, summarise, loadCustomers, planCustomerWrite, recordManualCustomer, tierInfo, TIER_LOW, TIER_HIGH };
