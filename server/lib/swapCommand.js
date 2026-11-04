// Changes the brand used for one recipe line, without editing the recipe tab in Merlin's numbers.
//
//   swap bolo polpa > pelati                 from now on, every batch
//   swap bolo polpa > pelati from 29/10      only batches cooked on or after that date
//   swaps                                    list them
//   unswap bolo polpa                        take it back
//
// Stored as Swap rows in the Shorthand tab: Swap | <dish tab> | <recipe line> | <new ingredient> | <from, YYYY-MM-DD>.
// deps: { loadShorthand(), loadRecipe(tab), loadCatalogue(), readRows(), saveSwap(row), deleteSwaps(pred) }

const { parseDate, formatDMY } = require('./dates');
const { matchIngredient } = require('./typedReceipt');
const { findRecipeIngredient } = require('./costBatch');
const { normName } = require('./priceBook');

const FROM = /\s+from\s+(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\s*$/i;
const SWAP = /^swap\s+(.+?)\s*(?:=>|->|→|>|=)\s*(.+)$/i;
const UNSWAP = /^unswap\s+(.+)$/i;
const USAGE = 'Change the brand a recipe line uses:\nswap bolo polpa > pelati (every batch from now on)\nswap bolo polpa > pelati from 29/10 (only batches from that date)\nswaps (list them)\nunswap bolo polpa (take it back)';
const key = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

// "bolo polpa" -> { tab: 'Polished Pork Bolognese', rest: 'polpa' }. The dish part may be a dish word or a whole tab name.
function splitDish(text, shorthand) {
  const words = text.trim().split(/\s+/);
  const byName = new Map();
  for (const tab of new Set(shorthand.dishes.values())) byName.set(key(tab), tab);
  for (let k = words.length - 1; k >= 1; k--) {
    const cand = key(words.slice(0, k).join(' '));
    const tab = shorthand.dishes.get(cand) || byName.get(cand);
    if (tab) return { tab, rest: words.slice(k).join(' ') };
  }
  return null;
}

async function findLine(tab, oldText, deps) {
  const recipe = await deps.loadRecipe(tab);
  const hit = findRecipeIngredient(oldText, recipe, { ingredients: new Map() });
  if (hit.line) return { name: hit.line.name };
  return { names: recipe.ingredients.map((i) => i.name) };
}

async function processSwap(text, messageDate, deps) {
  const t = String(text || '').trim();
  if (/^swaps$/i.test(t)) {
    const rows = (await deps.readRows()).filter((r) => String(r[0] || '').toLowerCase() === 'swap');
    if (!rows.length) return ['No brand swaps yet.\n' + USAGE];
    return [`Brand swaps:\n${rows.map((r) => {
      const [dish, line] = String(r[1] || '').split('|').map((x) => x.trim());
      const from = String(r[3] || '').trim();
      return `• ${dish}: ${line} > ${r[2]}${from ? ` (from ${formatDMY(parseDate(from, messageDate) || messageDate)})` : ''}`;
    }).join('\n')}`];
  }

  const un = t.match(UNSWAP);
  if (un) {
    const shorthand = await deps.loadShorthand();
    const d = splitDish(un[1], shorthand);
    if (!d) return [`I don't know that dish. Nothing changed.\n${USAGE}`];
    const line = await findLine(d.tab, d.rest, deps);
    if (!line.name) return [`"${d.rest}" isn't a line in the ${d.tab} recipe. Nothing changed.\nLines: ${line.names.join(', ')}`];
    const n = await deps.deleteSwaps((r) => String(r[0] || '').toLowerCase() === 'swap' && key(r[1]) === key(`${d.tab}|${line.name}`));
    return [n ? `Swap removed. ${d.tab} uses ${line.name} again.` : `There was no swap for ${line.name} in ${d.tab}. Nothing changed.`];
  }

  if (!/^swap\b/i.test(t)) return null;
  let body = t;
  let from = null;
  const fm = body.match(FROM);
  if (fm) {
    from = parseDate(fm[1], messageDate);
    if (!from) return [`"${fm[1]}" doesn't look like a valid date. Nothing changed.`];
    body = body.replace(FROM, '');
  }
  const m = body.match(SWAP);
  if (!m) return [USAGE];

  const shorthand = await deps.loadShorthand();
  const d = splitDish(m[1], shorthand);
  if (!d) return [`I don't know which dish "${m[1]}" is. Use a dish word like bolo or the tab name. Nothing changed.`];
  const line = await findLine(d.tab, d.rest, deps);
  if (!line.name) return [`"${d.rest}" isn't a line in the ${d.tab} recipe. Nothing changed.\nLines: ${line.names.join(', ')}`];

  let fresh = m[2].trim();
  let note = '';
  try {
    const catalogue = await deps.loadCatalogue();
    // Brands are the whole point here, so two names that both fit are never settled quietly.
    const words = fresh.toLowerCase().match(/[a-z0-9]+/g) || [];
    const fits = catalogue.filter((n) => { const have = n.toLowerCase().match(/[a-z0-9]+/g) || []; return words.length && words.every((w) => have.includes(w)); });
    const same = catalogue.filter((n) => key(n) === key(fresh));
    const hit = same.length === 1 ? { name: same[0] } : fits.length > 1 ? { ambiguous: fits.slice(0, 5) } : fits.length === 1 ? { name: fits[0] } : matchIngredient(fresh, catalogue);
    if (hit.name) fresh = hit.name;
    else if (hit.ambiguous) return [`"${fresh}" could be:\n${hit.ambiguous.map((n) => `• ${n}`).join('\n')}\nSend the swap again with the full name. Nothing changed.`];
    else note = `\n"${fresh}" is not in the Price Tracker, so batches will show it as having no price until you add it to column B of the Price Tracker.`;
  } catch (err) { note = '\nI could not check the Price Tracker, so the name was saved as typed.'; }
  if (normName(fresh) === normName(line.name)) return [`${line.name} is already that ingredient. Nothing changed.`];

  const iso = from ? from.toISOString().slice(0, 10) : '';
  await deps.deleteSwaps((r) => String(r[0] || '').toLowerCase() === 'swap' && key(r[1]) === key(`${d.tab}|${line.name}`) && String(r[3] || '').trim() === iso);
  await deps.saveSwap(['Swap', `${d.tab} | ${line.name}`, fresh, iso]);
  return [`Saved. ${d.tab} will use ${fresh} in place of ${line.name}${from ? ` for batches cooked on or after ${formatDMY(from)}` : ''}. The recipe tab is unchanged.\nBatches already logged keep their cost. To re-cost one, send undo <dish> <date>, then send the cook note again.${note}`];
}

module.exports = { processSwap, USAGE };
