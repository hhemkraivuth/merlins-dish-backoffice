// Recipe Templates: the reusable "recipe card" for each batch-cooked dish.
// Mirrors the shape of Lily's existing per-dish Menu Summary tabs (e.g. "Tuscan Pork
// Braise", "Red Wine Beef Stew"): ingredient lines + packaging lines + utility lines.
//
// NOTE: portion sizes (Regular/Large + how many of each were packed) are NOT part of
// the persistent template — they're decided fresh at each Batch Cook (pack-out can
// vary batch to batch) and are stored per-lot in Batch Lot Sizes. This tab only holds
// the ingredient/packaging/utility recipe itself, which is genuinely reusable.

const { readTab, appendRows } = require('./sheets');

const RECIPE_TEMPLATES_TAB = 'Recipe Templates';

// Columns: Dish | Line Type (Ingredient/Packaging/Utility) | Name | Qty | Unit | Unit Price
async function getRecipeTemplate(dish) {
  const rows = await readTab(RECIPE_TEMPLATES_TAB);
  const [header, ...data] = rows;
  const lines = data
    .filter((r) => r[0] === dish)
    .map((r) => ({ lineType: r[1], name: r[2], qty: Number(r[3]), unit: r[4], unitPrice: Number(r[5]) }));
  return {
    ingredients: lines.filter((l) => l.lineType === 'Ingredient'),
    packaging: lines.filter((l) => l.lineType === 'Packaging'),
    utility: lines.filter((l) => l.lineType === 'Utility'),
  };
}

async function listDishesWithTemplates() {
  const rows = await readTab(RECIPE_TEMPLATES_TAB);
  const [header, ...data] = rows;
  return [...new Set(data.map((r) => r[0]))];
}

async function saveRecipeTemplate(dish, { ingredients = [], packaging = [], utility = [] }) {
  const rows = [
    ...ingredients.map((l) => [dish, 'Ingredient', l.name, l.qty, l.unit || '', l.unitPrice]),
    ...packaging.map((l) => [dish, 'Packaging', l.name, l.qty, l.unit || 'Set', l.unitPrice]),
    ...utility.map((l) => [dish, 'Utility', l.name, l.qty, l.unit || '', l.unitPrice]),
  ];
  return appendRows(RECIPE_TEMPLATES_TAB, rows);
}

module.exports = {
  getRecipeTemplate,
  listDishesWithTemplates,
  saveRecipeTemplate,
  RECIPE_TEMPLATES_TAB,
};
