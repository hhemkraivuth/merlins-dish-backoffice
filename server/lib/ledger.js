// The Ledger: one tab in the Claude Log that every sales channel writes into, in one shape.
//
//   Grab rows   come from the nightly Grab CSV (the 12 column Claude Log format).
//   LINE rows   come from the customer bot's Orders tab (read only), one row per item.
//
// Everything here is pure, so it can be tested without Google. The I/O lives in ledgerService.js.

const crypto = require('crypto');
const { parseCsv } = require('./csv');
const { parseDate, formatDMY } = require('./dates');

const LEDGER_TAB = 'Ledger';
const LEDGER_HEADERS = ['Date', 'Description', 'Channel', 'Order from', 'Type', 'QTY (Portion)', 'Money In', 'Cost', 'Net Income', 'Customer Name', 'Order Number', 'Time', 'Source Key', 'Flags'];
const COL = { date: 0, desc: 1, channel: 2, orderFrom: 3, type: 4, qty: 5, moneyIn: 6, cost: 7, net: 8, customer: 9, orderNo: 10, time: 11, key: 12, flags: 13 };

// Sheet cells and CSV cells arrive as text ("1,234.50", "฿55", "XXXXXX", ""). Anything that is not a number is null.
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[฿,\s]/g, '');
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
const isPlaceholder = (v) => /^x{3,}$/i.test(String(v ?? '').trim());
const money = (n) => (n === null ? '' : Math.round(n * 100) / 100);

// ---------------------------------------------------------------------------------------------
// Grab CSV -> ledger rows
// Header: Date,Description,Branch,Order from,Type,QTY (Portion),Money In,Cost,Net Income,Customer Name,Grab Order Number,Time
// "Net Profit" is accepted for the older name of "Net Income".
// ---------------------------------------------------------------------------------------------
function grabCsvToLedger(csvText) {
  const table = parseCsv(csvText);
  const problems = [];
  if (!table.length) return { rows: [], dates: new Set(), problems: ['The file is empty.'] };

  const head = table[0].map((h) => String(h).trim().toLowerCase());
  const at = (...names) => head.findIndex((h) => names.includes(h));
  const idx = {
    date: at('date'), desc: at('description'), orderFrom: at('order from'), type: at('type'),
    qty: at('qty (portion)', 'qty'), moneyIn: at('money in'), cost: at('cost'),
    net: at('net income', 'net profit'), customer: at('customer name'), orderNo: at('grab order number', 'order number'), time: at('time'),
  };
  const missing = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) return { rows: [], dates: new Set(), problems: [`This does not look like the Claude Log CSV. Missing columns: ${missing.join(', ')}.`] };

  const rows = [];
  const dates = new Set();
  const seqByDate = new Map();
  let block = { orderNo: '', orderFrom: '', customer: '', time: '' };

  table.slice(1).forEach((r, n) => {
    const cell = (i) => String(r[i] ?? '').trim();
    const d = parseDate(cell(idx.date));
    if (!d) { problems.push(`Row ${n + 2}: unreadable date "${cell(idx.date)}", skipped.`); return; }
    const dmy = formatDMY(d);
    dates.add(dmy);

    const type = cell(idx.type);
    if (!['Order', 'Grab', 'Recipe'].includes(type)) { problems.push(`Row ${n + 2}: unknown type "${type}", skipped.`); return; }

    // Customer, order number, Order from and time are only filled on the first row of each order's block.
    if (cell(idx.orderNo)) block = { orderNo: cell(idx.orderNo), orderFrom: cell(idx.orderFrom), customer: cell(idx.customer), time: cell(idx.time) };

    const qty = num(r[idx.qty]);
    const moneyIn = num(r[idx.moneyIn]);
    const cost = num(r[idx.cost]);
    let net = num(r[idx.net]);
    const flags = [];
    if ([r[idx.qty], r[idx.moneyIn], r[idx.cost], r[idx.net], r[idx.customer], r[idx.orderFrom], r[idx.time]].some(isPlaceholder)) flags.push('XXXXXX in the source row');

    // Net Income is the source of truth. If it is missing, rebuild it the way the Claude Log defines it.
    if (net === null) {
      if (type === 'Order' && qty !== null && moneyIn !== null) net = qty * moneyIn;
      else if (type === 'Grab' && cost !== null) net = -Math.abs(cost);
      else if (type === 'Recipe' && qty !== null && cost !== null) net = -(qty * cost);
      else flags.push('Net Income could not be worked out');
    }

    const seq = (seqByDate.get(dmy) || 0) + 1;
    seqByDate.set(dmy, seq);
    rows.push([
      dmy, cell(idx.desc), 'Grab', block.orderFrom, type, qty ?? '', money(moneyIn), money(cost), money(net),
      block.customer, block.orderNo, block.time, `G|${dmy}|${seq}`, flags.join('; '),
    ]);
  });

  return { rows, dates, problems };
}

// ---------------------------------------------------------------------------------------------
// LINE bot Orders tab -> ledger rows
// Orders!A:M = Date | Time | Items | Order From | Type | Qty | Total | Name | Address | Phone | Slip Ref | Slip URL | Order No
// Items text looks like "2x Noir Ragu + Pasta (Radiatori) (฿225), 1x Bacon Steak (฿0)" at GROSS unit prices.
// Address and phone are deliberately NOT copied into the ledger.
// ---------------------------------------------------------------------------------------------
const ITEM = /^(\d+)x\s+(.+?)\s*\(฿(\d+(?:\.\d+)?)\)\s*$/;

function parseItems(text) {
  const parts = String(text || '').split(/,\s*(?=\d+x )/);
  const items = [];
  for (const part of parts) {
    const m = ITEM.exec(part.trim());
    if (m) items.push({ qty: Number(m[1]), name: m[2].trim(), price: Number(m[3]) });
    else if (part.trim()) return null;
  }
  return items.length ? items : null;
}

function timeText(v) {
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 1440);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  return String(v ?? '').trim().slice(0, 5);
}

function lineOrdersToLedger(sheetRows) {
  const rows = [];
  const problems = [];
  (sheetRows || []).forEach((r, n) => {
    const from = String(r[3] ?? '').trim();
    if (String(r[0]).trim().toLowerCase() === 'date' || from !== 'LINE Bot') return;
    const d = parseDate(r[0]);
    if (!d) { problems.push(`Orders row ${n + 1}: unreadable date, skipped.`); return; }
    const dmy = formatDMY(d);
    const type = String(r[4] ?? '').trim();
    const total = num(r[6]);
    const name = String(r[7] ?? '').trim();
    const slip = String(r[10] ?? '').trim();
    const orderNo = String(r[12] ?? '').replace(/^'/, '').trim();
    const time = timeText(r[1]);
    const sig = crypto.createHash('sha1').update([dmy, time, r[2], type, total, name, slip].join('|')).digest('hex').slice(0, 10);
    const ref = orderNo ? `#${orderNo}` : (slip || `L-${sig.slice(0, 6)}`);

    if (type === 'Order') {
      const items = parseItems(r[2]);
      if (!items) {
        const q = num(r[5]) ?? 1;
        rows.push([dmy, String(r[2] ?? '').trim(), 'LINE', 'LINE', 'Order', q, money(total === null ? null : total / q), '', money(total), name, ref, time, `L|${sig}|0`, 'Items text could not be split, logged as one line']);
        return;
      }
      const sum = items.reduce((s, i) => s + i.qty * i.price, 0);
      const off = total !== null && Math.abs(sum - total) > 0.5 ? [`Items add to ${sum} but the order total is ${total}`] : [];
      items.forEach((it, i) => rows.push([
        dmy, it.name, 'LINE', 'LINE', 'Order', it.qty, it.price, '', money(it.qty * it.price), name, ref, time, `L|${sig}|${i}`, i === 0 ? off.join('; ') : '',
      ]));
    } else if (type === 'Discount') {
      const amt = total === null ? null : Math.abs(total);
      rows.push([dmy, String(r[2] ?? '').trim() || 'Promo discount', 'LINE', 'LINE', 'Discount', 1, '', money(amt), money(amt === null ? null : -amt), name, ref, time, `L|${sig}|d`, '']);
    } else if (type === 'Delivery') {
      // What the customer paid for delivery (the flat rate, or the fee you confirmed). Income.
      const fee = total === null ? null : Math.abs(total);
      rows.push([dmy, 'Delivery fee charged', 'LINE', 'LINE', 'Delivery', 1, money(fee), '', money(fee), name, ref, time, `L|${sig}|f`, '']);
    } else if (type) {
      problems.push(`Orders row ${n + 1}: type "${type}" is not handled yet, skipped.`);
    }
  });
  return { rows, problems };
}

// What you actually paid the rider for one LINE order. A cost. Key is per order, so sending a fee again corrects it.
function riderRow({ dmy, orderNo, customer, fee, note = '' }) {
  return [dmy, 'Rider fee', 'LINE', 'LINE', 'Rider', 1, '', money(fee), money(-fee), customer || '', orderNo, '', `R|${dmy}|${orderNo}`, note];
}

// Sheet array -> object, for the reports.
function ledgerObjects(sheetRows) {
  const out = [];
  for (const r of sheetRows || []) {
    if (String(r[COL.date]).trim().toLowerCase() === 'date') continue;
    const date = parseDate(r[COL.date]);
    if (!date) continue;
    out.push({
      date, dmy: formatDMY(date), desc: String(r[COL.desc] ?? '').trim(), channel: String(r[COL.channel] ?? '').trim(),
      orderFrom: String(r[COL.orderFrom] ?? '').trim(), type: String(r[COL.type] ?? '').trim(),
      qty: num(r[COL.qty]), moneyIn: num(r[COL.moneyIn]), cost: num(r[COL.cost]), net: num(r[COL.net]),
      customer: String(r[COL.customer] ?? '').trim(), orderNo: String(r[COL.orderNo] ?? '').trim(), time: String(r[COL.time] ?? '').trim(),
      key: String(r[COL.key] ?? '').trim(), flags: String(r[COL.flags] ?? '').trim(),
    });
  }
  return out;
}


// Does this raw Ledger row fall in the date range (inclusive) for this channel ("All" matches every channel)?
function rowInRange(row, from, to, channel = 'All') {
  const d = parseDate(row[COL.date]);
  if (!d) return false;
  const t = d.getTime();
  if (t < from.getTime() || t > to.getTime()) return false;
  const want = String(channel || 'All').trim().toLowerCase();
  return want === 'all' || String(row[COL.channel] || '').trim().toLowerCase() === want;
}

// The edit form sends { desc, qty, moneyIn, cost, net, customer, time }. Returns { cells: [{ col, value }] } or { error }.
// Numbers are written as numbers, a blank clears the cell, and nothing else in the row is touched.
function cellsFor(changes) {
  const map = { desc: [COL.desc, false], qty: [COL.qty, true], moneyIn: [COL.moneyIn, true], cost: [COL.cost, true], net: [COL.net, true], customer: [COL.customer, false], time: [COL.time, false] };
  const cells = [];
  for (const [field, raw] of Object.entries(changes || {})) {
    if (!map[field]) return { error: `"${field}" can't be edited here.` };
    const [col, numeric] = map[field];
    const text = String(raw ?? '').trim();
    if (!numeric) { cells.push({ col, value: text }); continue; }
    if (text === '') { cells.push({ col, value: '' }); continue; }
    const n = num(text);
    if (n === null) return { error: `"${text}" is not a number for ${field}.` };
    cells.push({ col, value: n });
  }
  return cells.length ? { cells } : { error: 'Nothing to change.' };
}

module.exports = { rowInRange, cellsFor, LEDGER_TAB, LEDGER_HEADERS, COL, num, grabCsvToLedger, lineOrdersToLedger, parseItems, ledgerObjects, riderRow };
