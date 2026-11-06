// Stock Counts: packaging and dry-goods inventory (cups, bags, boxed drinks/soup
// cans, utensils, etc.) — separate from fresh ingredients (which feed batch costing)
// and separate from cooked-food lots (which track sellable portions).
//
// Two ways this updates:
// 1. Manual — Lily counts what's on the shelf and corrects/sets the number directly
// 2. Auto-deduct — Batch Cook submissions and Daily Orders processing decrement stock
//    as packaging/cans get used, without her having to log it separately
//
// Manual correction always wins going forward — it's not fighting auto-deduction,
// it's just resetting the baseline from that point on.

const { readTab, appendRows, updateRow } = require('./sheets');

const STOCK_COUNTS_TAB = 'Stock Counts'; // Item Name | Unit | Current Count | Last Updated | Last Updated By | Category

const CATEGORIES = ['Drinks', 'Packaging', 'Ingredients', 'Other'];

// A confident guess from the name. Anything it does not recognise returns '' and the page asks Lily once.
// Wine and stout are cooking ingredients here, not drinks for sale.
const GUESS = [
  ['Ingredients', /\b(wine|stout|thyme|beer|stock|sauce|flour|salt|pepper|garlic|onion|butter|cream|cheese|pasta|tomato|beef|pork|chicken|bacon|herb)s?\b/i],
  ['Drinks', /\b(coke|pepsi|zero|root beer|a&w|soda|juice|water|lemonade|ginger|la croix|prebo|ben shaw|perrier|maison|sour hour|en ziero|ziero|juza|eden|old jamaica|fanta|sprite|tea|coffee|sparkling|cola)s?\b/i],
  ['Packaging', /\b(cup|lid|bag|box|utensil|fork|spoon|sticker|container|tape|napkin|label|bowl|straw|tissue|wrap|foil|sleeve|carton|set)s?\b/i],
];
function guessCategory(name) {
  const n = String(name || '');
  for (const [cat, re] of GUESS) if (re.test(n)) return cat;
  return '';
}

async function getAllStock() {
  const rows = await readTab(STOCK_COUNTS_TAB);
  const [header, ...data] = rows;
  return data.map((r, i) => ({
    rowIndex: i + 2, // 1-based, +1 for header
    itemName: r[0],
    unit: r[1],
    currentCount: Number(r[2]),
    lastUpdated: r[3],
    lastUpdatedBy: r[4],
    category: CATEGORIES.includes(r[5]) ? r[5] : '',
    guess: guessCategory(r[0]),
  }));
}

async function findStockRow(itemName) {
  const all = await getAllStock();
  return all.find((r) => r.itemName.toLowerCase() === itemName.toLowerCase()) || null;
}

// Manual set/correct — used by the Stock Counts page's edit-count button
async function setStockCount(itemName, newCount, unit, by = 'Manual', category = '') {
  const existing = await findStockRow(itemName);
  const now = new Date().toISOString();
  if (existing) {
    await updateRow(STOCK_COUNTS_TAB, existing.rowIndex, [existing.itemName, existing.unit, newCount, now, by, CATEGORIES.includes(category) ? category : existing.category || '']);
    return { itemName: existing.itemName, currentCount: newCount, created: false };
  }
  await appendRows(STOCK_COUNTS_TAB, [[itemName, unit || '', newCount, now, by, CATEGORIES.includes(category) ? category : '']]);
  return { itemName, currentCount: newCount, created: true };
}

// Auto-deduct — called from Batch Cook (packaging lines used) and Daily Orders
// (can drinks / soup-based items sold). Silently no-ops if the item isn't tracked
// yet (first time an unrecognised packaging item shows up, it gets flagged by the
// caller rather than auto-created, so stock counts don't silently drift with typos).
async function deductStock(itemName, qty) {
  const existing = await findStockRow(itemName);
  if (!existing) return { deducted: false, reason: 'item_not_tracked' };
  const newCount = existing.currentCount - qty;
  const now = new Date().toISOString();
  await updateRow(STOCK_COUNTS_TAB, existing.rowIndex, [itemName, existing.unit, newCount, now, 'Auto']);
  return { deducted: true, newCount, wentNegative: newCount < 0 };
}

// Edit one item in place: name, unit, count and category in a single save.
async function editStock({ oldName, newName, unit, count, category }, by = 'Manual') {
  const existing = await findStockRow(oldName);
  if (!existing) throw new Error(`${oldName} is not in the stock list.`);
  const name = String(newName || '').trim() || existing.itemName;
  if (name.toLowerCase() !== existing.itemName.toLowerCase() && (await findStockRow(name))) throw new Error(`${name} is already in the stock list.`);
  const n = count == null || count === '' ? existing.currentCount : Number(count);
  if (!Number.isFinite(n)) throw new Error('The count must be a number.');
  const cat = CATEGORIES.includes(category) ? category : existing.category || '';
  await updateRow(STOCK_COUNTS_TAB, existing.rowIndex, [name, unit == null ? existing.unit : String(unit).trim(), n, new Date().toISOString(), by, cat]);
  return { itemName: name, unit: unit == null ? existing.unit : String(unit).trim(), currentCount: n, category: cat };
}

module.exports = { CATEGORIES, guessCategory, editStock, getAllStock, findStockRow, setStockCount, deductStock, STOCK_COUNTS_TAB };
