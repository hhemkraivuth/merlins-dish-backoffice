// Costs one cooked batch.
//
//  * Quantities: whatever Lily listed in her note replaces the recipe quantity. Everything
//    she left out stays at the recipe quantity from the live sheet's dish tab.
//  * Packaging (cups) and reheating = the number of servings yielded.
//  * Prices: the latest purchase on or before the cook date (price book).
//  * Cost per portion = total batch cost / servings yielded.

const { normName } = require('./priceBook');

const round2 = (n) => Math.round(n * 100) / 100;
const fmtDate = (d) => d.toISOString().slice(0, 10).split('-').reverse().join('/');

function findRecipeIngredient(token, recipe, shorthand) {
  const t = normName(token);
  if (t === 'meat') return { line: recipe.ingredients[0] || null, viaMeat: true };

  const mapped = shorthand.ingredients.get(t.replace(/\s+/g, ''));
  const target = normName(mapped || token);
  const exact = recipe.ingredients.find((i) => normName(i.name) === target);
  if (exact) return { line: exact };

  if (target.length >= 3) {
    const cands = recipe.ingredients.filter((i) => {
      const n = normName(i.name);
      return n.startsWith(target) || n.split(/[ -]+/).includes(target);
    });
    if (cands.length === 1) return { line: cands[0] };
  }
  return { line: null, target: mapped || token };
}

function costBatch({ batch, recipe, shorthand, priceBook, usualYieldRatio = 0.75 }) {
  const flags = [];
  const notes = [];
  const date = batch.date;
  const yieldN = batch.yield;

  if (!yieldN || yieldN <= 0) flags.push('No yield given, so cost per portion is not calculated. Add a line like "yield 21".');

  // 1. quantity per ingredient: recipe default, overridden by the note
  const qtyFor = new Map(); // normalised recipe name -> qty from note
  const extras = []; // note lines that aren't in the recipe
  for (const nl of batch.lines) {
    const { line, viaMeat, target } = findRecipeIngredient(nl.token, recipe, shorthand);
    if (line) {
      qtyFor.set(normName(line.name), nl.qty);
      if (viaMeat) notes.push(`Meat read as ${line.name}`);
    } else {
      extras.push({ name: target, qty: nl.qty, unit: nl.unit, token: nl.token });
    }
  }

  const lines = [];

  function priceLine(type, name, qty, unit, sheetCost, qtySource) {
    const p = priceBook.lookup(name, date);
    let unitCost = null;
    let priceDate = '';
    let priceSource = '';
    let staleDays = null;
    if (p && !p.missing) {
      if (p.stale) staleDays = p.staleDays;
      unitCost = p.cost;
      priceDate = fmtDate(p.date);
      priceSource = p.source;
      if (p.jumpFrom) flags.push(`${name}: price moved from ${p.jumpFrom.toFixed(3)} to ${p.cost.toFixed(3)} per ${unit || 'unit'} since the purchase before it. Check the Price Log entry.`);
    } else if (sheetCost !== null && sheetCost !== undefined) {
      unitCost = sheetCost;
      priceSource = 'Sheet cost (no dated purchase)';
      flags.push(`${name}: ${p && p.missing ? 'no purchase on or before the cook date' : 'no price found'}. Used the dish tab's current cost ${sheetCost}.`);
    } else {
      flags.push(`${name}: no price found, costed at 0.`);
      unitCost = 0;
    }
    lines.push({ type, name, qty, unit, unitCost, priceDate, priceSource, lineCost: qty * unitCost, qtySource, staleDays });
  }

  for (const ing of recipe.ingredients) {
    const fromNote = qtyFor.get(normName(ing.name));
    const qty = fromNote !== undefined ? fromNote : ing.qty;
    if (qty <= 0) continue;
    priceLine('Ingredient', ing.name, qty, ing.unit, ing.sheetCost, fromNote !== undefined ? 'note' : 'recipe');
  }
  for (const ex of extras) {
    const p = priceBook.lookup(ex.name, date);
    if (p && !p.missing) {
      flags.push(`"${ex.token}" is not in the ${recipe.dish} recipe. Costed as an extra line.`);
      priceLine('Ingredient', ex.name, ex.qty, ex.unit, null, 'note (extra)');
    } else {
      flags.push(`"${ex.token}" not recognised in the ${recipe.dish} recipe or the Price Log. Left out of the cost. Add it to the Shorthand tab if it is shorthand.`);
    }
  }

  const portions = yieldN && yieldN > 0 ? yieldN : null;
  for (const u of recipe.utility) {
    const isReheat = /reheat/i.test(u.name);
    const qty = isReheat ? (portions ?? u.qty) : u.qty;
    if (qty <= 0) continue;
    priceLine('Utility', u.name, qty, u.unit, u.sheetCost, isReheat ? 'yield' : 'recipe');
  }
  for (const p of recipe.packaging) {
    if (p.qty <= 0) continue;
    priceLine('Packaging', p.name, portions ?? p.qty, p.unit, p.sheetCost, 'yield');
  }

  const sum = (type) => lines.filter((l) => l.type === type).reduce((s, l) => s + l.lineCost, 0);
  const ingredientCost = sum('Ingredient');
  const packagingCost = sum('Packaging');
  const utilityCost = sum('Utility');
  const total = ingredientCost + packagingCost + utilityCost;
  const perPortion = portions ? total / portions : null;

  // Old prices only matter on lines that carry real weight in the batch cost; pantry items
  // bought rarely (thyme, nutmeg, cups) would otherwise bury the useful warnings.
  for (const l of lines) {
    if (l.staleDays && total > 0 && l.lineCost / total >= 0.10) {
      flags.push(`${l.name}: latest price is ${l.staleDays} days old (${l.priceDate}) and is ${Math.round((l.lineCost / total) * 100)}% of the batch cost.`);
    }
  }

  if (portions && recipe.usualYield && portions < recipe.usualYield * usualYieldRatio) {
    flags.push(`Low yield: ${portions} servings against the usual ${recipe.usualYield}. Margin risk.`);
  }

  return {
    dish: recipe.dish,
    date,
    yield: portions,
    lines,
    ingredientCost: round2(ingredientCost),
    packagingCost: round2(packagingCost),
    utilityCost: round2(utilityCost),
    total: round2(total),
    perPortion: perPortion === null ? null : round2(perPortion),
    foodCostPct: perPortion !== null && recipe.sellingPrice ? Math.round((perPortion / recipe.sellingPrice) * 1000) / 10 : null,
    sellingPrice: recipe.sellingPrice,
    flags,
    notes,
  };
}

module.exports = { costBatch };
