const { getAllStock, setStockCount, editStock } = require('../lib/stockCounts');

async function listStock(req, res) {
  try {
    const ls = require('../lib/lowStock');
    const { bangkokToday } = require('../lib/dates');
    const stock = await getAllStock();
    const { brands, sizes } = await loadMeta();
    const usage = await ls.loadUsage(bangkokToday()).catch(() => null);
    const bagMap = await require('../lib/stockBags').load().catch(() => ({}));
    const categories = await require('../lib/stockCounts').loadCategories();
    res.json({ categories, stock: stock.map((i) => {
      const category = i.category || i.guess || '';
      const days = ls.daysLeft({ name: i.itemName, count: i.currentCount, unit: i.unit, usage });
      const nk = normKey(i.itemName); const sz = sizes[nk] || {};
      const bg = bagMap[nk]; const batch = bg && bg.batch > 0 ? bg.batch : null;
      return { ...i, brand: brands[nk] || '', size: sz.size || null, sizeUnit: sz.unit || '', daysLeft: days === null ? null : Math.round(days), bags: bg ? bg.bags : null, batch, red: ls.statusOf({ count: i.currentCount, days, category, belowBatch: Boolean(batch && i.currentCount < batch) }) };
    }), redDays: ls.RED_DAYS });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

async function updateStock(req, res) {
  try {
    const { itemName, newCount, unit, category } = req.body;
    if (!itemName || newCount == null) {
      return res.status(400).json({ error: 'itemName and newCount are required' });
    }
    const result = await setStockCount(itemName, Number(newCount), unit, 'Manual', category);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

async function editStockRoute(req, res) {
  try {
    const b = req.body || {};
    if (!b.oldName) return res.status(400).json({ error: 'oldName is required' });
    res.json(await editStock(b));
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
}

async function seedPackagingRoute(req, res) {
  try {
    const { seedPackaging } = require('../lib/stockService');
    res.json(await seedPackaging({ getAll: getAllStock, setCount: setStockCount }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// Ingredient stock from the receipts (the stock lots). Counts are corrected from LINE with "count" or from the Stock page in packs.
// Used up ingredients stay in the list at 0 so they show red.
async function listIngredientStock(req, res) {
  try {
    const ls = require('../lib/lowStock');
    const { bangkokToday } = require('../lib/dates');
    const { guessCategory, CATEGORIES } = require('../lib/stockCounts');
    const { normName } = require('../lib/priceBook');
    const usage = await ls.loadUsage(bangkokToday()).catch(() => null);
    const items = await ls.ingredientStockItems(usage);
    let over = {};
    try { over = JSON.parse((await require('../lib/appState').getState(CAT_KEY)) || '{}'); } catch (err) { /* no overrides */ }
    let brands = {};
    try { brands = JSON.parse((await require('../lib/appState').getState(BRAND_KEY)) || '{}'); } catch (err) { /* no brands yet */ }
    const dmy = (d) => { if (!d) return ''; const t = d instanceof Date ? d.toISOString().slice(0, 10) : String(d || ''); const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : t; };
    res.json({ items: items.map((i) => {
      const category = CATEGORIES.includes(over[normName(i.name)]) ? over[normName(i.name)] : (guessCategory(i.name) || 'Ingredients');
      return { ...i, oldest: dmy(i.oldest), category, brand: brands[normName(i.name)] || '', daysLeft: i.daysLeft === null || i.daysLeft === undefined ? null : Math.round(i.daysLeft), red: ls.statusOf({ count: i.left, days: i.daysLeft, category: 'Ingredients', low: i.low }) };
    }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

const normKey = (n) => require('../lib/priceBook').normName(n);
const SIZE_KEY = 'stock_item_sizes';
async function loadMeta() {
  const st = require('../lib/appState'); const out = { brands: {}, sizes: {} };
  try { out.brands = JSON.parse((await st.getState('stock_item_brands')) || '{}'); } catch (err) { /* none yet */ }
  try { out.sizes = JSON.parse((await st.getState(SIZE_KEY)) || '{}'); } catch (err) { /* none yet */ }
  return out;
}
// Brand and "how much is in one can, bottle, tin" for a counted stock item (coke, wine, packaging...). Ingredients keep their pack size in the lots.
async function setItemMeta(req, res) {
  try {
    const { name, oldName, brand, size, unit } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Send the item name.' });
    const st = require('../lib/appState'); const { brands, sizes } = await loadMeta();
    const k = normKey(name);
    if (oldName && normKey(oldName) !== k) { delete brands[normKey(oldName)]; delete sizes[normKey(oldName)]; }
    const b = String(brand || '').trim().slice(0, 60);
    if (b) brands[k] = b; else delete brands[k];
    const n = Number(size);
    if (Number.isFinite(n) && n > 0 && ['ml', 'g', 'L', 'kg'].includes(unit)) sizes[k] = { size: n, unit }; else delete sizes[k];
    await st.setState('stock_item_brands', JSON.stringify(brands)); await st.setState(SIZE_KEY, JSON.stringify(sizes));
    res.json({ name, brand: b, size: sizes[k] || null });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}

// The brand we buy for an ingredient (Stout: Chiangmai Winter). A label for the team only: recipes and costs never change.
const BRAND_KEY = 'stock_item_brands';
async function setIngredientBrand(req, res) {
  try {
    const { name, brand } = req.body || {};
    const { normName } = require('../lib/priceBook');
    if (!name) return res.status(400).json({ error: 'Send the ingredient name.' });
    const st = require('../lib/appState');
    let all = {};
    try { all = JSON.parse((await st.getState(BRAND_KEY)) || '{}'); } catch (err) { all = {}; }
    const b = String(brand || '').trim().slice(0, 60);
    if (b) all[normName(name)] = b; else delete all[normName(name)];
    await st.setState(BRAND_KEY, JSON.stringify(all));
    res.json({ name, brand: b });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}

// Moves a receipt based ingredient (a row built from the stock lots) to another category. Remembered in App State.
const CAT_KEY = 'stock_item_categories';
async function setIngredientCategory(req, res) {
  try {
    const { name, category } = req.body || {};
    const { CATEGORIES } = require('../lib/stockCounts');
    const { normName } = require('../lib/priceBook');
    if (!name || !CATEGORIES.includes(category)) return res.status(400).json({ error: 'Send the ingredient name and one of ' + CATEGORIES.join(', ') + '.' });
    const st = require('../lib/appState');
    let over = {};
    try { over = JSON.parse((await st.getState(CAT_KEY)) || '{}'); } catch (err) { over = {}; }
    over[normName(name)] = category;
    await st.setState(CAT_KEY, JSON.stringify(over));
    res.json({ name, category });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}

// Blends: one recipe ingredient made of two or more stocked ingredients in fixed parts.
async function listBlends(req, res) {
  try {
    const m = await require('../lib/blends').loadBlends();
    res.json({ blends: [...m.values()].map((b) => ({ name: b.name, parts: b.parts.map((p) => ({ name: p.name, parts: p.parts, share: Math.round(p.share * 1000) / 10 })) })) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}
async function saveBlendRoute(req, res) {
  try {
    const b = req.body || {};
    res.json(await require('../lib/blends').saveBlend(b.name, b.parts));
  } catch (err) { console.error(err); res.status(400).json({ error: err.message }); }
}
async function deleteBlendRoute(req, res) {
  try {
    await require('../lib/blends').deleteBlend((req.body || {}).name);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(400).json({ error: err.message }); }
}

// Recount one ingredient in packs (cans, bags, bottles). Same correction as "count" in LINE, but typed as a pack number.
// Body: { name, packs, size?, word? }. size ("330ml") and word ("can") are only needed the first time, and are saved to Pack Sizes.
async function countIngredientPacks(req, res) {
  try {
    const { name, packs, size, word, base } = req.body || {};
    const n = Number(packs);
    if (!name || (base == null && (!Number.isFinite(n) || n < 0))) return res.status(400).json({ error: 'Send the ingredient name and a pack count of zero or more.' });
    const { bangkokToday } = require('../lib/dates');
    const lots = require('../lib/ingredientLots');
    const { normName } = require('../lib/priceBook');
    const ps = require('../lib/packSizes');
    const today = bangkokToday();
    const book = await lots.loadLotBook(today);
    const have = book.lotsFor(name);
    if (!have.length) return res.status(400).json({ error: `${name} has no stock lots yet.` });
    const unit = have[0].unit;
    if (base != null) {
      const b = Number(base);
      if (!Number.isFinite(b) || b < 0) return res.status(400).json({ error: `Send ${unit} as a number of zero or more.` });
      const r0 = book.countTo(name, b, today);
      await lots.saveLotBook(book, []);
      return res.json({ name: r0.name, before: r0.before, after: r0.after, unit: r0.unit });
    }
    let entry = (await ps.loadPackSizes()).get(normName(name));
    if (size) {
      const base = lots.toBaseQty(String(size).replace(/\s+/g, ''));
      if (!base || base.unit !== unit) return res.status(400).json({ error: `${name} is counted in ${unit}, so the size of one pack needs to be in ${unit}, for example 330${unit}.` });
      const w = String(word || '').trim().toLowerCase().replace(/[^a-z]/g, '') || 'pack';
      await ps.setPackSize(name, `${base.qty}${base.unit}`, w);
      entry = { name, qty: base.qty, unit: base.unit, text: `${base.qty}${base.unit}`, word: w };
    }
    if (!entry) return res.status(400).json({ error: 'Set the size of one pack first, for example 330ml and the word can.' });
    if (entry.unit !== unit) return res.status(400).json({ error: `${name} is counted in ${unit} but its pack size is in ${entry.unit}.` });
    const r = book.countTo(name, ps.packsToBase(n, entry), today);
    await lots.saveLotBook(book, []);
    res.json({ name: r.name, before: r.before, after: r.after, unit: r.unit, pack: ps.packView(r.after, r.unit, entry) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// Bagged meat: the item is counted in grams and its bags are a list under it. Saving bags sets the count to their total.
async function saveBags(req, res) {
  try {
    const bagsLib = require('../lib/stockBags'); const sc = require('../lib/stockCounts');
    const { name, bags, batch, category, unit } = req.body || {};
    const u = String(unit || '').toLowerCase() === 'pcs' ? 'pcs' : 'g';
    const nm = String(name || '').trim();
    if (!nm) return res.status(400).json({ error: 'Send the item name.' });
    const list = bagsLib.parseBags(bags); const map = await bagsLib.load(); const k = normKey(nm);
    const b = Number(batch);
    map[k] = { bags: list, unit: unit ? u : (map[k] && map[k].unit) || 'g', batch: Number.isFinite(b) && b > 0 ? b : (map[k] && map[k].batch) || 0 };
    await bagsLib.saveAll(map);
    const existing = await sc.findStockRow(nm);
    await sc.setStockCount(nm, bagsLib.total(list), map[k].unit, 'Manual', category || (existing && existing.category) || 'Meat', true);
    res.json({ name: nm, bags: list, total: bagsLib.total(list), batch: map[k].batch, unit: map[k].unit });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}
async function suggestBags(req, res) {
  try {
    const bagsLib = require('../lib/stockBags'); const { name, batch } = req.body || {};
    const map = await bagsLib.load(); const e = map[normKey(name)];
    if (!e) return res.status(404).json({ error: 'That item has no bags yet.' });
    res.json({ name, batch: Number(batch) > 0 ? Number(batch) : e.batch, ...bagsLib.suggest(e.bags, Number(batch) > 0 ? Number(batch) : e.batch) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}
async function addCategoryRoute(req, res) {
  try { const name = await require('../lib/stockCounts').addCategory((req.body || {}).name); res.json({ name, categories: await require('../lib/stockCounts').loadCategories() }); }
  catch (err) { res.status(400).json({ error: err.message }); }
}
// Once only: creates the bagged meat items in the Meat category and folds old rows like "Brisket 1,400g" into the bags.
const MEAT = [['Brisket', 1600], ['Chuck', 0], ['Chicken thigh', 0], ['Pork mince', 0], ['Pork shoulder', 0], ['Bacon steak', 0], ['Bacon slice', 0]];
async function seedMeat(req, res) {
  try {
    const bagsLib = require('../lib/stockBags'); const sc = require('../lib/stockCounts'); const st = require('../lib/appState');
    if (await st.getState('meat_seeded_v2') && !(req.body || {}).force) return res.json({ already: true });
    const { deleteRowsWhere } = require('../lib/sheets');
    const map = await bagsLib.load(); const all = await sc.getAllStock(); const moved = [];
    const canon = (t) => String(t || '').toLowerCase().replace(/\bminced\b/g, 'mince').replace(/\s+/g, ' ').trim();
    // An old row looks like "Pork shoulder 1,000g" with a count of 2 (two bags of 1,000 g) or "Chicken thigh 3pcs" with a count of 1.
    const OLD = /^(.*?)\s+(\d[\d,]*(?:\.\d+)?)\s*(kg|g|pcs|pc|pieces|piece)\b\s*$/i;
    const found = {};
    for (const r of all) {
      const m = OLD.exec(String(r.itemName || '').trim());
      if (!m) continue;
      const base = canon(m[1]); const meat = MEAT.find((x) => canon(x[0]) === base);
      if (!meat) continue;
      let w = Number(m[2].replace(/,/g, '')); const u = m[3].toLowerCase();
      const unit = u.startsWith('p') ? 'pcs' : 'g'; if (u === 'kg') w *= 1000;
      const n = Math.max(1, Math.round(Number(r.currentCount) || 1));
      (found[meat[0]] = found[meat[0]] || { unit, bags: [] }).bags.push(...Array(n).fill(w));
      moved.push(r.itemName);
    }
    for (const [nm, batch] of MEAT) {
      const k = normKey(nm); const cur = map[k] || { bags: [], batch: 0 };
      const add = found[nm];
      const bags = [...(cur.bags || []), ...(add ? add.bags : [])];
      map[k] = { bags, unit: (add && add.unit) || cur.unit || 'g', batch: cur.batch || batch || 0 };
      await sc.setStockCount(nm, bagsLib.total(bags), map[k].unit, 'Manual', 'Meat');
    }
    if (moved.length) { const set = new Set(moved.map((m) => m.toLowerCase())); await deleteRowsWhere(sc.STOCK_COUNTS_TAB, (r) => set.has(String(r[0] || '').toLowerCase())); }
    await bagsLib.saveAll(map); await st.setState('meat_seeded_v2', '1');
    res.json({ created: MEAT.map((m) => m[0]), moved });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}


// ---- Purchases (stock lots) for one ingredient: every buy with its date, brand and price, used oldest first ----
const brandOfLot = (l) => l.note || ((String(l.name).match(/\(([^)]*)\)/) || [])[1] || '');
async function ingredientLots(req, res) {
  try {
    const { bangkokToday, formatDMY } = require('../lib/dates');
    const book = await require('../lib/ingredientLots').loadLotBook(bangkokToday());
    const name = String(req.query.name || '').trim();
    const lots = book.lotsFor(name);
    res.json({ name, unit: lots.length ? lots[0].unit : '', lots: lots.map((l) => ({ id: l.id, date: formatDMY(l.date), brand: brandOfLot(l), source: l.source, qty: l.qty, unit: l.unit, left: Math.max(l.remaining, 0), total: l.total, unitCost: l.unitCost })) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}

async function addPurchase(req, res) {
  try {
    const { bangkokToday, parseDate } = require('../lib/dates');
    const il = require('../lib/ingredientLots');
    const b = req.body || {};
    const today = bangkokToday();
    const date = b.date ? parseDate(String(b.date), today) : today;
    if (!date) return res.status(400).json({ error: 'That date is not valid. Use DD/MM/YYYY.' });
    const base = il.toBaseQty(`${String(b.qty || '').trim()}${String(b.unit || '').trim()}`);
    const price = Number(b.price);
    if (!b.name || !base || !(base.qty > 0)) return res.status(400).json({ error: 'Type how much you bought, for example 500 and g.' });
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Type what you paid in baht for all of it.' });
    const book = await il.loadLotBook(today);
    const existing = book.lotsFor(String(b.name));
    if (existing.length && existing[0].unit !== base.unit) return res.status(400).json({ error: `${b.name} is counted in ${existing[0].unit}. Type this purchase in ${existing[0].unit} so it can be used oldest first with the rest.` });
    const display = existing.length ? book.names().find((n) => normKey(n) === normKey(b.name)) || String(b.name).trim() : String(b.name).trim();
    const [lot] = await il.addLots([{ date, name: display, qty: base.qty, unit: base.unit, price, source: 'Manual', note: String(b.brand || '').trim().slice(0, 60) }]);
    res.json({ ok: true, id: lot.id });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}

async function editLot(req, res) {
  try {
    const { bangkokToday, parseDate, formatDMY, bangkokNow } = require('../lib/dates');
    const il = require('../lib/ingredientLots'); const sheets = require('../lib/sheets');
    const b = req.body || {};
    const rows = await sheets.readTab(il.LOTS_TAB);
    const i = rows.findIndex((r, n) => n > 0 && String(r[0]) === String(b.id));
    if (i < 0) return res.status(404).json({ error: 'That purchase is no longer there.' });
    const row = rows[i].slice(); while (row.length < 12) row.push('');
    if (b.date) { const d = parseDate(String(b.date), bangkokToday()); if (!d) return res.status(400).json({ error: 'That date is not valid. Use DD/MM/YYYY.' }); row[2] = formatDMY(d); }
    if (b.price !== undefined && b.price !== '') { const p = Number(b.price); if (!Number.isFinite(p) || p < 0) return res.status(400).json({ error: 'The price is not a number.' }); row[7] = Math.round(p * 100) / 100; row[8] = Math.round((p / (Number(row[4]) || 1)) * 100000) / 100000; }
    if (b.left !== undefined && b.left !== '') { const l = Number(b.left); if (!Number.isFinite(l) || l < 0) return res.status(400).json({ error: 'What is left is not a number.' }); row[6] = l; row[9] = l > 1e-6 ? 'Active' : 'Used up'; }
    if (b.brand !== undefined) row[11] = String(b.brand).trim().slice(0, 60);
    row[10] = bangkokNow();
    await sheets.updateRow(il.LOTS_TAB, i + 1, row);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}

async function deleteLot(req, res) {
  try {
    const il = require('../lib/ingredientLots'); const sheets = require('../lib/sheets');
    const id = String((req.body && req.body.id) || '');
    const rows = await sheets.readTab(il.LOTS_TAB);
    if (!rows.some((r, n) => n > 0 && String(r[0]) === id)) return res.status(404).json({ error: 'That purchase is no longer there.' });
    await sheets.deleteRowsWhere(il.LOTS_TAB, (r) => String(r[0]) === id);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
}

const wrapInv = (fn) => async (req, res) => { const done = res.json.bind(res); res.json = (b) => { if (res.statusCode < 400) { try { require('../lib/shoppingService').invalidate(); } catch (e) { /* ignore */ } } return done(b); }; return fn(req, res); };

module.exports = { ingredientLots, addPurchase: wrapInv(addPurchase), editLot: wrapInv(editLot), deleteLot: wrapInv(deleteLot), listStock, updateStock: wrapInv(updateStock), editStockRoute: wrapInv(editStockRoute), seedPackagingRoute, listIngredientStock, countIngredientPacks: wrapInv(countIngredientPacks), listBlends, saveBlendRoute, deleteBlendRoute, setIngredientCategory, setIngredientBrand, setItemMeta: wrapInv(setItemMeta), saveBags: wrapInv(saveBags), suggestBags, addCategoryRoute, seedMeat: wrapInv(seedMeat) };