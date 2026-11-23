// Bagged meat comes off the Stock page when a batch is cooked.
//
// The Meat cards on the Stock page (chuck, brisket, pork mince...) are hand counted bags. Cooks used to take grams only off
// the receipt stock lots, which never hold these meats, so the cards never moved. Now every logged batch also removes the
// bags it used, using the same "fewest bags, least left over" pick as the Stock page. Nothing is silent: every outcome is reported.
//
// Rules:
//  - Only grams. A meat counted in pieces (lamb shank) is reported, never guessed.
//  - Your count always wins. If the card was counted on or after the cook date, that count already includes the cook, so it is skipped.
//  - A cook that needs more than the bags hold empties the card to 0 and says how much was short.
//  - Delete or undo of a batch puts its bags back.

const { normName, UNIT_FACTORS } = require('./priceBook');
const { linkStock } = require('./stockLink');
const bagsLib = require('./stockBags');

const USAGE_KEY = 'bag_usage'; // { [batchKey]: [{ key, name, bags: [g...] }] }
const round = (n) => Math.round(n * 100) / 100;
const bangkokDay = (ts) => { const t = new Date(ts); return Number.isNaN(t.getTime()) ? '' : new Date(t.getTime() + 7 * 3600000).toISOString().slice(0, 10); };
const isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const g = (n) => `${Math.round(n).toLocaleString('en-AU')}g`;

function takeBags(bags, use) {
  const left = bags.slice();
  for (const u of use) { const i = left.indexOf(u); if (i >= 0) left.splice(i, 1); }
  return left;
}

// Pure. lines: batch ingredient lines [{ type, name, qty, unit }]. items: [{ key, name, unit, bags, countedAt }] (bagged stock items).
// cookDate: Date or YYYY-MM-DD. Returns { used: [{ key, name, grams, removed, left, short, bagsAfter }], skipped: [{ name, reason }] }.
function planBagUse(lines, items, cookDate, links = {}) {
  const ing = (lines || []).filter((l) => l.type === 'Ingredient' && l.name);
  if (!ing.length || !items.length) return { used: [], skipped: [] };
  const needs = [...new Map(ing.map((l) => [normName(l.name), { key: normName(l.name), name: l.name }])).values()];
  const { assign } = linkStock(needs, items.map((i) => ({ key: i.key, name: i.name })), { links });
  const cook = isoDay(cookDate);
  const used = []; const skipped = [];
  for (const it of items) {
    const need = assign.get(it.key);
    if (!need) continue;
    const mine = ing.filter((l) => normName(l.name) === need);
    let grams = 0; let unmeasured = false;
    for (const l of mine) {
      const f = UNIT_FACTORS[String(l.unit || '').trim().toLowerCase()];
      if (f && f[0] === 'g') grams += Number(l.qty) * f[1]; else unmeasured = true;
    }
    if (!(grams > 0)) { if (unmeasured) skipped.push({ name: it.name, reason: 'The recipe does not give it in grams, so I did not take it off.' }); continue; }
    if (String(it.unit || 'g').toLowerCase() !== 'g') { skipped.push({ name: it.name, reason: `It is counted in ${it.unit}, not grams, so I did not take ${g(grams)} off. Please recount it.` }); continue; }
    const counted = it.countedAt ? bangkokDay(it.countedAt) : '';
    if (counted && cook && counted >= cook) { skipped.push({ name: it.name, reason: `You counted it on ${counted.split('-').reverse().join('/')}, on or after this cook, so the count already includes it.` }); continue; }
    const s = bagsLib.suggest(it.bags, grams);
    const bagsAfter = takeBags(it.bags, s.use);
    used.push({ key: it.key, name: it.name, grams: round(grams), removed: s.use, left: bagsLib.total(bagsAfter), short: s.short, bagsAfter });
  }
  return { used, skipped };
}

function reportLines(plan) {
  const out = [];
  if (plan.used.length) out.push(`Meat bags used: ${plan.used.map((u) => `${u.name} ${g(u.removed.reduce((a, b) => a + b, 0))} (${u.removed.length} bag${u.removed.length === 1 ? '' : 's'}), ${g(u.left)} left`).join('; ')}`);
  for (const u of plan.used) if (u.short > 0) out.push(`${u.name}: the card only held ${g(u.grams - u.short)} and the batch used ${g(u.grams)}, so it is now 0. Please recount it.`);
  for (const s of plan.skipped) out.push(`${s.name}: ${s.reason}`);
  return out;
}

// Impure. Loads the bagged items, plans, saves the bags and the Stock count, and remembers what was taken so Delete can give it back.
async function deductForBatch(result, key, io = realIo()) {
  const map = await io.loadBags();
  const names = await io.stockNames();
  const items = Object.keys(map).map((k) => {
    const row = names.get(k) || {};
    return { key: k, name: row.itemName || k, unit: map[k].unit || 'g', bags: map[k].bags || [], countedAt: (row.lastUpdatedBy && row.lastUpdatedBy !== 'Auto' ? row.lastUpdated : '') || map[k].countedAt || '' };
  }).filter((i) => i.bags.length || names.has(i.key));
  const plan = planBagUse(result.lines, items, result.date, await io.loadLinks());
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
    out.push({ key, dish: String(r[2] || '').trim(), date, lines: byKey.get(key) || [] });
  }
  return out.sort((a, b) => a.date - b.date);
}

async function bagItems(io) {
  const map = await io.loadBags(); const names = await io.stockNames();
  return Object.keys(map).map((k) => { const row = names.get(k) || {}; return { key: k, name: row.itemName || k, unit: map[k].unit || 'g', bags: (map[k].bags || []).slice(), countedAt: (row.lastUpdatedBy && row.lastUpdatedBy !== 'Auto' ? row.lastUpdated : '') || map[k].countedAt || '' }; });
}

// What a catch up would do, batch by batch, against bags that move as it goes. Nothing is written.
async function catchUpPreview(io = realIo(), today = require('./dates').bangkokToday()) {
  const batches = await loggedBatches(io, today);
  const items = await bagItems(io); const links = await io.loadLinks();
  const rows = [];
  for (const b of batches) {
    const plan = planBagUse(b.lines, items, b.date, links);
    for (const u of plan.used) { const it = items.find((i) => i.key === u.key); it.bags = u.bagsAfter; }
    if (plan.used.length) rows.push({ ...b, plan });
  }
  return rows;
}

async function catchUpApply(io = realIo(), today = require('./dates').bangkokToday()) {
  const batches = await loggedBatches(io, today);
  const lines = [];
  for (const b of batches) {
    const r = await deductForBatch({ lines: b.lines, date: b.date }, b.key, io);
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

function realIo() {
  const appState = require('./appState');
  const sc = require('./stockCounts');
  const readUsage = async () => { try { return JSON.parse((await appState.getState(USAGE_KEY)) || '{}'); } catch (err) { return {}; } };
  return {
    loadBags: () => bagsLib.load(),
    saveBags: (m) => bagsLib.saveAll(m),
    stockNames: async () => new Map((await sc.getAllStock()).map((r) => [normName(r.itemName), r])),
    loadLinks: async () => { try { return JSON.parse((await appState.getState('stock_links')) || '{}'); } catch (err) { return {}; } },
    setCount: (name, count, unit) => sc.setStockCount(name, count, unit, 'Auto'),
    loadUsage: readUsage,
    saveUsage: async (key, entries) => { const all = await readUsage(); all[key] = entries; await appState.setState(USAGE_KEY, JSON.stringify(all)); },
    readTab: (t) => require('./sheets').readTab(t),
    saveAllUsage: (all) => appState.setState(USAGE_KEY, JSON.stringify(all)),
  };
}

module.exports = { loggedBatches, bagItems, catchUpPreview, catchUpApply, processCatchUp, planBagUse, reportLines, deductForBatch, restoreForBatch, takeBags, USAGE_KEY };
