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

// The expected count for a drink, or null when it cannot be known honestly. Only a clean hand count is a baseline:
// a receipt resets the number without taking the sales before it off, so after one the next count is history only.
async function expectedFor(existing, { ledger, drinks, links }) {
  if (!existing || !['Manual', 'LINE'].includes(existing.lastUpdatedBy)) return null;
  const match = matchSales({ drinks, ledger, links });
  if (match.unmapped.length) return null;
  const sold = soldSince(existing, match);
  return sold === null ? null : { before: existing.currentCount - sold, sold };
}

module.exports = { KEY, matchSales, soldSince, expectedFor, loadLinks, saveLink, isDrinkItem, looksLikeDrink };
