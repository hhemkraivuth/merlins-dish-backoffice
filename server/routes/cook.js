// Web Batch Cook. Same costing and logging as the LINE group (runBatch), but the
// ingredients come pre-filled from the recipe and every number can be edited.

const { defaultShorthand, applyShorthandRows } = require('../lib/aliases');
const { normName } = require('../lib/priceBook');
const { bangkokToday, parseDate } = require('../lib/dates');
const { runBatch } = require('../lib/cookService');

const SIZED = new Set(['Red Wine Beef Stew', 'Dark beer Stew']);
const fmtDMY = (d) => d.toISOString().slice(0, 10).split('-').reverse().join('/');

function defaultDeps() {
  const live = require('../lib/liveData');
  const cookLog = require('../lib/cookLog');
  const { deductStock } = require('../lib/stockCounts');
  const lots = require('../lib/ingredientLots');
  return {
    loadRecipe: live.loadRecipe,
    loadPriceBook: live.loadPriceBook,
    loadCatalogue: live.loadCatalogue,
    loadShorthand: async () => {
      try { return applyShorthandRows(defaultShorthand(), await cookLog.readShorthandRows()); }
      catch (err) { return defaultShorthand(); }
    },
    isLogged: cookLog.isLogged,
    batchKey: cookLog.batchKey,
    writeBatch: cookLog.writeBatch,
    deductStock,
    loadLotBook: () => lots.loadLotBook(bangkokToday()),
    saveLots: lots.saveLots,
  };
}

function dateFrom(str) {
  if (!str) return bangkokToday();
  const d = parseDate(str, bangkokToday());
  return d;
}

function createCook(getDeps) {
  const dishes = (req, res) => {
    const tabs = [...new Set(defaultShorthand().dishes.values())];
    res.json({ dishes: tabs.map((name) => ({ name, sized: SIZED.has(name) })) });
  };

  async function recipe(req, res) {
    try {
      const deps = getDeps();
      const tab = String(req.query.dish || '');
      const tabs = new Set(defaultShorthand().dishes.values());
      if (!tabs.has(tab)) return res.status(400).json({ error: `Unknown dish "${tab}".` });
      const date = dateFrom(req.query.date);
      if (!date) return res.status(400).json({ error: 'That date is not valid. Use DD/MM/YYYY.' });

      const [r, pb, catalogue] = await Promise.all([deps.loadRecipe(tab), deps.loadPriceBook(), deps.loadCatalogue().catch(() => [])]);
      const price = (name, fallback) => {
        const p = pb.lookup(name, date);
        if (p && !p.missing) return { unitCost: p.cost, priceDate: fmtDMY(p.date), note: p.stale ? `old price (${p.staleDays} days)` : '' };
        return { unitCost: fallback ?? 0, priceDate: '', note: 'no dated purchase, tab cost used' };
      };
      const shape = (arr, type) => arr.map((l) => ({ type, name: l.name, qty: l.qty, unit: l.unit, ...price(l.name, l.sheetCost) }));
      const catalogueCosts = {};
      for (const n of catalogue) { const p = pb.lookup(n, date); if (p && !p.missing) catalogueCosts[n] = { unitCost: p.cost, priceDate: fmtDMY(p.date) }; }

      res.json({
        portionWeights: r.portionWeights, dish: r.dish || tab, tab, sized: SIZED.has(tab), date: fmtDMY(date), usualYield: r.usualYield, sellingPrice: r.sellingPrice,
        ingredients: shape(r.ingredients, 'Ingredient'),
        packaging: shape(SIZED.has(tab) ? r.packaging : r.packaging.filter((p) => p.qty > 0), 'Packaging'),
        utility: shape(r.utility, 'Utility'),
        catalogue: catalogueCosts,
      });
    } catch (err) {
      console.error('Batch cook recipe failed:', err);
      res.status(500).json({ error: `Couldn't read the recipe from Merlin's numbers: ${err.message}` });
    }
  }

  async function submit(req, res) {
    try {
      const deps = getDeps();
      const b = req.body || {};
      const tabs = new Set(defaultShorthand().dishes.values());
      if (!tabs.has(b.dish)) return res.status(400).json({ error: 'Pick a dish first.' });
      const date = dateFrom(b.date);
      if (!date) return res.status(400).json({ error: 'That date is not valid. Use DD/MM/YYYY.' });
      const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

      const bad = [];
      const lines = [];
      for (const l of b.lines || []) {
        const q = num(l.qty);
        if (!l.name || !(q >= 0)) { bad.push(`Ingredient "${l.name || '?'}" has no valid quantity`); continue; }
        lines.push({ token: String(l.name), qty: q, unit: 'g' });
      }
      const packagingQty = {};
      for (const p of b.packaging || []) {
        const q = num(p.qty);
        if (!p.name || !(q >= 0)) { bad.push(`Packaging "${p.name || '?'}" has no valid quantity`); continue; }
        packagingQty[normName(p.name)] = q;
      }
      const sizes = [];
      for (const z of b.sizes || []) {
        const c = num(z.count); const w = num(z.weight);
        if (!(c > 0) && !(w > 0)) continue; // an empty size row is simply not used
        if (!(c > 0) || !(w > 0)) { bad.push(`${z.name || 'Size'} needs both a count and a weight in grams`); continue; }
        sizes.push({ name: z.name, count: c, weight: w });
      }
      if (bad.length) return res.status(400).json({ error: `Nothing was logged.\n${bad.join('\n')}` });

      const batch = {
        dishTab: b.dish, dishWord: b.dish, date,
        yield: b.yield ? num(b.yield) : null,
        lines, packagingQty, sizes,
        cookedWeight: b.cookedWeight ? num(b.cookedWeight) : null,
      };
      const shorthand = await deps.loadShorthand();
      const priceBook = await deps.loadPriceBook();
      const out = await runBatch(batch, deps, shorthand, priceBook, { today: bangkokToday(), source: 'Web' });
      res.json({ status: out.status, text: out.text, result: out.result || null });
    } catch (err) {
      console.error('Batch cook submit failed:', err);
      res.status(500).json({ error: `I couldn't log that batch. Nothing was changed.\nReason: ${err.message}` });
    }
  }

  return { dishes, recipe, submit };
}

let d = null;
const handlers = createCook(() => (d = d || defaultDeps()));
module.exports = { ...handlers, createCook };
