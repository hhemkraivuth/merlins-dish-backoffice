// The Best Prices tab in the Claude Log: for every ingredient, the cheapest price per unit ever paid,
// written the way Lily writes it in the Price Tracker ("best price: 235/2500g").
// Built from the Price Log and the Expense Log. Free stock is never in either, so it cannot win.

const { parsePurchaseUnit } = require('./priceBook');
const { formatDMY } = require('./dates');

const TAB = 'Best Prices';
const HEADERS = ['Ingredient', 'Best price remark', 'Best cost per g / ml / piece', 'Date', 'Shopped at', 'Latest cost per g / ml / piece', 'Latest date'];

const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const rnd = (n, dp) => Number(Number(n).toFixed(dp));

// 105.25 for "0.90kg" -> "105.25/900g". Containers ("1can", "48pcs") keep the words that were typed.
function remark(e) {
  const pu = parsePurchaseUnit(e.unitText);
  let unit = e.unitText;
  if (pu && (pu.unit === 'g' || pu.unit === 'ml')) unit = `${rnd(pu.qty, 2)}${pu.unit}`;
  const brand = ((String(e.remarks || '').match(/brand:\s*([^;]+)/i) || [])[1] || '').trim();
  const tail = brand ? `, ${brand}` : '';
  if (e.price === null || e.price === undefined || !unit) return `best price: ${rnd(e.cost, 4)} per unit${tail}`;
  return `best price: ${fmt(e.price)}/${unit}${tail}`;
}

function bestRows(priceBook) {
  return priceBook.best().map(({ name, best, latest }) => [
    name, remark(best), rnd(best.cost, 5), formatDMY(best.date), best.shop || '', rnd(latest.cost, 5), formatDMY(latest.date),
  ]);
}

async function writeBestPrices(priceBook) {
  const { ensureTab } = require('./cookLog');
  const { writeTab } = require('./sheets');
  await ensureTab(TAB, HEADERS);
  const rows = bestRows(priceBook);
  await writeTab(TAB, [HEADERS, ...rows]);
  return rows.length;
}

module.exports = { bestRows, writeBestPrices, remark, TAB, HEADERS };
