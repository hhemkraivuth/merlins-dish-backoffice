// Drinks sold. Drinks are only counted by hand, so the app never knew when a can left the shelf. This adds up the cans sold
// (Grab and LINE rows in the Ledger) since the last hand count, so the next count can be compared with what should be left.
//
// A sale name is matched to a stock item by name (the same matcher the shopping plan uses). When it cannot be matched, it is
// listed on the Audit desk with a picker, and Lily's choice is saved in App State (key drink_map) and used from then on.

const { linkStock } = require('./stockLink');
const { normName } = require('./priceBook');
const { guessCategory } = require('./stockCounts');

const KEY = 'drink_map';
const isDrinkItem = (i) => (i.category || i.guess || guessCategory(i.itemName)) === 'Drinks' || (!i.category && guessCategory(i.itemName) === 'Drinks');
const looksLikeDrink = (name) => guessCategory(name) === 'Drinks' && !/\b(stew|ragu|bolognese|braise|soup|pasta)\b/i.test(name);

// drinks: Stock Counts rows that are drinks. ledger: ledger rows. links: { saleKey: stock item name }.
// Returns { assign: Map(saleKey -> stockKey), sales: Map(saleKey -> { name, rows: [{ date, qty }] }), unmapped: [{ key, name, qty }] }
function matchSales({ drinks, ledger, links = {} }) {
  const sales = new Map();
  for (const r of ledger) {
    if (r.type !== 'Order' || !r.desc || !(r.qty > 0 || r.qty === undefined)) continue;
    const key = normName(r.desc);
    const linked = links[key];
    if (!linked && !looksLikeDrink(r.desc)) continue;
    const s = sales.get(key) || { name: r.desc, rows: [] };
    s.rows.push({ date: r.date, qty: r.qty || 1 });
    sales.set(key, s);
  }
  const needs = drinks.map((d) => ({ key: normName(d.itemName), name: d.itemName }));
  const stock = [...sales].map(([key, s]) => ({ key, name: s.name }));
  const { assign, unlinked } = linkStock(needs, stock, { links });
  const unmapped = unlinked.map((u) => ({ key: u.key, name: u.name, qty: sales.get(u.key).rows.reduce((a, b) => a + b.qty, 0) }));
  return { assign, sales, unmapped };
}

// Cans sold of one stock item after the day it was last counted (the count day itself is not taken off, because the
// count may have been made after that day's sales).
function soldSince(item, match) {
  const day = new Date(item.lastUpdated);
  const cutoff = Number.isNaN(day.getTime()) ? null : Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + (day.getUTCHours() >= 17 ? 1 : 0));
  if (cutoff === null) return null;
  const k = normName(item.itemName); let sold = 0;
  for (const [saleKey, stockKey] of match.assign) {
    if (stockKey !== k) continue;
    for (const r of match.sales.get(saleKey).rows) if (r.date.getTime() > cutoff) sold += r.qty;
  }
  return sold;
}

async function loadLinks(store = require('./appState')) { try { return JSON.parse((await store.getState(KEY)) || '{}'); } catch (err) { return {}; } }
async function saveLink(saleName, stockName, store = require('./appState')) {
  if (!saleName || !stockName) throw new Error('Pick the sale name and the stock item.');
  const cur = await loadLinks(store); cur[normName(saleName)] = stockName;
  await store.setState(KEY, JSON.stringify(cur)); return cur;
}

// Noodles. Every noodle portion sold takes one carb box off and dryG of dry pasta (dryG / boxG of a bag) from that pasta's bags.
// cards: [{ name, boxG, dryG, pack, packQty }]. Rows that name a card (Pasta - Tubetti, Tubetti (bundle), Stew + Tubetti) count.
const escRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function noodleRows(ledger, cards) {
  const out = [];
  for (const r of ledger) {
    if (r.type !== 'Order' || !r.desc) continue;
    for (const c of cards) if (new RegExp(`\\b${escRe(c.name)}\\b`, 'i').test(r.desc)) out.push({ date: r.date, qty: r.qty || 1, card: c });
  }
  return out;
}
const sinceCutoff = (item) => {
  const day = new Date(item.lastUpdated);
  return Number.isNaN(day.getTime()) ? null : Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + (day.getUTCHours() >= 17 ? 1 : 0));
};
// What a noodle related stock item should have lost since its last count: { sold, unit } or null when it is not a noodle item.
function noodleUse(item, ledger, cards) {
  const cutoff = sinceCutoff(item); if (cutoff === null) return null;
  const rows = noodleRows(ledger, cards).filter((r) => r.date.getTime() > cutoff);
  const name = normName(item.itemName);
  const card = cards.find((c) => normName(c.name) === name || normName(`Pasta - ${c.name}`) === name);
  if (card) return { sold: rows.filter((r) => r.card === card).reduce((a, r) => a + r.qty * (card.dryG / card.boxG), 0) };
  const boxes = cards.filter((c) => normName(c.pack || 'Packaging Box (carb600ml)') === name);
  if (boxes.length) return { sold: rows.filter((r) => boxes.includes(r.card)).reduce((a, r) => a + r.qty * (r.card.packQty || 1), 0) };
  return null;
}

// The expected count for a drink, or null when it cannot be known honestly. Only a clean hand count is a baseline:
// a receipt resets the number without taking the sales before it off, so after one the next count is history only.
async function expectedFor(existing, { ledger, drinks, links, cards = [] }) {
  if (!existing || !['Manual', 'LINE'].includes(existing.lastUpdatedBy)) return null;
  const nu = cards.length ? noodleUse(existing, ledger, cards) : null;
  if (nu) return { before: Math.round((existing.currentCount - nu.sold) * 100) / 100, sold: Math.round(nu.sold * 100) / 100 };
  const match = matchSales({ drinks, ledger, links });
  if (match.unmapped.length) return null;
  const sold = soldSince(existing, match);
  return sold === null ? null : { before: existing.currentCount - sold, sold };
}

module.exports = { noodleRows, noodleUse, KEY, matchSales, soldSince, expectedFor, loadLinks, saveLink, isDrinkItem, looksLikeDrink };
