// Costs one cooked batch.
//
//  * Quantities: whatever Lily listed in her note replaces the recipe quantity. Everything
//    she left out stays at the recipe quantity from the live sheet's dish tab.
//  * Packaging (cups) and reheating = the number of servings yielded.
//  * Prices: stock tracked ingredients take their grams from the oldest purchase lots first (FIFO),
//    blended when a batch spans two lots. Everything else uses the latest purchase on or before
//    the cook date (price book).
//  * Cost per portion = total batch cost / servings yielded.

const { normName } = require('./priceBook');

// Which cup each stew size is packed in
const SIZE_CUP = { Regular: '16oz', Large: '26oz' };

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

function costBatch({ batch, recipe, shorthand, priceBook, lotBook = null, usualYieldRatio = 0.75 }) {
  const flags = [];
  const notes = [];
  const date = batch.date;
  // Stews are packed in sizes (Regular / Large). Then the yield is the number of portions packed.
  const sizedIn = Array.isArray(batch.sizes) ? batch.sizes.filter((x) => x.count > 0 && x.weight > 0) : [];
  const sized = sizedIn.length > 0;
  const yieldN = batch.yield || (sized ? sizedIn.reduce((a, x) => a + x.count, 0) : null);

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
  const lotUse = []; // what this batch takes from stock lots, for the audit trail and the stock deduction

  // FIFO from stock lots. Returns true when the line was costed from lots.
  function lotLine(name, qty, unit, qtySource) {
    if (!lotBook || !lotBook.hasLots(name) || lotBook.isUntracked(name)) return false;
    const { parts, short } = lotBook.allocate(name, qty, unit, date);
    if (!parts.length) {
      const hadStock = lotBook.lotsFor(name).some((l) => l.date <= date);
      if (hadStock) flags.push(`${name}: no stock left in the lots, so it was costed at the latest price. Log the purchase if you have bought more.`);
      return false;
    }
    let cost = parts.reduce((sum, x) => sum + x.qty * x.unitCost, 0);
    if (short > 0) {
      const p = priceBook.lookup(name, date);
      const fallback = p && !p.missing ? p.cost : parts[parts.length - 1].unitCost;
      cost += short * fallback;
      flags.push(`${name}: only ${Math.round((qty - short) * 100) / 100}${unit || ''} was left in stock lots. The other ${Math.round(short * 100) / 100}${unit || ''} was costed at the latest price (${fallback.toFixed(3)}). Log the purchase or send a count.`);
    }
    const unitCost = cost / qty;
    const label = parts.map((x) => `${fmtDate(x.lot.date)} ${Math.round(x.qty * 100) / 100}${unit || ''} @ ${x.unitCost.toFixed(3)}`).join(' + ');
    for (const x of parts) lotUse.push({ name, lotId: x.lot.id, lotDate: x.lot.date, qty: x.qty, unitCost: x.unitCost, cost: x.qty * x.unitCost });
    lines.push({ type: 'Ingredient', name, qty, unit, unitCost, priceDate: fmtDate(parts[0].lot.date), priceSource: `Stock lots (FIFO): ${label}${short > 0 ? ' + latest price for the rest' : ''}`, lineCost: cost, qtySource, staleDays: null });
    return true;
  }

  function priceLine(type, name, qty, unit, sheetCost, qtySource) {
    if (type === 'Ingredient' && lotLine(name, qty, unit, qtySource)) return;
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
  const pkgOverride = batch.packagingQty || {};
  // Stews: each packed portion takes its own cup (Regular 16oz, Large 26oz). Everything else: one cup per serving.
  const cupFor = (name) => (sized ? sizedIn.find((z) => new RegExp(SIZE_CUP[z.name] || '^$', 'i').test(name)) : null);
  for (const p of recipe.packaging) {
    const o = pkgOverride[normName(p.name)];
    const z = cupFor(p.name);
    let qty;
    let src;
    if (o !== undefined) { qty = o; src = 'edited'; }
    else if (sized) { qty = z ? z.count : 0; src = 'packed'; }
    else { if (p.qty <= 0) continue; qty = portions ?? p.qty; src = 'yield'; }
    if (qty <= 0) continue;
    priceLine('Packaging', p.name, qty, p.unit, p.sheetCost, src);
  }
  if (sized) {
    for (const z of sizedIn) {
      if (!recipe.packaging.some((p) => new RegExp(SIZE_CUP[z.name] || '^$', 'i').test(p.name))) {
        flags.push(`${z.name} cup (${SIZE_CUP[z.name]}) is not on the ${recipe.dish} tab, so no cup was costed for ${z.name}.`);
      }
    }
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

  if (!sized && portions && recipe.usualYield && portions < recipe.usualYield * usualYieldRatio) {
    flags.push(`Low yield: ${portions} servings against the usual ${recipe.usualYield}. Margin risk.`);
  }

  // Pack-out: cost per gram = whole batch cost (ingredients, utilities incl. reheating, packaging) / cooked weight.
  // Cups are part of the delivered food, so they are already in the total. Each size = portion weight x cost per gram.
  let sizes = null;
  let costPerGram = null;
  let cookedWeight = null;
  if (sized) {
    const packed = sizedIn.reduce((a, x) => a + x.count * x.weight, 0);
    cookedWeight = batch.cookedWeight > 0 ? batch.cookedWeight : packed;
    if (!(batch.cookedWeight > 0)) notes.push(`Cooked weight taken as the packed total, ${packed}g`);
    else if (batch.cookedWeight < packed) flags.push(`Cooked weight ${batch.cookedWeight}g is less than the ${packed}g packed. Check the weights.`);
    costPerGram = total / cookedWeight;
    sizes = sizedIn.map((x) => ({ name: x.name, weight: x.weight, count: x.count, costPerPortion: round2(x.weight * costPerGram) }));
  }

  return {
    sizes,
    costPerGram: costPerGram === null ? null : Math.round(costPerGram * 100000) / 100000,
    cookedWeight,
    dish: recipe.dish,
    date,
    yield: portions,
    lines,
    lotUse,
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
