// The Audit desk. A pig in glasses who checks the books so nothing is missed, and tells Lily in one short line each.
//
// runChecks() is pure: it takes the data already loaded for the Pit and returns findings. Each finding is
//   { id, check, line, baht, fix }   id is stable, so Ignore sticks.   baht is the money at risk (0 when it is not money).
// It never writes to the Merlin's numbers sheet or the Ledger. The only things stored are the latest result and the
// ignored ids, both in App State.
const { parseDate, formatDMY, daysBetween, bangkokToday } = require('./dates');

const RESULT_KEY = 'audit_latest';
const IGNORE_KEY = 'audit_ignored';
const FOOD_COST_LIMIT = 0.4;
const BANK_STALE_DAYS = 14;
const STOCK_OLD_DAYS = 5;
const WINDOW = 30; // days looked back

const loose = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9฀-๿]+/g, '');
const baht = (n) => `฿${Math.round(n || 0).toLocaleString('en-AU')}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const iso = (d) => d.toISOString().slice(0, 10);
const list = (a, max = 3) => (a.length <= max ? a.join(', ') : `${a.slice(0, max).join(', ')} and ${a.length - max} more`);

// ledger: ledgerObjects (already pasta costed). expenseRows: Expense Log rows (header optional).
// stock: [{ dish, remaining, oldestAgeDays }]. cookBatches: [{ date, dish, portions }]. closed: Map iso -> reason.
// pastaCards: [{ card, cost }] where cost is pastaCosts.costCard. bank: { amount, asOf "DD/MM/YYYY" }.
function runChecks({ today = bangkokToday(), ledger = [], expenseRows = [], stock = [], cookBatches = [], closed = new Map(), pastaCards = [], bank = null } = {}) {
  const out = [];
  const add = (f) => out.push({ baht: 0, ...f });
  const recent = ledger.filter((r) => daysBetween(today, r.date) <= WINDOW);
  const { buildCostTable, lineItemCost } = require('./reports');
  const table = buildCostTable(ledger);

  // 1. Items Grab could not read (XXXXXX). Lily types what they were, and the row is corrected in the Ledger.
  const placeholder = (x) => /^x{3,}$/i.test(String(x || '').trim());
  const unreadable = recent.filter((r) => placeholder(r.desc) && r.key);
  const byOrder = new Map();
  for (const r of unreadable) { const k = `${r.channel}|${r.dmy}|${r.orderNo || r.key}`; const a = byOrder.get(k) || []; a.push(r); byOrder.set(k, a); }
  for (const [k, rows] of byOrder) {
    const first = rows[0]; const money = rows.reduce((s, r) => s + (r.type === 'Order' ? (r.moneyIn || 0) * (r.qty || 1) : 0), 0);
    add({ id: `unreadable:${k}`, check: 'Unreadable item', line: `${first.channel} order ${first.orderNo || ''} on ${first.dmy.slice(0, 5)} has an item Grab could not read (shown as XXXXXX). Type what it was.`.replace('order  on', 'order on'), baht: money, action: { type: 'rename', keys: rows.map((r) => r.key) } });
  }

  // 2. Sold with no cost, and 4. food cost over 40%, from the same pass over recent orders.
  const sold = new Map();
  const dish = new Map();
  for (const r of recent) {
    if (placeholder(r.desc)) continue;
    if (r.type === 'Recipe' && (r.cost === null || r.cost <= 0)) {
      const k = loose(r.desc); const s = sold.get(k) || { name: r.desc, n: 0, money: 0 }; s.n += r.qty || 1; sold.set(k, s);
    }
    if (r.type !== 'Order') continue;
    const c = lineItemCost(r, table);
    if (c.missing) {
      const k = loose(c.missing); const s = sold.get(k) || { name: c.missing, n: 0, money: 0 }; s.n += r.qty || 1; s.money += r.moneyIn || 0; sold.set(k, s);
    } else if (r.moneyIn >= 10 && !/bundle/i.test(r.desc) && c.cost > 0) {
      // Noodles bundled with a stew or ragu are sold at ฿0 to ฿5 on purpose, so only rows sold at a real price are judged.
      const k = loose(r.desc); const d = dish.get(k) || { name: r.desc, money: 0, cost: 0, n: 0 }; d.money += r.moneyIn * (r.qty || 1); d.cost += c.cost; d.n += r.qty || 1; dish.set(k, d);
    }
  }
  for (const [k, s] of sold) {
    const pasta = /pasta|risoni|tubetti|radiatori|rigatoni|lumache|linguine|spaghetti|farfalle|chefferi|heart/i.test(s.name);
    const clean = s.name.replace(/^pasta\s*-\s*/i, '').replace(/\s*\(.*\)/, '');
    add({ id: `nocost:${k}`, check: 'Sold with no cost', line: `${s.name} sold ${plural(s.n, 'time')} with no cost on record, so profit looks too high.${pasta ? ' Open its cost card.' : ' Type its cost per portion.'}`, baht: s.money, ...(pasta ? { fix: `recipes.html#Pasta - ${clean}`, fixLabel: 'Open cost card' } : { action: { type: 'cost', name: s.name } }) });
  }
  for (const [k, d] of dish) {
    const pct = d.cost / d.money;
    if (pct > FOOD_COST_LIMIT) add({ id: `margin:${k}`, check: 'Margin', line: `${d.name} costs ${Math.round(pct * 100)}% of what it sells for (limit ${Math.round(FOOD_COST_LIMIT * 100)}%). Check the cost or raise the price.`, baht: d.cost - FOOD_COST_LIMIT * d.money, fix: 'reports.html', fixLabel: 'Open Numbers' });
  }

  // 3. Cost cards (pasta): a price missing, or a number still marked to confirm.
  for (const pc of pastaCards) {
    const k = pc.cost; const name = pc.card.name;
    if (k.missing.length) add({ id: `card-missing:${loose(name)}`, check: 'Cost card', line: `Pasta - ${name} has no price for ${list(k.missing)}, so its cost is too low.`, fix: `recipes.html#Pasta - ${name}`, fixLabel: 'Open cost card' });
    else if (k.guesses.length) add({ id: `card-guess:${loose(name)}:${k.guesses.join('|')}`, check: 'Cost card', line: `Pasta - ${name}: ${list(k.guesses)} still to confirm.`, fix: `recipes.html#Pasta - ${name}`, fixLabel: 'Open cost card' });
    if (k.foodPct !== null && k.foodPct > FOOD_COST_LIMIT && !k.missing.length) add({ id: `card-margin:${loose(name)}`, check: 'Margin', line: `Pasta - ${name} costs ${Math.round(k.foodPct * 100)}% of its price to make.`, baht: k.total - FOOD_COST_LIMIT * pc.card.sell, fix: `recipes.html#Pasta - ${name}`, fixLabel: 'Open cost card' });
    if (k.portionsPerBox !== null && pc.card.cookedG > 0 && pc.card.dryG > 0 && pc.card.cookedG / pc.card.dryG > 3) add({ id: `card-yield:${loose(name)}`, check: 'Cost card', line: `Pasta - ${name}: ${Math.round(pc.card.dryG)}g dry giving ${Math.round(pc.card.cookedG)}g cooked looks off.`, fix: `recipes.html#Pasta - ${name}`, fixLabel: 'Open cost card' });
  }

  // 4. Days with no import. Grab arrives up to 2 days late, LINE up to 1.
  const have = { Grab: new Set(), LINE: new Set() };
  for (const r of ledger) if (have[r.channel]) have[r.channel].add(iso(r.date));
  for (const [ch, lag] of [['Grab', 3], ['LINE', 2]]) {
    if (!have[ch].size) continue;
    const gaps = [];
    for (let back = lag; back <= 14; back += 1) {
      const d = new Date(today.getTime() - back * 86400000);
      if (closed.has(iso(d)) || have[ch].has(iso(d))) continue;
      gaps.push(formatDMY(d).slice(0, 5));
    }
    if (gaps.length) add({ id: `gap:${ch}:${gaps.join(',')}`, check: 'Missing days', line: `${ch} has no orders on ${list(gaps, 4)}. Not imported, or the shop was shut and not marked closed.`, fix: 'reports.html', fixLabel: 'Open Numbers' });
  }

  // 5. Same order counted twice in the Ledger.
  const keys = new Map();
  for (const r of ledger) { if (!r.key) continue; const a = keys.get(r.key) || []; a.push(r); keys.set(r.key, a); }
  const dupes = [...keys.values()].filter((a) => a.length > 1);
  if (dupes.length) add({ id: `ledger-dupes:${dupes.length}`, check: 'Totals', line: `${plural(dupes.length, 'ledger row')} appear twice, so sales are counted twice.`, baht: dupes.reduce((s, a) => s + a.slice(1).reduce((x, r) => x + (r.moneyIn || 0), 0), 0), fix: 'reports.html', fixLabel: 'Open Numbers' });

  // 6. Receipts: no shop or no date, and the same line twice.
  const seen = new Map(); let noShop = 0, noShopBaht = 0, noDate = 0; let dup = 0, dupBaht = 0;
  expenseRows.forEach((r, i) => {
    if (i === 0 && /^date$/i.test(String(r[0] || '').trim())) return;
    const name = String(r[1] || '').trim(); if (!name) return;
    const price = Number(String(r[2] ?? '').replace(/[฿,\s]/g, '')) || 0;
    const date = parseDate(String(r[0] || ''), today);
    if (!date) { noDate += 1; return; }
    if (daysBetween(today, date) > WINDOW) return;
    const shop = String(r[5] || '').trim();
    if (!shop) { noShop += 1; noShopBaht += price; }
    const k = `${iso(date)}|${loose(name)}|${price}|${loose(shop)}`;
    if (seen.has(k)) { dup += 1; dupBaht += price; } else seen.set(k, true);
  });
  if (noDate) add({ id: `rcpt-nodate:${noDate}`, check: 'Receipts', line: `${plural(noDate, 'receipt line')} have no readable date.`, fix: '/#receipts', fixLabel: 'Open Purchasing Receipts' });
  if (noShop) add({ id: `rcpt-noshop:${noShop}`, check: 'Receipts', line: `${plural(noShop, 'receipt line')} in the last 30 days have no shop.`, baht: noShopBaht, fix: '/#receipts', fixLabel: 'Open Purchasing Receipts' });
  if (dup) add({ id: `rcpt-dup:${dup}:${Math.round(dupBaht)}`, check: 'Receipts', line: `${plural(dup, 'receipt line')} look entered twice (same day, item, price and shop).`, baht: dupBaht, fix: '/#receipts', fixLabel: 'Open Purchasing Receipts' });

  // 7. Bank balance not refreshed.
  const asOf = bank && parseDate(String(bank.asOf || ''));
  if (asOf && daysBetween(today, asOf) > BANK_STALE_DAYS) add({ id: `bank:${bank.asOf}`, check: 'Bank', line: `The bank balance is from ${bank.asOf}, ${daysBetween(today, asOf)} days ago. Cash figures drift without a fresh statement.`, fix: 'reports.html', fixLabel: 'Open Numbers' });

  // 8. Stock: oversold, no yield, sitting too long.
  for (const s of stock) {
    if (s.remaining < 0) add({ id: `oversold:${loose(s.dish)}`, check: 'Stock', line: `${s.dish} is oversold by ${Math.abs(s.remaining)}. A batch was not logged, or a sale was.`, fix: '/#batchcook', fixLabel: 'Open Kitchen Production' });
    else if (s.remaining > 0 && s.oldestAgeDays > STOCK_OLD_DAYS) add({ id: `old:${loose(s.dish)}:${s.oldestAgeDays}`, check: 'Stock', line: `${s.remaining} ${s.dish} on the shelf for ${s.oldestAgeDays} days. Flash sale it.`, fix: 'home.html', fixLabel: 'Open Home' });
  }
  for (const b of cookBatches) {
    if (daysBetween(today, b.date) <= WINDOW && !(b.portions > 0)) add({ id: `noyield:${loose(b.dish)}:${iso(b.date)}`, check: 'Stock', line: `${b.dish} batch on ${formatDMY(b.date).slice(0, 5)} has no yield, so it has no cost per portion.`, fix: '/#batchcook', fixLabel: 'Open Kitchen Production' });
  }

  return out;
}

const parse = (s, fallback) => { try { const v = JSON.parse(s); return v == null ? fallback : v; } catch (err) { return fallback; } };

function summarise(findings) {
  const n = findings.length;
  const at = findings.reduce((s, f) => s + (f.baht || 0), 0);
  return { count: n, baht: at, light: n === 0 ? 'green' : n <= 3 ? 'amber' : 'red', text: n === 0 ? 'Audit: all clear' : `Audit: ${n} to review` };
}

// Collects the data once, runs the checks, stores the result. Never throws on a missing tab.
async function run({ store = require('./appState') } = {}) {
  const svc = require('./ledgerService');
  const pc = require('./pastaCosts');
  const today = bangkokToday();
  const d = await svc.loadAll();
  const live = require('./liveData');
  const pb = await live.loadPriceBook();
  const cards = await pc.loadCards(require('../data/pastaSeed.json'));
  const pastaCards = cards.map((c) => ({ card: c.card, cost: pc.costCard(c.card, pb, today) }));
  let expenseRows = []; try { expenseRows = await svc.readOrEmpty('Expense Log'); } catch (err) { /* skip */ }
  let stock = []; try { stock = (await svc.pitStock(d, today)) || []; } catch (err) { /* skip */ }
  let bank = null; try { bank = await require('./borrowed').loadBank(); } catch (err) { /* skip */ }
  const all = runChecks({ today, ledger: d.ledger, expenseRows, stock, cookBatches: d.cookBatches, closed: d.closed, pastaCards, bank });
  const result = { ranAt: new Date().toISOString(), findings: all };
  await store.setState(RESULT_KEY, JSON.stringify(result));
  return view(result, store);
}

// What the page shows: the stored result without what Lily has ignored.
async function view(result, store = require('./appState')) {
  const res = result || parse(await store.getState(RESULT_KEY), null);
  if (!res) return { ranAt: null, findings: [], ...summarise([]), never: true };
  const ignored = new Set(parse(await store.getState(IGNORE_KEY), []));
  const findings = res.findings.filter((f) => !ignored.has(f.id));
  return { ranAt: res.ranAt, findings, ignored: res.findings.length - findings.length, ...summarise(findings) };
}

async function ignore(id, { store = require('./appState') } = {}) {
  if (!id) throw new Error('Nothing to ignore');
  const cur = parse(await store.getState(IGNORE_KEY), []);
  if (!cur.includes(id)) cur.push(id);
  await store.setState(IGNORE_KEY, JSON.stringify(cur.slice(-300)));
  return view(null, store);
}

// One line for the Sunday message to the BOH group.
function sundayLine(v) {
  if (!v || v.never) return 'Audit: has not run yet.';
  if (!v.count) return 'Audit: all clear this week.';
  const top = v.findings[0];
  return `Audit: ${v.count} to review${v.baht >= 1 ? `, ${baht(v.baht)} at risk` : ''}. First up: ${top.line}`;
}

module.exports = { runChecks, run, view, ignore, summarise, sundayLine, RESULT_KEY, IGNORE_KEY };
