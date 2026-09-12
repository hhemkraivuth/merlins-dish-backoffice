const { getRecipeTemplate, saveRecipeTemplate, listDishesWithTemplates } = require('../lib/recipeTemplates');
const { createBatchLot } = require('../lib/batchLots');
const { readTab } = require('../lib/sheets');
const { deductStock } = require('../lib/stockCounts');

const EXPENSE_LOG_TAB = 'Expense Log';

// GET /api/batch-cook/template/:dish — prefill the form from the saved recipe
async function getTemplate(req, res) {
  try {
    const dish = decodeURIComponent(req.params.dish);
    const template = await getRecipeTemplate(dish);
    res.json(template);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// GET /api/batch-cook/latest-prices — latest known unit price per ingredient,
// sourced from the Expense Log (receipt scans), so the form doesn't need retyped prices
async function getLatestPrices(req, res) {
  try {
    const rows = await readTab(EXPENSE_LOG_TAB);
    const [header, ...data] = rows;
    const latest = {};
    // Expense Log rows come in chronologically appended order — last one wins per ingredient
    for (const r of data) {
      const ingredient = r[1];
      const costPerRecipeUnit = Number(r[4]);
      if (ingredient && !isNaN(costPerRecipeUnit)) {
        latest[ingredient] = costPerRecipeUnit;
      }
    }
    res.json({ latestPrices: latest });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/batch-cook/submit
// body: { dish, totalBatchWeight, ingredients, packaging, utility, portionSizes, updateTemplate }
async function submitBatch(req, res) {
  try {
    const { dish, totalBatchWeight, ingredients, packaging = [], utility = [], portionSizes, updateTemplate } = req.body;

    if (!dish || !totalBatchWeight || !ingredients?.length || !portionSizes?.length) {
      return res.status(400).json({ error: 'dish, totalBatchWeight, ingredients, and portionSizes are required' });
    }

    const lot = await createBatchLot({ dish, totalBatchWeight, ingredients, packaging, utility, portionSizes });

    // Auto-deduct packaging stock used in this batch (flags, doesn't block, if an
    // item isn't tracked yet in Stock Counts)
    const stockFlags = [];
    for (const p of packaging) {
      const result = await deductStock(p.name, p.qty);
      if (!result.deducted) stockFlags.push(`Packaging "${p.name}" not found in Stock Counts — not auto-deducted`);
      else if (result.wentNegative) stockFlags.push(`Stock for "${p.name}" went negative (${result.newCount}) — recount needed`);
    }

    // Optionally refresh the saved Recipe Template with this batch's ingredient list
    if (updateTemplate) {
      await saveRecipeTemplate(dish, { ingredients, packaging, utility });
    }

    res.json({ ...lot, stockFlags });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

async function listDishes(req, res) {
  try {
    const dishes = await listDishesWithTemplates();
    res.json({ dishes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getTemplate, getLatestPrices, submitBatch, listDishes };
