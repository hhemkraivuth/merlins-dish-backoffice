// Orchestrates what happens when a message lands in the back of house LINE group.
// All I/O is injected (deps) so the logic can be tested without Google or LINE.

const { parseNote, looksLikeAttempt } = require('./noteParser');
const { costBatch } = require('./costBatch');
const { parseDate, formatDMY, bangkokToday } = require('./dates');
const { parsePurchaseUnit } = require('./priceBook');
const { parseTypedReceipt, looksLikeTypedReceipt, matchIngredient } = require('./typedReceipt');

const baht = (n) => `฿${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const HELP = [
  'Send a cook note like this:',
  '7/10',
  'Bolo',
  'Meat 1000',
  'O 446',
  'yield 21',
  '',
  'Ingredients you leave out stay at the recipe quantity.',
  '',
  'Receipts: type them with a date, then one line per item with the quantity and price.',
  '18/10',
  'minced pork 1000g 110thb',
  'They go to the Expense Log and are used for any batch cooked on or after that date.',
  'Dish words: bolo, ragu, tpb, rws, dbs, chix, brocs. Add more in the Shorthand tab.',
  '',
  'Stock: send "stock" to list counts, or "stock coke zero zero 5" to set one (full item name).',
].join('\n');

function formatBatchReply(r, status, extraLines = []) {
  const out = [];
  out.push(`${r.dish}, ${formatDMY(r.date)}${r.yield ? `, ${r.yield} serves` : ''}`);
  if (r.perPortion !== null) {
    out.push(`Batch ${baht(r.total)}, ${baht(r.perPortion)} per portion${r.foodCostPct !== null ? `, food cost ${r.foodCostPct}%` : ''}`);
  } else {
    out.push(`Batch ${baht(r.total)}, per portion not calculated`);
  }
  out.push(`Ingredients ${baht(r.ingredientCost)}, packaging ${baht(r.packagingCost)}, utilities ${baht(r.utilityCost)}`);
  if (r.sizes) for (const z of r.sizes) out.push(`${z.name} ${z.weight}g x ${z.count}: ${baht(z.costPerPortion)} per portion`);
  for (const n of r.notes) out.push(n);
  out.push(status);
  for (const l of extraLines) out.push(l);
  if (r.flags.length) {
    out.push('');
    out.push('Check:');
    for (const f of r.flags.slice(0, 8)) out.push(`• ${f}`);
    if (r.flags.length > 8) out.push(`• plus ${r.flags.length - 8} more in the Cook Log`);
  }
  return out.join('\n');
}

const sizeKeyLines = (b) => (b.sizes || []).map((z) => ({ token: `size:${z.name}@${z.weight}`, qty: z.count }));

// Packaging used by a batch comes off the Stock Counts. Nothing is silent: every outcome is reported.
async function deductPackaging(result, deps) {
  if (!deps.deductStock) return [];
  const done = [];
  const negative = [];
  const untracked = [];
  for (const l of result.lines.filter((x) => x.type === 'Packaging')) {
    try {
      const r = await deps.deductStock(l.name, l.qty);
      if (!r.deducted) untracked.push(l.name);
      else {
        done.push(`${l.name} ${r.newCount + l.qty} to ${r.newCount}`);
        if (r.wentNegative) negative.push(l.name);
      }
    } catch (err) {
      untracked.push(`${l.name} (${err.message})`);
    }
  }
  const out = [];
  if (done.length) out.push(`Stock used: ${done.join(', ')}`);
  if (negative.length) out.push(`Stock went negative, please recount: ${negative.join(', ')}`);
  if (untracked.length) out.push(`Not taken off Stock Counts (not tracked there): ${untracked.join(', ')}`);
  return out;
}

// Costs one parsed batch and logs it. Shared by the LINE note and the web form.
// Returns { status: 'logged' | 'duplicate' | 'nolog' | 'error', text, result?, key? }
async function runBatch(batch, deps, shorthand, priceBook, { today, source = 'LINE' } = {}) {
  const extraFlags = [];
  if (!batch.date) { batch.date = today || bangkokToday(); extraFlags.push('No date in the note, so I used today.'); }

  let recipe;
  try {
    recipe = await deps.loadRecipe(batch.dishTab);
  } catch (err) {
    return { status: 'error', text: `Couldn't read the "${batch.dishTab}" tab from Merlin's numbers (${err.message}). Nothing was logged for it.` };
  }
  if (!recipe.ingredients.length) {
    return { status: 'error', text: `The "${batch.dishTab}" tab has no ingredient lines I can read. Nothing was logged for it.` };
  }

  const result = costBatch({ batch, recipe, shorthand, priceBook });
  result.flags.unshift(...extraFlags);

  if (!result.yield) {
    return { status: 'nolog', result, text: formatBatchReply(result, 'NOT logged. Add the number of servings yielded and send it again.') };
  }

  const key = deps.batchKey(batch.dishTab, batch.date, result.yield, [...batch.lines, ...sizeKeyLines(batch)]);
  if (await deps.isLogged(key)) {
    return { status: 'duplicate', result, key, text: `${result.dish}, ${formatDMY(result.date)}: this exact batch is already in the Cook Log. Nothing added.\nBatch ${baht(result.total)}, ${baht(result.perPortion)} per portion.` };
  }

  await deps.writeBatch(result, key, source);
  const stockLines = await deductPackaging(result, deps);
  return { status: 'logged', result, key, text: formatBatchReply(result, 'Logged to the Cook Log.', stockLines) };
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
    const out = await runBatch(batch, deps, shorthand, priceBook, { today, source: 'LINE' });
    replies.push(out.text);
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

// Receipts typed in the group: a date line, then "name qty price" lines, e.g. "minced pork 1000g 110thb".
// deps: { loadCatalogue(), appendExpenseRows(rows) }. Returns an array of replies, or null when the text is not a typed receipt.
async function processTypedReceipt(text, messageDate, deps) {
  if (!looksLikeTypedReceipt(text)) return null;
  const { items, problems, undated } = parseTypedReceipt(text, messageDate);
  if (!items.length) return [`I couldn't read any item lines.\n${problems.slice(0, 6).map((p) => `• ${p}`).join('\n')}`];

  let catalogue = [];
  try { catalogue = await deps.loadCatalogue(); } catch (err) { /* names stay as typed, flagged below */ }

  const flags = [];
  if (undated) flags.push(`No date line above some items, so I used the day you sent it (${formatDMY(messageDate)})`);

  const unmatched = [];
  const rows = items.map((it) => {
    const date = it.date || messageDate;
    const m = matchIngredient(it.typedName, catalogue);
    const remarks = ['Typed in LINE'];
    if (!m.name) {
      unmatched.push(m.ambiguous ? `${it.typedName} (could be ${m.ambiguous.join(' or ')})` : it.typedName);
      remarks.push(`"${it.typedName}" not matched to a known ingredient`);
    }
    return [formatDMY(date), m.name || it.typedName, it.price, it.purchaseUnit, it.costPerUnit, '', remarks.join('; ')];
  });

  await deps.appendExpenseRows(rows);

  const byDate = new Map();
  items.forEach((it, i) => {
    const d = formatDMY(it.date || messageDate);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(`• ${rows[i][1]} ${it.purchaseUnit}, ${baht(it.price)}`);
  });
  const total = items.reduce((s, it) => s + it.price, 0);

  const out = [`Logged to the Expense Log: ${items.length} item${items.length === 1 ? '' : 's'}, ${baht(total)}.`];
  for (const [d, lines] of byDate) { out.push(d); out.push(...lines); }
  const replies = [out.join('\n')];
  if (unmatched.length) replies.push(`Not matched to a known ingredient, so cost lookups will skip these until the name matches the Price Tracker:\n${unmatched.slice(0, 8).map((u) => `• ${u}`).join('\n')}`);
  if (flags.length) replies.push(`Check:\n${flags.map((f) => `• ${f}`).join('\n')}`);
  if (problems.length) replies.push(`Couldn't use these lines:\n${problems.slice(0, 6).map((p) => `• ${p}`).join('\n')}`);
  return replies;
}

module.exports = { processNote, processReceipt, processTypedReceipt, runBatch, formatBatchReply, HELP };
