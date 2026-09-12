// Lot-based batch-cook costing — FIXED PORTION-COUNT MODEL.
//
// A "lot" = one Batch Cook event. At cook time, the batch is packaged into a FIXED
// number of portions per size (e.g. "4 Large + 6 Regular", decided once, right after
// cooking — not tracked as a shrinking gram pool). Cost/gram is computed once from
// total batch cost ÷ total cooked weight, then each size's fixed portion cost =
// portion weight × cost/gram, locked in for that lot.
//
// Orders decrement the COUNT for whichever size was ordered. Sizes deplete
// independently — Large can hit 0 while Regular still has stock, same as a freezer.
// If an order comes in for a size whose count is already 0, that's flagged (stock
// doesn't exist yet) rather than silently going negative.
//
// When ALL sizes in a lot hit 0, the next Batch Cook becomes the new active lot for
// that dish. If a new batch hasn't been logged yet, the last known lot's per-size cost
// carries forward for costing purposes (explicit user choice), but zero-stock orders
// still get flagged.

const { readTab, appendRows, updateRow } = require('./sheets');

const BATCH_LOTS_TAB = 'Batch Lots';
const BATCH_LOT_SIZES_TAB = 'Batch Lot Sizes'; // Batch ID | Size Name | Portion Weight (g) | Count Packed | Count Remaining | Cost per Portion
const BATCH_LOT_INGREDIENTS_TAB = 'Batch Lot Ingredients';
const RECIPE_TEMPLATES_TAB = 'Recipe Templates';

// Batch Lots columns: Batch ID | Dish | Date Cooked | Total Batch Weight (g) | Total Batch Cost | Cost per Gram | Status
async function getActiveLot(dish) {
  const rows = await readTab(BATCH_LOTS_TAB);
  const [header, ...data] = rows;
  const dishRows = data.filter((r) => r[1] === dish);
  const active = dishRows.find((r) => r[6] === 'Active');
  if (active) return rowToLot(active);
  if (dishRows.length) return rowToLot(dishRows[dishRows.length - 1]); // last known lot fallback
  return null;
}

function rowToLot(row) {
  return {
    batchId: row[0],
    dish: row[1],
    dateCooked: row[2],
    totalBatchWeight: Number(row[3]),
    totalBatchCost: Number(row[4]),
    costPerGram: Number(row[5]),
    status: row[6],
  };
}

async function getLotSizes(batchId) {
  const rows = await readTab(BATCH_LOT_SIZES_TAB);
  const [header, ...data] = rows;
  return data
    .filter((r) => r[0] === batchId)
    .map((r) => ({
      batchId: r[0],
      sizeName: r[1],
      portionWeight: Number(r[2]),
      countPacked: Number(r[3]),
      countRemaining: Number(r[4]),
      costPerPortion: Number(r[5]),
    }));
}

// Decrements the count for one size of the dish's active lot by `qty` (usually 1, or
// however many of that size were in the order). Returns the per-portion cost to use
// for that order line. Flags (doesn't block) if the size's stock is already at 0.
async function deductFromLot(dish, sizeName, qty = 1) {
  const activeLot = await getActiveLot(dish);
  if (!activeLot) return { deducted: false, reason: 'no_active_lot' };

  const sizeRows = await readTab(BATCH_LOT_SIZES_TAB);
  const [header, ...data] = sizeRows;
  let rowIndex = -1;
  let sizeRow = null;
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === activeLot.batchId && data[i][1].toLowerCase() === sizeName.toLowerCase()) {
      rowIndex = i + 2;
      sizeRow = data[i];
      break;
    }
  }
  if (!sizeRow) return { deducted: false, reason: 'size_not_found_in_lot' };

  const countRemaining = Number(sizeRow[4]);
  const costPerPortion = Number(sizeRow[5]);
  const outOfStock = countRemaining <= 0;
  const newRemaining = Math.max(0, countRemaining - qty);
  sizeRow[4] = newRemaining;
  await updateRow(BATCH_LOT_SIZES_TAB, rowIndex, sizeRow);

  // If every size in this lot is now at 0, mark the lot Depleted
  const allSizes = await getLotSizes(activeLot.batchId);
  const stillHasStock = allSizes.some((s) => (s.sizeName === sizeName ? newRemaining : s.countRemaining) > 0);
  if (!stillHasStock) {
    const lotRows = await readTab(BATCH_LOTS_TAB);
    const [lotHeader, ...lotData] = lotRows;
    const lotRowIndex = lotData.findIndex((r) => r[0] === activeLot.batchId) + 2;
    const lotRow = lotData[lotData.findIndex((r) => r[0] === activeLot.batchId)];
    lotRow[6] = 'Depleted';
    await updateRow(BATCH_LOTS_TAB, lotRowIndex, lotRow);
  }

  return {
    deducted: true,
    costPerPortion,
    remaining: newRemaining,
    outOfStock, // true = this order was placed against a size that had already hit 0
  };
}

// Creates a new lot from a Batch Cook form submission.
// ingredients: [{name, qty, unit, unitPrice}] — qty in grams/ml as applicable
// packaging/utility: [{name, qty, unitPrice}] — added to total cost, not part of food weight
// totalBatchWeight: measured cooked weight in grams (entered by Lily, not summed from raw inputs)
// portionSizes: [{sizeName, portionWeight, countPacked}] — e.g. [{Regular, 348, 6}, {Large, 523, 4}]
async function createBatchLot({ dish, totalBatchWeight, ingredients, packaging = [], utility = [], portionSizes }) {
  const ingredientCost = ingredients.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const otherCost = [...packaging, ...utility].reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const totalBatchCost = ingredientCost + otherCost;
  const costPerGram = totalBatchCost / totalBatchWeight;
  const batchId = `${dish.replace(/\s+/g, '')}-${Date.now()}`;
  const dateCooked = new Date().toISOString().slice(0, 10);

  await appendRows(BATCH_LOTS_TAB, [[
    batchId, dish, dateCooked, totalBatchWeight, totalBatchCost.toFixed(2), costPerGram.toFixed(4), 'Active',
  ]]);

  const sizeRows = portionSizes.map((s) => [
    batchId, s.sizeName, s.portionWeight, s.countPacked, s.countPacked, (s.portionWeight * costPerGram).toFixed(2),
  ]);
  await appendRows(BATCH_LOT_SIZES_TAB, sizeRows);

  const allLines = [...ingredients, ...packaging, ...utility];
  const ingredientRows = allLines.map((l) => [
    batchId, l.name, l.qty, l.unit || '', l.unitPrice, (l.qty * l.unitPrice).toFixed(2),
  ]);
  await appendRows(BATCH_LOT_INGREDIENTS_TAB, ingredientRows);

  return { batchId, totalBatchCost, costPerGram, sizeRows };
}

module.exports = {
  getActiveLot,
  getLotSizes,
  deductFromLot,
  createBatchLot,
  BATCH_LOTS_TAB,
  BATCH_LOT_SIZES_TAB,
  BATCH_LOT_INGREDIENTS_TAB,
  RECIPE_TEMPLATES_TAB,
};
