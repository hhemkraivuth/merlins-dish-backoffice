// Reads a dish tab from the live Merlin's numbers sheet (read only) and turns it into a
// recipe: ingredient, packaging and utility lines with their standard quantities.
// Only columns A to D of the first block are read (Name | QTY | Unit | Cost / Unit).

const { toNumber } = require('./priceBook');

function parseDishTab(rows) {
  const recipe = {
    dish: String((rows[0] && rows[0][1]) || '').trim(),
    sellingPrice: null,
    ingredients: [],
    packaging: [],
    utility: [],
    usualYield: null,
  };
  let section = null;

  for (const r of rows) {
    const a = String(r[0] || '').trim();
    if (!a) continue;
    if (/^selling price/i.test(a) && section === null) { recipe.sellingPrice = toNumber(r[1]); continue; }
    if (/^ingredients$/i.test(a)) { section = 'ingredient'; continue; }
    if (/^packaging$/i.test(a)) { section = 'packaging'; continue; }
    if (/^summary$/i.test(a)) break;
    if (section === null) continue;

    const qty = toNumber(r[1]);
    if (qty === null) continue;
    const line = { name: a, qty, unit: String(r[2] || '').trim(), sheetCost: toNumber(r[3]) };
    if (/^utility/i.test(a)) recipe.utility.push(line);
    else if (section === 'packaging') recipe.packaging.push(line);
    else recipe.ingredients.push(line);
  }

  // The usual yield is the packaging count the tab is built around (e.g. 22 cups)
  const counts = recipe.packaging.map((p) => p.qty).filter((q) => q > 0);
  recipe.usualYield = counts.length ? Math.max(...counts) : null;
  return recipe;
}

module.exports = { parseDishTab };
