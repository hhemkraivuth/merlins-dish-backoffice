// Orchestrates what happens when a message lands in the back of house LINE group.
// All I/O is injected (deps) so the logic can be tested without Google or LINE.

const { parseNote, looksLikeAttempt } = require('./noteParser');
const { costBatch } = require('./costBatch');
const { parseDate, formatDMY, bangkokToday, bangkokNow } = require('./dates');
const { parsePurchaseUnit, normName, looseKey } = require('./priceBook');
const { parseTypedReceipt, looksLikeTypedReceipt, matchIngredient } = require('./typedReceipt');
const { splitOverheads, overheadRows } = require('./overheads');
const { toBaseQty } = require('./ingredientLots');
const { applyPackSize, isContainerWord } = require('./packSizes');
const { newReceiptId } = require('./receiptUndo');

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
  'Two steps: cooked now, packed later. Send the note without a yield and it is saved as an open batch:',
  '7/10',
  'Bolo',
  'Meat 1000',
  'When the portions are packed, send: bolo 7/10 yield 21 (stews: dbs 7/10 7r 4l portions). "open" lists batches waiting, "drop bolo 7/10" throws one away.',
  '',
  'Receipts: type them with a date, then one line per item with the quantity and price.',
  '18/10',
  'minced pork 1000g 110thb',
  'They go to the Expense Log and become stock lots. Batches use the oldest lot first.',
  '',
  'Stock lots: "lots" shows what is left. "opening 19/10" then lines like "minced pork 2000g 220thb" sets starting stock. "count minced pork 3000g" corrects a quantity. "low salt 500g" flags it when less is left, "low" lists what is low. "free 4/11" then "knorr cube 2 boxes of 6" adds free samples to stock (no purchase is logged).',
  'Bottle and can sizes: "size worcestershire sauce 290ml" so "2 bottles" is stored as 580ml. "undo noir ragu 6/10" takes a logged batch back out so you can send it again.',
  'Brand change: "swap bolo polpa > pelati" uses a different brand for that recipe line without editing the recipe tab (add "from 29/10" for batches from that date, "swaps" lists them, "unswap bolo polpa" takes one back).',
  'Waste: "waste bolo 2 burnt" (add a date first for an earlier day, "waste 8/11 ragu 1 dropped") logs thrown away portions at cost and takes them off remaining stock.',
  'R&D batch: put rd before the dish ("rd bolo" or "rd 14/11 bolo") and give the portions in the same note. It is costed like any batch and the ingredients come off stock, but it goes to the R&D Log, counts as R&D cost, and the portions never enter sellable stock.',
  'Dish words: bolo, ragu, tpb, rws, dbs, chix, brocs. Add more in the Shorthand tab.',
  '',
  'Stock: send "stock" to list counts, or "stock coke zero zero 5" to set one (full item name).',
  '',
  'Numbers: "huddle" for the daily team summary, "week" or "month" for income and costs, "sync" to pull in the latest LINE orders.',
  'Rider fee: "rider 001 55" logs what you paid the rider for LINE order #001 (add a date for another day, "rider 001,002 80" splits one trip evenly).',
].join('\n');

// How many packs a receipt line adds: "2pcs" or "3 bags" is that many, a weight alone ("salt 1000g") is one pack.
function packsOf(it) {
  if (it.eachWeight) return it.eachWeight.count;
  if (/^(pieces?|pcs?|p)$/.test(it.unit) || isContainerWord(it.unit)) return it.qty;
  return 1;
}

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

// Ingredient grams used by a batch come off the oldest stock lots. Only called once the batch is logged.
async function deductLots(result, key, lotBook, deps) {
  if (!lotBook || !deps.saveLots || !result.lotUse.length) return [];
  const now = bangkokNow();
  const usage = result.lotUse.map((u) => [key, formatDMY(result.date), u.name, u.lotId, formatDMY(u.lotDate), Math.round(u.qty * 1000) / 1000, Number(u.unitCost.toFixed(5)), Number(u.cost.toFixed(2)), now]);
  try {
    await deps.saveLots(lotBook, usage);
  } catch (err) {
    return [`The batch is logged, but the stock lots could not be updated (${err.message}). Send a count for: ${[...new Set(result.lotUse.map((u) => u.name))].join(', ')}.`];
  }
  const left = [...new Set(result.lotUse.map((u) => u.name))].map((n) => `${n} ${Math.round(lotBook.totalRemaining(n)).toLocaleString('en-AU')}${lotBook.lotsFor(n)[0].unit}`);
  return [`Stock left after this batch: ${left.join(', ')}`];
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

  // "7r 4l portions": the portion weights for Regular and Large come from the dish tab.
  if (batch.sizeCounts && batch.sizeCounts.length && !(batch.sizes && batch.sizes.length)) {
    const pw = recipe.portionWeights || {};
    const missing = batch.sizeCounts.filter((z) => !(pw[z.name] > 0));
    if (missing.length) extraFlags.push(`The ${batch.dishTab} tab has no ${missing.map((z) => z.name).join(' or ')} portion weight, so the sizes could not be priced. Send them like: regular 7 @ 380g.`);
    else {
      batch.sizes = batch.sizeCounts.map((z) => ({ name: z.name, count: z.count, weight: pw[z.name] }));
      extraFlags.push(`Portion weights taken from the tab: ${batch.sizes.map((z) => `${z.name} ${z.weight}g x ${z.count}`).join(', ')}.`);
    }
  }

  let lotBook = null;
  if (deps.loadLotBook) {
    try { lotBook = await deps.loadLotBook(); }
    catch (err) { extraFlags.push(`Stock lots could not be read (${err.message}), so latest prices were used.`); }
  }

  const result = costBatch({ batch, recipe, shorthand, priceBook, lotBook });
  result.flags.unshift(...extraFlags);
  result.rd = !!batch.rd;

  if (!result.yield) {
    return { status: 'nolog', result, text: formatBatchReply(result, batch.rd ? 'NOT logged. An R&D batch needs its portions in the same note, for example "rd bolo" then "yield 6". Send it again.' : 'NOT logged. Add the number of servings yielded and send it again.') };
  }

  const key = deps.batchKey(batch.dishTab, batch.date, result.yield, [...batch.lines, ...sizeKeyLines(batch), ...(batch.rd ? [{ token: 'rd', qty: 1 }] : [])]);
  if (await deps.isLogged(key)) {
    return { status: 'duplicate', result, key, text: `${result.dish}, ${formatDMY(result.date)}: this exact batch is already in the Cook Log. Nothing added.\nBatch ${baht(result.total)}, ${baht(result.perPortion)} per portion.` };
  }

  await deps.writeBatch(result, key, source);
  const stockLines = await deductPackaging(result, deps);
  stockLines.push(...await deductLots(result, key, lotBook, deps));
  if (batch.rd) {
    stockLines.unshift(`${result.yield} portions are not added to sellable stock. The ${baht(result.total)} counts as R&D cost.`);
    return { status: 'logged', result, key, text: formatBatchReply(result, 'R&D batch logged to the R&D Log.', stockLines).replace(/^/, 'R&D batch: ') };
  }
  return { status: 'logged', result, key, text: formatBatchReply(result, 'Logged to the Cook Log.', stockLines) };
}


// One batch from a note or the web form. Two step logging:
//   no portions yet  -> parked as an open batch (deps.openBatches), nothing costed or taken off stock
//   portions only    -> completes the matching open batch (by dish, and by date when a date was given)
//   anything else    -> logged straight away, as before
async function handleBatch(batch, deps, shorthand, priceBook, { today, source = 'LINE' } = {}) {
  const ob = deps.openBatches;
  const hasSizes = !!((batch.sizes && batch.sizes.length) || (batch.sizeCounts && batch.sizeCounts.length));
  const hasYield = !!batch.yield || hasSizes;
  const dateGiven = !!batch.date;
  if (!ob || batch.rd) return runBatch(batch, deps, shorthand, priceBook, { today, source });

  let open = null; let matches = []; let others = [];
  if (hasYield && !(batch.lines && batch.lines.length)) {
    try { ({ matches, others } = await ob.find(batch.dishTab, dateGiven ? batch.date : null)); }
    catch (err) { return { status: 'error', text: `I couldn't read the open batches (${err.message}), so nothing was logged for ${batch.dishTab}.` }; }
    open = matches[0] || null;
  }

  if (open) {
    const merged = ob.toBatch(open, {
      yield: batch.yield, sizeCounts: batch.sizeCounts || [], sizes: (batch.sizes && batch.sizes.length) ? batch.sizes : open.payload.sizes,
      cookedWeight: batch.cookedWeight || open.payload.cookedWeight,
    });
    const out = await runBatch(merged, deps, shorthand, priceBook, { today, source });
    if (out.status === 'logged' || out.status === 'duplicate') {
      try { await ob.remove(open.key); } catch (err) { out.text += `\nThe batch is logged, but I could not clear it from Open Batches (${err.message}). Send "drop ${batch.dishWord || batch.dishTab} ${formatDMY(open.date).slice(0, 5)}".`; }
    }
    out.text = `Completed the batch cooked on ${formatDMY(open.date)}.${matches.length > 1 ? ` ${matches.length} open ${batch.dishTab} batches matched, so I used the latest. Send "open" to see the rest.` : ''}\n${out.text}`;
    return out;
  }

  if (!hasYield) {
    const out = await runBatch(batch, deps, shorthand, priceBook, { today, source });
    if (out.status !== 'nolog') return out;
    let parked;
    try { parked = await ob.park(batch, { source }); }
    catch (err) { return { status: 'error', text: `I couldn't save the open batch (${err.message}). Nothing was logged.` }; }
    const word = batch.dishWord || batch.dishTab;
    const head = parked.status === 'same'
      ? 'This batch is already saved as an open batch. Nothing added.'
      : `Saved as an open batch, waiting for portions. Nothing is costed or taken off stock yet.\nWhen packed, send: ${word} ${formatDMY(batch.date).slice(0, 5)} yield 21${parked.sameDay ? `\n(${parked.sameDay + 1} open ${batch.dishTab} batches on this date, so send the date and I will use the latest.)` : ''}`;
    return { status: 'parked', result: out.result, key: parked.key, text: formatBatchReply(out.result, head).replace(/\nBatch .*per portion not calculated/, '\nIngredients so far are below, per portion comes with the yield.') };
  }

  const out = await runBatch(batch, deps, shorthand, priceBook, { today, source });
  if (others.length && hasYield && !(batch.lines && batch.lines.length)) {
    out.text += `\nNote: ${batch.dishTab} also has an open batch from ${others.map((o) => formatDMY(o.date)).join(', ')}. If you meant that one, send the date it was cooked.`;
  }
  return out;
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

  // A long note repeats dishes, and each recipe read counts against Google's per minute limit. Read each tab once.
  const recipes = new Map();
  const cached = { ...deps, loadRecipe: async (tab) => {
    if (!recipes.has(tab)) recipes.set(tab, await deps.loadRecipe(tab));
    return recipes.get(tab);
  } };

  let anyLogged = false;
  for (const batch of batches) {
    const out = await handleBatch(batch, cached, shorthand, priceBook, { today, source: 'LINE' });
    if (out.status === 'logged') anyLogged = true;
    replies.push(out.text);
  }
  if (anyLogged && deps.tidy) { try { await deps.tidy(); } catch (err) { console.error('tidy failed:', err.message); } }

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
  const receiptId = newReceiptId();
  // Overhead lines (pots, bags, knives) go to their own tab. Whatever is left is read as an ingredient receipt.
  const oh = splitOverheads(text, messageDate);
  if (!oh.found) return processIngredientReceipt(text, messageDate, deps, receiptId);
  if (!deps.appendOverheads) return ['Overheads are not set up on this server yet.'];
  const replies = [];
  // Dollar prices are kept as dollars. The baht is that day's conversion, written in the Remarks beside the dollar amount.
  if (oh.items.some((it) => it.usd)) {
    const info = deps.usdRate ? await deps.usdRate() : null;
    if (!info) {
      const lost = oh.items.filter((it) => it.usd).map((it) => it.name);
      oh.items = oh.items.filter((it) => !it.usd);
      oh.problems.push(`Couldn't get today's USD rate, so ${lost.join(', ')} was not logged. Send it again in a few minutes, or type the baht price`);
    } else {
      for (const it of oh.items) if (it.usd) { it.rate = info.rate; it.price = Math.round(it.usd * info.rate * 100) / 100; }
    }
  }
  if (oh.items.length) {
    await deps.appendOverheads(overheadRows(oh.items, receiptId, deps.typedVia));
    const repeats = oh.items.filter((it) => it.repeat);
    if (repeats.length && deps.addRecurring) {
      for (const it of repeats) await deps.addRecurring({ name: it.name, category: it.category, shop: it.shop, usd: it.usd, thb: it.usd ? null : it.price }, it.date);
    }
    const byDate = new Map();
    for (const it of oh.items) {
      const d = `${formatDMY(it.date)}${it.shop ? `, ${it.shop}` : ''}${it.category ? `, ${it.category}` : ''}`;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(`• ${it.name}, ${baht(it.price)}`);
    }
    const adItems = oh.items.filter((it) => it.ads); const ohItems = oh.items.filter((it) => !it.ads);
    const sum = (a) => baht(a.reduce((s, it) => s + it.price, 0));
    const out = [];
    if (ohItems.length) out.push(`Overheads logged: ${ohItems.length} item${ohItems.length === 1 ? '' : 's'}, ${sum(ohItems)}. Counted as spending in the margin, not as food cost, and not taken off stock.`);
    if (adItems.length) out.push(`Ads logged: ${adItems.length} item${adItems.length === 1 ? '' : 's'}, ${sum(adItems)}. Shown in the Ads column and taken off the margin.`);
    for (const [d, lines] of byDate) { out.push(d); out.push(...lines); }
    if (oh.undated) out.push(`No date line above some items, so I used ${formatDMY(messageDate)}.`);
    if (repeats.length) out.push(`Repeats on the 1st of every month: ${repeats.map((it) => `${it.name} ${it.usd ? `USD ${it.usd.toFixed(2)} (baht worked out each month at that day's rate)` : baht(it.price)}`).join(', ')}. Stop it on the Receipts page, under Monthly overheads.`);
    out.push(`Receipt ${receiptId}. If this was a mistake, send: undo receipt`);
    replies.push(out.join('\n'));
  }
  if (oh.problems.length) replies.push(`Couldn't use these lines:\n${oh.problems.slice(0, 6).map((p) => `• ${p}`).join('\n')}`);
  const food = await processIngredientReceipt(oh.rest, messageDate, deps, receiptId);
  if (food) replies.push(...food);
  return replies.length ? replies : ['I saw "overhead" but no item lines. Write it like:\n13/10\nat paragon\noverhead\npot 7lt, 2575thb'];
}

async function processIngredientReceipt(text, messageDate, deps, receiptId = newReceiptId()) {
  // A stray word like "ingredients" or "food" on its own line is a heading, not an item.
  text = String(text || '').split(/\r?\n/).filter((l) => !/^\s*(ingredients?|food|groceries)\s*:?\s*$/i.test(l)).join('\n');
  if (!looksLikeTypedReceipt(text)) return null;
  // A line saying "prices only" logs the prices (for costing past batches) without adding stock lots.
  const parsed = parseTypedReceipt(text, messageDate);
  const { problems, undated } = parsed;
  let items = parsed.items;
  if (!items.length) return [`I couldn't read any item lines.\n${problems.slice(0, 6).map((p) => `• ${p}`).join('\n')}`];

  let catalogue = [];
  try { catalogue = await deps.loadCatalogue(); } catch (err) { /* names stay as typed, flagged below */ }

  // Short names Lily saved ("alias en ziero = EN Ziero - Golden Apple and Yuzu") turn into the full name before matching.
  if (deps.loadAliases) {
    try {
      const aliases = await deps.loadAliases();
      for (const it of items) {
        const full = aliases.get(String(it.typedName || '').toLowerCase().replace(/\s+/g, ''));
        if (full) { it.aliasOf = it.typedName; it.typedName = full; }
      }
    } catch (err) { /* aliases are optional */ }
  }

  const flags = [];
  if (undated) flags.push(`No date line above some items, so I used the day you sent it (${formatDMY(messageDate)})`);

  // "2 bottles" becomes the real amount when the ingredient has a size in the Pack Sizes tab (2 x 290ml = 580ml).
  let sizes = null;
  if (deps.loadPackSizes) { try { sizes = await deps.loadPackSizes(); } catch (err) { flags.push(`The Pack Sizes tab could not be read (${err.message}), so bottle and can sizes were not applied.`); } }
  let priceBook = null;
  if (deps.loadPriceBook) { try { priceBook = await deps.loadPriceBook(); } catch (err) { /* the guard below is skipped */ } }
  let units = null;   // recipe unit per ingredient (g, ml or piece) from the Price Tracker
  if (deps.loadUnits) { try { units = await deps.loadUnits(); } catch (err) { /* falls back to the price book */ } }

  const held = [];
  items = items.filter((it) => {
    const name = matchIngredient(it.typedName, catalogue).name;
    if (!name) return true;
    if (it.eachWeight) {
      // The size in the line is the size of ONE container. Count the pieces when the recipe counts that item in pieces
      // (Knorr cube 20g x 48), otherwise use the total weight or volume (pecorino 60g x 2, worcestershire 290ml x 8).
      let recipeUnit = units && units.get(normName(name));
      if (!recipeUnit && priceBook) { const prev = priceBook.lookup(name, it.date || messageDate); recipeUnit = prev && prev.unit; }
      if (recipeUnit === 'piece') {
        const ew = it.eachWeight;
        it.purchaseUnit = `${ew.count}pcs`;
        it.costPerUnit = Number((it.price / ew.count).toFixed(5));
        it.assumed = `counted as ${ew.count} pieces (the ${ew.text} is the size of one), because the recipe counts it in pieces`;
      }
    }
    // A kilo guess ("0.90g" read as 900g) that lands far from the last price is probably a dropped zero (90g). Use the closer reading and say so.
    if (it.kiloGuess && priceBook) {
      const prev = priceBook.lookup(name, it.date || messageDate);
      const pu = parsePurchaseUnit(it.purchaseUnit);
      if (prev && prev.cost > 0 && pu && pu.unit === 'g' && it.costPerUnit / prev.cost <= 0.2) {
        const altQty = pu.qty / 10;
        const altCost = it.price / altQty;
        if (altCost / prev.cost >= 0.5 && altCost / prev.cost <= 2) {   // ten times lighter fits the last price
          it.assumed = `${it.assumed}. ${pu.qty}g would be ${baht(it.costPerUnit)} per g, far from the last price of ${baht(prev.cost)} per g, so I used ${altQty}g (${baht(altCost)} per g)`;
          it.purchaseUnit = `${altQty}g`;
          it.costPerUnit = Number(altCost.toFixed(5));
        }
      }
    }
    const conv = applyPackSize(it, name, sizes);
    if (conv) { it.purchaseUnit = conv.purchaseUnit; it.costPerUnit = conv.costPerUnit; it.pack = conv.pack; return true; }
    // A container with no known size whose price is wildly different from past prices is held back, not logged wrongly.
    if (priceBook && isContainerWord(it.unit)) {
      const prev = priceBook.lookup(name, it.date || messageDate);
      if (prev && prev.cost > 0 && (it.costPerUnit / prev.cost >= 20 || it.costPerUnit / prev.cost <= 0.05)) {
        held.push(`${name} ${it.qty} ${it.unit}: I need the size of one ${String(it.unit).replace(/s$/, '')}. Send "size ${name.toLowerCase()} 290ml" (with the real size), then send this line again.`);
        return false;
      }
    }
    return true;
  });
  if (!items.length) return [`Nothing was logged.\n${held.map((h) => `• ${h}`).join('\n')}`];
  if (held.length) flags.push(...held.map((h) => `Not logged, ${h}`));

  const unmatched = [];
  const rows = items.map((it) => {
    const date = it.date || messageDate;
    const m = matchIngredient(it.typedName, catalogue);
    const remarks = [deps.typedVia || 'Typed in LINE', `Receipt ${receiptId}`];
    if (m.fuzzy) { it.spelled = `${it.typedName} → ${m.name}`; remarks.push(`read "${it.typedName}" as ${m.name}`); }
    if (!m.name) {
      unmatched.push(m.ambiguous ? `${it.typedName} (could be ${m.ambiguous.join(' or ')})` : it.typedName);
      remarks.push(`"${it.typedName}" not matched to a known ingredient`);
    }
    if (it.brand) remarks.push(`Brand: ${it.brand}`);
    if (it.assumed) remarks.push(it.assumed);
    return [formatDMY(date), m.name || it.typedName, it.price, it.purchaseUnit, it.costPerUnit, it.shop || '', remarks.join('; ')];
  });

  await deps.appendExpenseRows(rows);
  if (deps.refreshBestPrices) { try { await deps.refreshBestPrices(); } catch (err) { flags.push(`The Best Prices tab could not be updated (${err.message}).`); } }

  // Stock lots: every matched, countable ingredient becomes a lot (condiments on the Untracked list do not).
  const lotLines = [];
  const notTracked = [];
  const packJobs = [];
  const packLines = [];
  if (deps.addLots) {
    let untracked = [];
    try { untracked = deps.loadUntracked ? await deps.loadUntracked() : []; } catch (err) { /* treated as none */ }
    const skip = new Set(untracked.map(looseKey));
    const toAdd = [];
    items.forEach((it, i) => {
      if (it.pricesOnly) return;
      const name = rows[i][1];
      const matched = matchIngredient(it.typedName, catalogue).name;
      if (!matched) return;
      if (skip.has(looseKey(name))) { notTracked.push(name); packJobs.push({ name, packs: packsOf(it) }); return; }
      const base = toBaseQty(it.purchaseUnit);
      if (!base) return;
      toAdd.push({ date: it.date || messageDate, name, qty: base.qty, unit: base.unit, price: it.price, source: 'Receipt', note: [it.shop, receiptId].filter(Boolean).join(' ') });
      lotLines.push(`${name} ${Math.round(base.qty * 100) / 100}${base.unit}`);
    });
    // Condiments are counted in unopened packs, not grams. A pack bought goes onto the count if that item is already counted.
    if (deps.adjustPacks) {
      for (const job of packJobs) {
        try {
          const r = await deps.adjustPacks(job.name, job.packs);
          packLines.push(r.found ? `${job.name} +${job.packs} (now ${r.now})` : `${job.name} is not counted yet. To start, send: stock add ${job.name}, pack, <unopened packs you have>`);
        } catch (err) { flags.push(`Pack count for ${job.name} could not be updated (${err.message}).`); }
      }
    }
    try { await deps.addLots(toAdd); }
    catch (err) { lotLines.length = 0; flags.push(`The receipt is in the Expense Log, but the stock lots could not be added (${err.message}).`); }
  }

  const byDate = new Map();
  items.forEach((it, i) => {
    const d = `${formatDMY(it.date || messageDate)}${it.shop ? `, ${it.shop}` : ''}`;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(`• ${rows[i][1]}${it.brand ? ` (${it.brand})` : ''} ${it.purchaseUnit}${it.pack ? ` (${it.pack})` : ''}, ${baht(it.price)}`);
  });
  const total = items.reduce((s, it) => s + it.price, 0);

  const out = [`Logged to the Expense Log: ${items.length} item${items.length === 1 ? '' : 's'}, ${baht(total)}.`];
  for (const [d, lines] of byDate) { out.push(d); out.push(...lines); }
  out.push(`Receipt ${receiptId}. If this was a mistake, send: undo receipt`);
  const replies = [out.join('\n')];
  const po = items.filter((it) => it.pricesOnly).length;
  if (po) replies.push(`Prices only: no stock lots were added for ${po === items.length ? 'these items' : `${po} of the ${items.length} items`}.`);
  if (lotLines.length) replies.push(`Added to stock lots: ${lotLines.join(', ')}.${notTracked.length ? `\nNot stock tracked (condiments): ${notTracked.join(', ')}.` : ''}`);
  else if (notTracked.length) replies.push(`Not stock tracked (condiments): ${notTracked.join(', ')}.`);
  if (unmatched.length) replies.push(`Not matched to a known ingredient, so cost lookups will skip these until the name matches the Price Tracker:\n${unmatched.slice(0, 8).map((u) => `• ${u}`).join('\n')}`);
  if (packLines.length) replies.push(`Unopened packs:\n${packLines.map((l) => `• ${l}`).join('\n')}`);
  const spelled = items.filter((it) => it.spelled);
  if (spelled.length) replies.push(`I corrected the spelling:\n${spelled.map((it) => `• ${it.spelled}`).join('\n')}\nIf one is wrong, tell me and I will fix the row.`);
  const assumed = items.filter((it) => it.assumed);
  if (assumed.length) replies.push(`I made a guess on the weights, please check:\n${assumed.map((it) => `• ${it.typedName}: ${it.assumed}. Now ${baht(it.costPerUnit)} per ${(parsePurchaseUnit(it.purchaseUnit) || {}).unit || 'unit'}.`).join('\n')}\nIf that is wrong, send the line again with the weight in plain grams, for example 90g.`);
  if (flags.length) replies.push(`Check:\n${flags.map((f) => `• ${f}`).join('\n')}`);
  if (problems.length) replies.push(`Couldn't use these lines:\n${problems.slice(0, 6).map((p) => `• ${p}`).join('\n')}`);
  return replies;
}

module.exports = { processNote, processReceipt, processTypedReceipt, runBatch, handleBatch, formatBatchReply, HELP };
