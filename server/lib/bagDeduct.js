// Bagged meat comes off the Stock page when a batch is cooked.
//
// The Meat cards on the Stock page (chuck, brisket, pork mince...) are hand counted bags. Cooks used to take grams only off
// the receipt stock lots, which never hold these meats, so the cards never moved. Now every logged batch also removes the
// bags it used, using the same "fewest bags, least left over" pick as the Stock page. Nothing is silent: every outcome is reported.
//
// Rules:
//  - Only grams. A meat counted in pieces (lamb shank) is reported, never guessed.
//  - Your count always wins. If the card was counted on or after the cook date, that count already includes the cook, so it is skipped.
//  - The bags come from what she types: "900+700" is two bags, "1600" is one bag. A weight with no such bag on the card is reported, nothing is guessed.
//  - A cook never empties a card by guesswork. When what is left drops below one batch the reply says BUY.
//  - Delete or undo of a batch puts its bags back.

const { normName, UNIT_FACTORS } = require('./priceBook');
const { linkStock } = require('./stockLink');
const bagsLib = require('./stockBags');

const USAGE_KEY = 'bag_usage'; // { [batchKey]: [{ key, name, bags: [g...] }] }
const round = (n) => Math.round(n * 100) / 100;
const bangkokDay = (ts) => { const t = new Date(ts); return Number.isNaN(t.getTime()) ? '' : new Date(t.getTime() + 7 * 3600000).toISOString().slice(0, 10); };
const isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const g = (n) => `${Math.round(n).toLocaleString('en-AU')}g`;
const pc = (n) => `${Math.round(n)} pc${Math.round(n) === 1 ? '' : 's'}`;

function takeBags(bags, use) {
  const left = bags.slice();
  for (const u of use) { const i = left.indexOf(u); if (i >= 0) left.splice(i, 1); }
  return left;
}

// Pure. lines: batch ingredient lines [{ type, name, qty, unit, parts? }]. items: [{ key, name, unit, bags, batch, countedAt }].
// cookDate: Date or YYYY-MM-DD. Each typed bag ("900+700" is two bags, "1600" is one) is matched to a bag of that weight on the card.
// A weight with no matching bag is reported and nothing is taken for it, so a card never empties by guesswork.
// guess: for batches logged before bags were typed, pick the fewest bags that cover the grams (shown to Lily first, never silent).
function planBagUse(lines, items, cookDate, links = {}, opts = {}) {
  const { guess = false } = opts;
  const ing = (lines || []).filter((l) => l.type === 'Ingredient' && l.name);
  if (!ing.length || !items.length) return { used: [], skipped: [] };
  const needs = [...new Map(ing.map((l) => [normName(l.name), { key: normName(l.name), name: l.name }])).values()];
  const { assign } = linkStock(needs, items.map((i) => ({ key: i.key, name: i.name })), { links });
  const cook = isoDay(cookDate);
  const used = []; const skipped = [];
  for (const it of items) {
    const need = assign.get(it.key);
    if (!need) continue;
    if (/^(pcs?|pieces?)$/i.test(String(it.unit || ''))) {
      // Counted in pieces per bag (chicken thigh). Typed "7pcs 980g + 1pc 150g" names the bags; typed nothing means one piece per portion.
      const lns = ing.filter((x) => normName(x.name) === need);
      const typed = lns.flatMap((x) => x.pieces || []);
      // One piece per portion is chicken soup's rule only. Any other piece counted meat needs the pieces typed.
      const wantedPcs = typed.length ? typed : (/chicken/i.test(it.name) && opts.yield > 0 ? [{ n: Math.round(opts.yield), of: 0 }] : []);
      if (!wantedPcs.length) { skipped.push({ name: it.name, reason: `It is counted in ${it.unit}, not grams. Type the pieces and grams like 2pcs 1900g, or recount it. Nothing was taken off.` }); continue; }
      const counted = it.countedAt ? bangkokDay(it.countedAt) : '';
      if (counted && cook && counted >= cook) { skipped.push({ name: it.name, reason: `You counted this on ${counted.split('-').reverse().join('/')}, on or after this cook, so your count already includes it.` }); continue; }
      let left = it.bags.slice(); const removed = []; const missing = [];
      for (const w of wantedPcs) {
        const at = left.indexOf(w.of || w.n);
        if (at < 0) { missing.push(w.of ? `${w.n} from a ${w.of}` : `${w.n}`); continue; }
        if (w.of) { left[at] = w.of - w.n; removed.push(w.n); } else { removed.push(left[at]); left.splice(at, 1); }
      }
      if (missing.length) skipped.push({ name: it.name, reason: `no ${missing.join(' or ')} piece bag on the card, so ${removed.length ? 'only the other bags were taken off' : 'nothing was taken off'}. Type the bags like 7pcs 980g + 1pc 150g, or recount the card.` });
      if (!removed.length) continue;
      const leftTotal = left.reduce((a, b) => a + b, 0);
      used.push({ key: it.key, name: it.name, grams: removed.reduce((a, b) => a + b, 0), removed, left: leftTotal, short: 0, bagsAfter: left, belowBatch: it.batch > 0 && leftTotal < it.batch, batch: it.batch || 0, pieces: true });
      continue;
    }
    const wanted = []; let unmeasured = false;
    for (const l of ing.filter((x) => normName(x.name) === need)) {
      const f = UNIT_FACTORS[String(l.unit || '').trim().toLowerCase()];
      if (!(f && f[0] === 'g')) { unmeasured = true; continue; }
      if (Array.isArray(l.parts) && l.parts.length > 1) wanted.push(...l.parts.map((p) => ({ g: Number(p), typed: true })));
      else wanted.push({ g: Number(l.qty) * f[1], typed: false });
    }
    const grams = wanted.reduce((a, w) => a + w.g, 0);
    if (!(grams > 0)) { if (unmeasured) skipped.push({ name: it.name, reason: 'The recipe does not give it in grams, so I did not take it off.' }); continue; }
    if (String(it.unit || 'g').toLowerCase() !== 'g') { skipped.push({ name: it.name, reason: `It is counted in ${it.unit}, not grams, so I did not take ${g(grams)} off. Please recount it.` }); continue; }
    const counted = it.countedAt ? bangkokDay(it.countedAt) : '';
    if (counted && cook && counted >= cook) { skipped.push({ name: it.name, reason: `You counted this raw meat on ${counted.split('-').reverse().join('/')}, on or after this cook, so your count already includes it.` }); continue; }
    let left = it.bags.slice(); const removed = []; const missing = [];
    for (const w of wanted) {
      const at = left.findIndex((b) => Math.abs(b - w.g) <= 1);
      if (at >= 0) { removed.push(left[at]); left.splice(at, 1); } else missing.push(w.g);
    }
    if (missing.length && guess && !wanted.some((w) => w.typed)) {
      const s = bagsLib.suggest(it.bags, grams);
      if (!s.short) { left = takeBags(it.bags, s.use); removed.length = 0; removed.push(...s.use); missing.length = 0; }
    }
    if (missing.length) skipped.push({ name: it.name, reason: `no ${missing.map(g).join(' or ')} bag on the card, so ${removed.length ? 'only the other bags were taken off' : 'nothing was taken off'}. Type the bags you used like 900+700 (each one a bag on the card), or recount the card.` });
    if (!removed.length) continue;
    const leftTotal = bagsLib.total(left);
    used.push({ key: it.key, name: it.name, grams: round(removed.reduce((a, b) => a + b, 0)), removed, left: leftTotal, short: 0, bagsAfter: left, belowBatch: it.batch > 0 && leftTotal < it.batch, batch: it.batch || 0 });
  }
  return { used, skipped };
}

function reportLines(plan) {
  const out = [];
  if (plan.used.length) out.push(`Meat bags used: ${plan.used.map((u) => `${u.name} ${u.removed.map(u.pieces ? pc : g).join(' + ')}, ${u.pieces ? pc(u.left) : g(u.left)} left`).join('; ')}`);
  for (const u of plan.used) if (u.belowBatch) out.push(`BUY ${u.name}: ${u.pieces ? pc(u.left) : g(u.left)} left, less than one batch (${u.pieces ? pc(u.batch) : g(u.batch)}).`);
  for (const s of plan.skipped) out.push(`${s.name}: ${s.reason}`);
  return out;
}

// Impure. Loads the bagged items, plans, saves the bags and the Stock count, and remembers what was taken so Delete can give it back.
async function deductForBatch(result, key, io = realIo(), opts = {}) {
  const map = await io.loadBags();
  const names = await io.stockNames();
  const items = Object.keys(map).map((k) => {
    const row = names.get(k) || {};
    return { key: k, name: row.itemName || k, unit: map[k].unit || 'g', bags: map[k].bags || [], batch: map[k].batch || 0, countedAt: (row.lastUpdatedBy && row.lastUpdatedBy !== 'Auto' ? row.lastUpdated : '') || map[k].countedAt || '' };
  }).filter((i) => i.bags.length || names.has(i.key));
  const plan = planBagUse(result.lines, items, result.date, await io.loadLinks(), { ...opts, yield: opts.yield || result.yield });
  if (!plan.used.length) return reportLines(plan);
  const usage = [];
  for (const u of plan.used) {
    const it = items.find((i) => i.key === u.key);
    map[u.key] = { ...map[u.key], bags: u.bagsAfter, unit: it.unit, countedAt: it.countedAt || undefined };
    await io.setCount(u.name, u.left, it.unit);
    usage.push({ key: u.key, name: u.name, bags: u.removed });
  }
  await io.saveBags(map);
  await io.saveUsage(key, usage);
  return reportLines(plan);
}

// Gives a batch's bags back (Delete or undo). Returns report lines.
async function restoreForBatch(key, io = realIo()) {
  const all = await io.loadUsage();
  const entries = all[key];
  if (!entries || !entries.length) return [];
  const map = await io.loadBags();
  const out = [];
  for (const e of entries) {
    const cur = map[e.key] || { bags: [], unit: 'g', batch: 0 };
    const bags = [...(cur.bags || []), ...e.bags];
    map[e.key] = { ...cur, bags };
    await io.setCount(e.name, bagsLib.total(bags), cur.unit || 'g');
    out.push(`${e.name} ${g(e.bags.reduce((a, b) => a + b, 0))}`);
  }
  await io.saveBags(map);
  delete all[key];
  await io.saveAllUsage(all);
  return [`Meat bags put back: ${out.join(', ')}.`];
}

// ---- Catch up: batches already logged before this fix, and the Audit check ----
// Looks at the last `days` days of the Cook Log (and R&D Log) for batches that used bagged meat but never took any bags off.
// Returns [{ key, dish, date, lines }] oldest first.
async function loggedBatches(io, today, days = 30) {
  const { parseDate, daysBetween } = require('./dates');
  const read = async (t) => { try { return await io.readTab(t); } catch (err) { return []; } };
  const [log, rd, lines, rdLines, usage] = await Promise.all([read('Cook Log'), read('R&D Log'), read('Cook Log Lines'), read('R&D Log Lines'), io.loadUsage()]);
  const byKey = new Map();
  for (const r of [...lines.slice(1), ...rdLines.slice(1)]) { const k = String(r[0]); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push({ type: String(r[3] || '').trim(), name: String(r[4] || '').trim(), qty: Number(String(r[5]).replace(/,/g, '')), unit: String(r[6] || '').trim() }); }
  const out = [];
  for (const r of [...log.slice(1), ...rd.slice(1)]) {
    const date = parseDate(r[1]); const key = String(r[0] || '');
    if (!date || !key || usage[key] || daysBetween(today, date) > days || daysBetween(today, date) < 0) continue;
    out.push({ key, dish: String(r[2] || '').trim(), date, yield: Number(r[3]) || 0, lines: byKey.get(key) || [] });
  }
  return out.sort((a, b) => a.date - b.date);
}

async function bagItems(io) {
  const map = await io.loadBags(); const names = await io.stockNames();
  return Object.keys(map).map((k) => { const row = names.get(k) || {}; return { key: k, name: row.itemName || k, unit: map[k].unit || 'g', bags: (map[k].bags || []).slice(), batch: map[k].batch || 0, countedAt: (row.lastUpdatedBy && row.lastUpdatedBy !== 'Auto' ? row.lastUpdated : '') || map[k].countedAt || '' }; });
}

// Which of these ingredient names still have bagged stock on a Meat card. A price from an old bulk buy is normal while the bags last,
// so cooks only warn about an old price once that stock is gone. Returns a Set of normalised ingredient names.
async function inHand(names, io = realIo()) {
  const out = new Set();
  try {
    const items = await bagItems(io); const links = await io.loadLinks();
    const needs = (names || []).map((n) => ({ key: normName(n), name: n }));
    const { assign } = linkStock(needs, items.map((i) => ({ key: i.key, name: i.name })), { links });
    for (const it of items) { const need = assign.get(it.key); if (need && it.bags.reduce((a, b) => a + b, 0) > 0) out.add(need); }
  } catch (err) { /* no card data: nothing is treated as in hand, so the old price warning still shows */ }
  return out;
}

// What a catch up would do, batch by batch, against bags that move as it goes. Nothing is written.
async function catchUpPreview(io = realIo(), today = require('./dates').bangkokToday()) {
  const batches = await loggedBatches(io, today);
  const items = await bagItems(io); const links = await io.loadLinks();
  const rows = [];
  for (const b of batches) {
    const plan = planBagUse(b.lines, items, b.date, links, { guess: true, yield: b.yield });
    for (const u of plan.used) { const it = items.find((i) => i.key === u.key); it.bags = u.bagsAfter; }
    if (plan.used.length) rows.push({ ...b, plan });
  }
  return rows;
}

async function catchUpApply(io = realIo(), today = require('./dates').bangkokToday()) {
  const batches = await loggedBatches(io, today);
  const lines = [];
  for (const b of batches) {
    const r = await deductForBatch({ lines: b.lines, date: b.date, yield: b.yield }, b.key, io, { guess: true });
    if (r.length) lines.push(`${b.dish} ${require('./dates').formatDMY(b.date)}: ${r.join(' ')}`);
  }
  return lines;
}

// "catch up meat" shows what would come off, "catch up meat apply" does it.
async function processCatchUp(text, io = realIo()) {
  const m = String(text || '').trim().match(/^catch\s*up\s+meat(\s+apply)?$/i);
  if (!m) return null;
  if (m[1]) {
    const done = await catchUpApply(io);
    return [done.length ? `Meat cards caught up:\n${done.join('\n')}` : 'Nothing to catch up. Every logged batch has already taken its meat off.'];
  }
  const rows = await catchUpPreview(io);
  if (!rows.length) return ['Nothing to catch up. Every logged batch has already taken its meat off.'];
  const { formatDMY } = require('./dates');
  return [`These batches never took meat off the Stock page:\n${rows.map((r) => `${r.dish} ${formatDMY(r.date).slice(0, 5)}: ${reportLines(r.plan).join(' ')}`).join('\n')}\nNothing is changed yet. Send "catch up meat apply" to do it.`];
}

// Before cooking: what the dish's recipe needs from each bagged meat, what the card holds, and which bags would make it.
async function precheck(recipeLines, io = realIo()) {
  const items = await bagItems(io); const links = await io.loadLinks();
  const ing = (recipeLines || []).map((l) => ({ type: 'Ingredient', name: l.name, qty: l.qty, unit: l.unit }));
  const needs = [...new Map(ing.map((l) => [normName(l.name), { key: normName(l.name), name: l.name }])).values()];
  const { assign } = linkStock(needs, items.map((i) => ({ key: i.key, name: i.name })), { links });
  const out = [];
  for (const it of items) {
    const need = assign.get(it.key); if (!need) continue;
    const grams = ing.filter((l) => normName(l.name) === need).reduce((a, l) => { const f = UNIT_FACTORS[String(l.unit || '').trim().toLowerCase()]; return f && f[0] === 'g' ? a + Number(l.qty) * f[1] : a; }, 0);
    if (!(grams > 0)) continue;
    const have = bagsLib.total(it.bags); const s = bagsLib.suggest(it.bags, grams);
    out.push({ name: it.name, need: grams, have, enough: !s.short, shortBy: s.short, use: s.use, bags: it.bags });
  }
  return out;
}

// Chicken thigh is counted as pieces per bag (2, 3, 1, 7, 7, 7, 7), but its card was saved in grams, so it showed "34g".
// Switch it to pieces once. The date of her last real count is kept.
async function migratePieceCards(io = realIo()) {
  const map = await io.loadBags(); const names = await io.stockNames(); let changed = 0;
  for (const k of Object.keys(map)) {
    const row = names.get(k) || {};
    const bags = map[k].bags || [];
    if (!/chicken/i.test(row.itemName || k) || (String(map[k].unit || 'g') !== 'g' && /^pcs?$/i.test(String(row.unit || ''))) || !bags.length || bags.some((b) => b > 30)) continue;
    map[k] = { ...map[k], unit: 'pcs', countedAt: (row.lastUpdatedBy && row.lastUpdatedBy !== 'Auto' ? row.lastUpdated : '') || map[k].countedAt || undefined };
    await io.setCount(row.itemName || k, bags.reduce((a, b) => a + b, 0), 'pcs', true);
    changed += 1;
  }
  if (changed) await io.saveBags(map);
  return changed;
}

function realIo() {
  const appState = require('./appState');
  const sc = require('./stockCounts');
  const readUsage = async () => { try { return JSON.parse((await appState.getState(USAGE_KEY)) || '{}'); } catch (err) { return {}; } };
  return {
    loadBags: () => bagsLib.load(),
    saveBags: (m) => bagsLib.saveAll(m),
    stockNames: async () => new Map((await sc.getAllStock()).map((r) => [normName(r.itemName), r])),
    loadLinks: async () => { try { return JSON.parse((await appState.getState('stock_links')) || '{}'); } catch (err) { return {}; } },
    setCount: (name, count, unit, changeUnit = false) => sc.setStockCount(name, count, unit, 'Auto', '', changeUnit),
    loadUsage: readUsage,
    saveUsage: async (key, entries) => { const all = await readUsage(); all[key] = entries; await appState.setState(USAGE_KEY, JSON.stringify(all)); },
    readTab: (t) => require('./sheets').readTab(t),
    saveAllUsage: (all) => appState.setState(USAGE_KEY, JSON.stringify(all)),
  };
}

module.exports = { inHand, migratePieceCards, precheck, loggedBatches, bagItems, catchUpPreview, catchUpApply, processCatchUp, planBagUse, reportLines, deductForBatch, restoreForBatch, takeBags, USAGE_KEY };
