// Pasta cost cards: the cost of one cooked-to-order pasta portion, kept here so Lily never has to open a sheet tab.
//
// This is the same function as the "Pasta - Tubetti" style tabs in Merlin's numbers: dry pasta grams at today's price,
// oil, butter, cooking minutes, reheating, packaging, then total, profit and margin. The difference is that every unit
// price is read live from the price book (Price Log plus typed receipts), so a new butter, a new oil, a new box or a new
// pasta price changes the cost straight away. Only the quantities and the selling price are stored.
//
// data/pastaSeed.json is the starting set (copied from the sheet tabs on 21/11/2026). Every save is added as a new row in
// the "Pasta Costs" tab of the Claude Log (Pasta | Saved | Card), never overwritten. The newest row for a pasta wins.
const { readTab, appendRows } = require('./sheets');
const { ensureTab } = require('./cookLog');
const { normName } = require('./priceBook');

const TAB = 'Pasta Costs';
const HEADERS = ['Pasta', 'Saved', 'Card'];

// Where each unit price comes from (names as they appear in the Price Log and receipts).
const OIL = 'Oil';
const BUTTER = 'Butter';
const COOKING = 'Utility costs - cooking';
const REHEAT = 'Utility costs - reheating';
// Reheating is counted in minutes. Until a reheating price per minute is logged, a minute is priced like a minute of cooking.
const REHEAT_MIN = 'Utility costs - reheating per minute';
const DEFAULT_PACK = 'Packaging Box (carb600ml)';

const key = (s) => normName(String(s || '').replace(/^pasta\s*-\s*/i, ''));
const num = (v, min = 0) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n >= min ? n : null; };

function clean(card) {
  const name = String(card.name || '').replace(/^pasta\s*-\s*/i, '').trim();
  if (!name) throw new Error('The pasta needs a name');
  const f = (k, label, min = 0) => { const n = num(card[k], min); if (n === null) throw new Error(`${label} must be a number`); return n; };
  const out = {
    name,
    sell: f('sell', 'Selling price'),
    boxG: f('boxG', 'Box size (g)', 1),
    dryG: f('dryG', 'Dry pasta per portion (g)', 1),
    cookedG: f('cookedG', 'Cooked portion (g)'),
    oilG: f('oilG', 'Oil (g)'),
    butterG: f('butterG', 'Butter (g)'),
    cookMin: f('cookMin', 'Cooking minutes'),
    reheat: card.reheat === undefined || card.reheat === null || card.reheat === '' ? 0 : f('reheat', 'Reheats per order'),
    reheatMin: card.reheatMin === undefined || card.reheatMin === null || card.reheatMin === '' ? null : f('reheatMin', 'Reheating minutes'),
    pack: String(card.pack || DEFAULT_PACK).trim(),
    packQty: f('packQty', 'Packaging count'),
    priceNames: [...new Set((Array.isArray(card.priceNames) ? card.priceNames : String(card.priceNames || '').split(',')).map((s) => String(s).trim()).filter(Boolean))],
    unconfirmed: Array.isArray(card.unconfirmed) ? card.unconfirmed : [],
  };
  if (!out.priceNames.length) out.priceNames = [`Pasta - ${name}`];
  return out;
}

// The price of an ingredient on a date: the newest of the names tried.
function price(pb, names, date) {
  let best = null;
  for (const n of [].concat(names)) {
    const hit = pb.lookup(n, date);
    if (!hit || hit.missing || !(hit.cost > 0)) continue;
    if (!best || hit.date > best.date) best = { ...hit, name: n };
  }
  return best;
}

const r2 = (x) => Math.round(x * 100) / 100;

// card: a cleaned card. pb: the price book. date: the day to price on (a Date). Returns every line with its source.
function costCard(card, pb, date) {
  const lines = [];
  const add = (label, qty, unit, names, flag, field) => {
    const p = qty > 0 ? price(pb, names, date) : null;
    const unitCost = p ? p.cost : 0;
    lines.push({
      label, field, qty, unit, unitCost, cost: qty * unitCost,
      source: p ? p.name : null, priceDate: p ? p.date : null,
      missing: qty > 0 && !p, stale: Boolean(p && p.stale), jump: Boolean(p && p.jumpFrom), guess: Boolean(flag),
    });
  };
  const unc = new Set(card.unconfirmed || []);
  add(`Pasta - ${card.name}`, card.dryG, 'g', card.priceNames, false, 'dryG');
  add('Oil', card.oilG, 'g', OIL, unc.has('oilG'), 'oilG');
  add('Butter', card.butterG, 'g', BUTTER, unc.has('butterG'), 'butterG');
  add('Cooking utilities', card.cookMin, 'min', COOKING, unc.has('cookMin'), 'cookMin');
  // Minutes once she has entered them. Older cards counted reheats per order, kept as they were until minutes are set.
  const legacyReheat = card.reheatMin === null || card.reheatMin === undefined;
  if (legacyReheat) { add('Reheating utilities', card.reheat, 'per order, set minutes', REHEAT, false, 'reheatMin'); if (lines[lines.length - 1].qty > 0) lines[lines.length - 1].legacy = true; }
  else add('Reheating utilities', card.reheatMin, 'min', [REHEAT_MIN, COOKING], unc.has('reheatMin'), 'reheatMin');
  add(card.pack, card.packQty, 'set', card.pack, false, 'packQty');
  const total = lines.reduce((s, l) => s + l.cost, 0);
  const profit = card.sell - total;
  return {
    name: card.name, sell: card.sell, lines, total, profit,
    marginPct: card.sell > 0 ? profit / card.sell : null,
    foodPct: card.sell > 0 ? total / card.sell : null,
    portionsPerBox: card.dryG > 0 ? card.boxG / card.dryG : null,
    cookedGuess: (card.unconfirmed || []).includes('cookedG'),
    legacyReheat: legacyReheat && card.reheat > 0,
    missing: lines.filter((l) => l.missing).map((l) => l.label),
    guesses: lines.filter((l) => l.guess).map((l) => l.label),
    total2: r2(total),
  };
}

function parseRows(rows = []) {
  const history = new Map();
  (rows || []).forEach((r, i) => {
    if (i === 0 && /^pasta$/i.test(String(r[0] || '').trim())) return;
    const name = String(r[0] || '').trim();
    if (!name) return;
    let card;
    try { card = clean({ ...JSON.parse(String(r[2] || '{}')), name }); } catch (err) { return; }
    const list = history.get(key(name)) || [];
    list.push({ card, saved: String(r[1] || '') });
    history.set(key(name), list);
  });
  return history;
}

// seed: parsed pastaSeed.json. rows: the Pasta Costs tab as read. Returns [{ card, saved, versions }].
function merge(seed, rows = []) {
  const history = parseRows(rows);
  const out = [];
  const used = new Set();
  for (const s of seed.cards || []) {
    const h = history.get(key(s.name)) || [];
    used.add(key(s.name));
    const last = h[h.length - 1];
    out.push(last ? { card: last.card, saved: last.saved, versions: h.length } : { card: clean(s), saved: '', versions: 0 });
  }
  for (const [k, h] of history) {
    if (used.has(k)) continue;
    const last = h[h.length - 1];
    out.push({ card: last.card, saved: last.saved, versions: h.length });
  }
  return out;
}

async function loadCards(seed) {
  let rows = [];
  try { rows = await readTab(TAB); } catch (err) { if (!/unable to parse range|not found/i.test(String(err.message))) throw err; }
  return merge(seed, rows);
}

async function save(seed, input) {
  const card = clean(input);
  // Saving the whole card confirms every number on it. Saving one line (confirm: ['oilG']) confirms only that number.
  const only = Array.isArray(input.confirm) ? input.confirm : null;
  const prevUnc = ((await loadCards(seed)).find((c) => key(c.card.name) === key(card.name)) || { card: {} }).card.unconfirmed || [];
  card.unconfirmed = only ? prevUnc.filter((k) => !only.includes(k)) : [];
  await ensureTab(TAB, HEADERS);
  const { name, ...rest } = card;
  await appendRows(TAB, [[name, new Date().toISOString(), JSON.stringify(rest)]], { raw: true });
  return loadCards(seed);
}

// ---- feeding the ledger and the cost table ---------------------------------------------------------------------

// The description a sale carries -> the pasta key: "Risoni (Extra)", "Pasta - Risoni", "Risoni" all give "risoni".
const pastaKey = (desc) => normName(String(desc || '').replace(/^pasta\s*-\s*/i, '').replace(/\(.*?\)/g, ''));

// Fills in the cost of Recipe rows that have none (a pasta sold on Grab with no cost on record) and attaches the cost of
// every pasta to the ledger array, so LINE orders can be costed too. Rows that already carry a cost are left alone.
function applyToLedger(ledger, cards, pb, today) {
  const byKey = new Map(cards.map((c) => [key(c.card.name), c.card]));
  const cache = new Map();
  const costOn = (card, date) => {
    const k = `${key(card.name)}|${date.toISOString().slice(0, 10)}`;
    if (!cache.has(k)) cache.set(k, costCard(card, pb, date));
    return cache.get(k);
  };
  let filled = 0;
  for (const r of ledger) {
    if (r.type !== 'Recipe' || (r.cost !== null && r.cost > 0)) continue;
    const card = byKey.get(pastaKey(r.desc));
    if (!card) continue;
    const c = costOn(card, r.date);
    if (c.missing.length || !(c.total > 0)) continue;
    r.cost = c.total;
    if (r.qty !== null && r.qty !== undefined) r.net = -(r.qty * c.total);
    r.pastaCosted = true;
    filled++;
  }
  const extra = new Map();
  for (const [k, card] of byKey) {
    const c = costOn(card, today);
    if (!c.missing.length && c.total > 0) extra.set(k, c.total);
  }
  ledger.pastaCosts = extra;
  ledger.pastaFilled = filled;
  return ledger;
}

module.exports = { clean, costCard, merge, loadCards, save, applyToLedger, pastaKey, key, TAB, HEADERS };
