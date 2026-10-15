// Orchestrates what happens when a message lands in the back of house LINE group.
// All I/O is injected (deps) so the logic can be tested without Google or LINE.

const { parseNote, looksLikeAttempt } = require('./noteParser');
const { costBatch } = require('./costBatch');
const { parseDate, formatDMY, bangkokToday } = require('./dates');
const { parsePurchaseUnit } = require('./priceBook');

const baht = (n) => `฿${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const HELP = [
  'Send a cook note like this:',
  '7/10',
  'Bolo',
  'Meat 1000',
  'O 446',
  'yield 21',
  '',
  'Ingredients you leave out stay at the recipe quantity. Send a receipt photo and I will log it to the Expense Log.',
  'Dish words: bolo, ragu, tpb, rws, dbs, chix, brocs. Add more in the Shorthand tab.',
].join('\n');

function formatBatchReply(r, status) {
  const out = [];
  out.push(`${r.dish}, ${formatDMY(r.date)}${r.yield ? `, ${r.yield} serves` : ''}`);
  if (r.perPortion !== null) {
    out.push(`Batch ${baht(r.total)}, ${baht(r.perPortion)} per portion${r.foodCostPct !== null ? `, food cost ${r.foodCostPct}%` : ''}`);
  } else {
    out.push(`Batch ${baht(r.total)}, per portion not calculated`);
  }
  out.push(`Ingredients ${baht(r.ingredientCost)}, packaging ${baht(r.packagingCost)}, utilities ${baht(r.utilityCost)}`);
  for (const n of r.notes) out.push(n);
  out.push(status);
  if (r.flags.length) {
    out.push('');
    out.push('Check:');
    for (const f of r.flags.slice(0, 8)) out.push(`• ${f}`);
    if (r.flags.length > 8) out.push(`• plus ${r.flags.length - 8} more in the Cook Log`);
  }
  return out.join('\n');
}

// deps: { loadShorthand(), loadRecipe(tab), loadPriceBook(), isLogged(key), writeBatch(result, key), batchKey(...), today? }
async function processNote(text, deps) {
  const today = deps.today || bangkokToday();
  const shorthand = await deps.loadShorthand();
  const { batches, problems } = parseNote(text, shorthand, today);

  if (batches.length === 0) {
    if (looksLikeAttempt(text)) {
      return [`I couldn't tell which dish that is. Dish words: ${[...new Set(shorthand.dishes.keys())].slice(0, 12).join(', ')}.\nSend "help" for the format.`];
    }
    return null; // ordinary chat, stay silent
  }

  const replies = [];
  const priceBook = await deps.loadPriceBook();

  for (const batch of batches) {
    const extraFlags = [];
    if (!batch.date) { batch.date = today; extraFlags.push('No date in the note, so I used today.'); }

    let recipe;
    try {
      recipe = await deps.loadRecipe(batch.dishTab);
    } catch (err) {
      replies.push(`Couldn't read the "${batch.dishTab}" tab from Merlin's numbers (${err.message}). Nothing was logged for it.`);
      continue;
    }
    if (!recipe.ingredients.length) {
      replies.push(`The "${batch.dishTab}" tab has no ingredient lines I can read. Nothing was logged for it.`);
      continue;
    }

    const result = costBatch({ batch, recipe, shorthand, priceBook });
    result.flags.unshift(...extraFlags);

    if (!result.yield) {
      replies.push(formatBatchReply(result, 'NOT logged. Send the note again with a yield line.'));
      continue;
    }

    const key = deps.batchKey(batch.dishTab, batch.date, result.yield, batch.lines);
    if (await deps.isLogged(key)) {
      replies.push(`${result.dish}, ${formatDMY(result.date)}: this exact note is already in the Cook Log. Nothing added.\nBatch ${baht(result.total)}, ${baht(result.perPortion)} per portion.`);
      continue;
    }

    await deps.writeBatch(result, key);
    replies.push(formatBatchReply(result, 'Logged to the Cook Log.'));
  }

  if (problems.length) replies.push(`Couldn't use these lines:\n${problems.slice(0, 6).map((p) => `• ${p}`).join('\n')}`);
  return replies;
}

// deps: { loadCatalogue(), extractReceipt(base64, mime, catalogue), appendExpenseRows(rows) }
async function processReceipt({ buffer, mime }, messageDate, deps) {
  const catalogue = await deps.loadCatalogue();
  const extracted = await deps.extractReceipt(buffer.toString('base64'), mime, catalogue);

  const flags = [];
  let date = parseDate(extracted.shopping_date, messageDate);
  if (!date) {
    date = messageDate;
    flags.push(`No readable date on the receipt, used the day you sent it (${formatDMY(date)})`);
  }
  if (extracted.uncertain_fields && extracted.uncertain_fields.length) {
    flags.push(...extracted.uncertain_fields.map((f) => `Unclear: ${f}`));
  }

  const items = extracted.line_items || [];
  if (!items.length) return 'I could not read any items on that photo. Try a closer, flatter shot.';

  const unmatched = [];
  const rows = items.map((it) => {
    const unit = String(it.purchase_unit || '').trim();
    const pu = parsePurchaseUnit(`${it.purchase_qty}${unit}`);
    const costPerUnit = it.purchase_price !== null && pu && pu.qty > 0
      ? it.purchase_price / pu.qty
      : (it.purchase_qty > 0 ? it.purchase_price / it.purchase_qty : '');
    const remarks = [];
    if (!it.ingredient) { unmatched.push(it.item_name); remarks.push(`Receipt name "${it.item_name}" not matched to a known ingredient`); }
    return [
      formatDMY(date),
      it.ingredient || it.item_name,
      it.purchase_price,
      `${it.purchase_qty}${unit}`,
      costPerUnit === '' ? '' : Number(costPerUnit.toFixed(5)),
      extracted.shopped_at || '',
      remarks.join('; '),
    ];
  });

  const sum = items.reduce((s, it) => s + (Number(it.purchase_price) || 0), 0);
  if (extracted.receipt_total && Math.abs(sum - extracted.receipt_total) > 1) {
    flags.push(`Items add up to ${baht(sum)} but the receipt total reads ${baht(extracted.receipt_total)}. A line may be missing`);
  }

  await deps.appendExpenseRows(rows);

  const out = [`Receipt logged to the Expense Log: ${items.length} items, ${baht(sum)}${extracted.shopped_at ? `, ${extracted.shopped_at}` : ''}, ${formatDMY(date)}.`];
  if (unmatched.length) out.push(`Not matched to a known ingredient (so cost lookups will skip them until renamed): ${unmatched.slice(0, 8).join(', ')}`);
  if (flags.length) { out.push('Check:'); for (const f of flags.slice(0, 6)) out.push(`• ${f}`); }
  out.push('Copy these rows into the Price Log when you are happy with them.');
  return out.join('\n');
}

module.exports = { processNote, processReceipt, formatBatchReply, HELP };
