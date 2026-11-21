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
// Lily pulls the bank statement once a month, by the 5th of the next month, so the balance is only late after that.
const BANK_DUE_DAY = 5;
const STOCK_OLD_DAYS = 5;
const WINDOW = 30; // days looked back
// Where the Grab order screenshots live in Drive: Daily Screenshots, then the month folder, then a folder named like 17/11.
const DRIVE_SCREENSHOTS = 'https://drive.google.com/drive/folders/1RlTIVMOyF694vvZc9oHaRYQu5OG_hUSj';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayParts = (dmy) => { const m = String(dmy || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? { d: Number(m[1]), m: Number(m[2]), y: Number(m[3]) } : null; };
const shotHow = (dmy) => { const p = dayParts(dmy); const where = p ? `Daily Screenshots, ${MONTH_NAMES[p.m - 1]}, folder ${p.d}/${p.m}` : 'Daily Screenshots, the month folder, the day folder'; return `Upload its screenshot to Drive: ${where}. The 16:05 run picks it up and sends that day again, which fills in the customer and items. Or type them in here.`; };
const driveLink = { label: 'Open Drive screenshots', href: DRIVE_SCREENSHOTS, ext: true };

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

  // 1. Items or a customer name Grab could not read (XXXXXX). Most often the order's screenshot was never uploaded.
  const placeholder = (x) => /^x{3,}$/i.test(String(x || '').trim());
  const orderKey = (r) => `${r.channel}|${r.dmy}|${r.orderNo || r.key}`;
  const groups = new Map();
  for (const r of recent) { if (!r.key) continue; const k = orderKey(r); const g = groups.get(k) || []; g.push(r); groups.set(k, g); }
  for (const [k, rows] of groups) {
    const first = rows[0]; const noItems = rows.filter((r) => placeholder(r.desc));
    const noName = first.channel === 'Grab' && rows.some((r) => r.type === 'Order' && placeholder(r.customer));
    if (!noItems.length && !noName) continue;
    const money = rows.reduce((s, r) => s + (r.type === 'Order' ? (r.moneyIn || 0) * (r.qty || 1) : 0), 0);
    const ref = `${first.channel} order ${first.orderNo || ''} on ${first.dmy.slice(0, 5)}`.replace('order  on', 'order on');
    if (noItems.length) {
      add({ id: `unreadable:${k}`, check: 'Unreadable item', line: `${ref} has an item Grab could not read (shown as XXXXXX).`, how: shotHow(first.dmy), links: [driveLink], baht: money, action: { type: 'split', keys: noItems.map((r) => r.key), hint: 'For example: Dark Beer Stew + Tubetti' } });
    } else {
      add({ id: `nocust:${k}`, check: 'No customer name', line: `${ref} has no customer name (shown as XXXXXX).`, how: shotHow(first.dmy).replace('fills in the customer and items. Or type them in here.', 'fills in the customer. Or type the name in here.'), links: [driveLink], baht: 0, action: { type: 'customer', keys: rows.map((r) => r.key), hint: 'Customer name' } });
    }
  }

  // 2. Sold with no cost, and 4. food cost over 40%, from the same pass over recent orders.
  const sold = new Map();
  const dish = new Map();
  for (const r of recent) {
    if (placeholder(r.desc)) continue;
    if (r.type === 'Recipe' && (r.cost === null || r.cost <= 0)) {
      const k = loose(r.desc); const s = sold.get(k) || { name: r.desc, n: 0, money: 0, keys: [] }; s.n += r.qty || 1; if (r.key) s.keys.push(r.key); sold.set(k, s);
    }
    if (r.type !== 'Order') continue;
    const c = lineItemCost(r, table);
    if (c.missing) {
      const k = loose(c.missing); const s = sold.get(k) || { name: c.missing, n: 0, money: 0, keys: [] }; s.n += r.qty || 1; s.money += r.moneyIn || 0; if (r.key) s.keys.push(r.key); sold.set(k, s);
    } else if (r.moneyIn >= 10 && !/bundle/i.test(r.desc) && c.cost > 0) {
      // Noodles bundled with a stew or ragu are sold at ฿0 to ฿5 on purpose, so only rows sold at a real price are judged.
      const k = loose(r.desc); const d = dish.get(k) || { name: r.desc, money: 0, cost: 0, n: 0, from: r.date, to: r.date }; d.money += r.moneyIn * (r.qty || 1); d.cost += c.cost; d.n += r.qty || 1; if (r.date < d.from) d.from = r.date; if (r.date > d.to) d.to = r.date; dish.set(k, d);
    }
  }
  for (const [k, s] of sold) {
    const pasta = /pasta|risoni|tubetti|radiatori|rigatoni|lumache|linguine|spaghetti|farfalle|chefferi|heart/i.test(s.name);
    const clean = s.name.replace(/^pasta\s*-\s*/i, '').replace(/\s*\(.*\)/, '');
    const combined = /\s\+\s|\+/.test(s.name) && s.keys.length;
    if (combined) { add({ id: `combo:${k}`, check: 'Two items in one row', line: `"${s.name}" is one row but looks like several items. Split it so each item gets its own cost.`, baht: s.money, action: { type: 'split', keys: s.keys, text: s.name } }); continue; }
    add({ id: `nocost:${k}`, check: 'Sold with no cost', line: `${s.name} sold ${plural(s.n, 'time')} with no cost on record, so profit looks too high.${pasta ? ' Open its cost card.' : ' Type its cost per portion.'}`, baht: s.money, ...(pasta ? { fix: `recipes.html#Pasta - ${clean}`, fixLabel: 'Open cost card' } : { action: { type: 'cost', name: s.name } }) });
  }
  for (const [k, d] of dish) {
    const pct = d.cost / d.money;
    if (pct > FOOD_COST_LIMIT) {
      // Said one portion at a time, so it reads the same whether 1 or 40 were sold.
      const price = d.money / d.n; const cost = d.cost / d.n; const most = price * FOOD_COST_LIMIT; const over = cost - most;
      add({ id: `margin:${k}`, check: 'Margin', title: d.name, text: `Selling price ${baht(price)}, cost ${baht(cost)}. The cost is ${baht(over)} too much.`, line: `${d.name}: selling price ${baht(price)}, cost ${baht(cost)}. The cost is ${baht(over)} too much.`, hideBaht: true,
        baht: d.cost - FOOD_COST_LIMIT * d.money, fix: `reports.html?from=${encodeURIComponent(formatDMY(d.from))}&to=${encodeURIComponent(formatDMY(d.to))}&find=${encodeURIComponent(d.name)}`, fixLabel: 'See the sales rows' });
    }
  }

  // 3. Cost cards (pasta): a price missing, or a number still marked to confirm.
  for (const pc of pastaCards) {
    const k = pc.cost; const name = pc.card.name;
    if (k.missing.length) add({ id: `card-missing:${loose(name)}`, check: 'Cost card', line: `Pasta - ${name} has no price for ${list(k.missing)}, so its cost is too low.`, fix: `recipes.html#Pasta - ${name}`, fixLabel: 'Open cost card' });
    else if (k.guesses.length) add({ id: `card-guess:${loose(name)}:${k.guesses.join('|')}`, check: 'Cost card', line: `Pasta - ${name}: ${list(k.guesses)} still to confirm.`, fix: `recipes.html#Pasta - ${name}`, fixLabel: 'Open cost card' });
    if (k.foodPct !== null && k.foodPct > FOOD_COST_LIMIT && !k.missing.length) add({ id: `card-margin:${loose(name)}`, check: 'Margin', line: `Pasta - ${name} costs ${Math.round(k.foodPct * 100)}% of its price to make.`, baht: k.total - FOOD_COST_LIMIT * pc.card.sell, fix: `recipes.html#Pasta - ${name}`, fixLabel: 'Open cost card' });
    if (k.legacyReheat) add({ id: `card-reheat:${loose(name)}`, check: 'Cost card', line: `Pasta - ${name}: reheating is still counted per order, not in minutes. Enter its reheating minutes.`, fix: `recipes.html#Pasta - ${name}`, fixLabel: 'Open cost card' });
    if (k.portionsPerBox !== null && pc.card.cookedG > 0 && pc.card.dryG > 0 && pc.card.cookedG / pc.card.dryG > 3) add({ id: `card-yield:${loose(name)}`, check: 'Cost card', line: `Pasta - ${name}: ${Math.round(pc.card.dryG)}g dry giving ${Math.round(pc.card.cookedG)}g cooked looks off.`, fix: `recipes.html#Pasta - ${name}`, fixLabel: 'Open cost card' });
  }

  // 4. Days with no import. Grab arrives up to 2 days late, LINE up to 1.
  const have = { Grab: new Set(), LINE: new Set() };
  for (const r of ledger) if (have[r.channel]) have[r.channel].add(iso(r.date));
  for (const [ch, lag] of [['Grab', 3], ['LINE', 2]]) {
    if (!have[ch].size) continue;
    const gaps = []; const gapDays = [];
    for (let back = lag; back <= 14; back += 1) {
      const d = new Date(today.getTime() - back * 86400000);
      if (closed.has(iso(d)) || have[ch].has(iso(d))) continue;
      gaps.push(formatDMY(d).slice(0, 5)); gapDays.push(formatDMY(d));
    }
    if (gaps.length) {
      const how = ch === 'Grab'
        ? "Upload that day's Grab screenshots to Drive (Daily Screenshots, the month folder, a folder named like 15/11). The 16:05 run sends each finished day to BOH. If the shop was shut, type close 15/11 and a reason in the BOH LINE group."
        : 'Press Sync LINE orders under Tools on Numbers. If the shop was shut, type close 15/11 and a reason in the BOH LINE group.';
      add({ id: `gap:${ch}:${gaps.join(',')}`, check: 'Missing days', line: `${ch} has no orders on ${list(gaps, 4)}.`, how, chips: gapDays.map((x) => ({ label: x.slice(0, 5), href: `reports.html?from=${encodeURIComponent(x)}&to=${encodeURIComponent(x)}` })), links: ch === 'Grab' ? [driveLink] : [], fix: ch === 'Grab' ? undefined : 'reports.html#tools', fixLabel: ch === 'Grab' ? undefined : 'Open Numbers tools' });
    }
  }

  // 5. Same order counted twice in the Ledger.
  const keys = new Map();
  for (const r of ledger) { if (!r.key) continue; const a = keys.get(r.key) || []; a.push(r); keys.set(r.key, a); }
  const dupes = [...keys.values()].filter((a) => a.length > 1);
  if (dupes.length) add({ id: `ledger-dupes:${dupes.length}`, check: 'Totals', line: `${plural(dupes.length, 'ledger row')} appear twice, so sales are counted twice.`, baht: dupes.reduce((s, a) => s + a.slice(1).reduce((x, r) => x + (r.moneyIn || 0), 0), 0), fix: 'reports.html', fixLabel: 'Open Numbers' });

  // 6. Receipts: no shop or no date, and the same line twice. Each bad line is listed so it can be fixed right on the card.
  const seen = new Map(); let noShop = 0, noShopBaht = 0, noDate = 0; let dup = 0, dupBaht = 0;
  const lines = { noDate: [], noShop: [], dup: [] };
  expenseRows.forEach((r, i) => {
    if (i === 0 && /date/i.test(String(r[0] || ''))) return; // the header row ("Shopping Date")
    const name = String(r[1] || '').trim(); if (!name) return;
    const price = Number(String(r[2] ?? '').replace(/[฿,\s]/g, '')) || 0;
    const date = parseDate(String(r[0] || ''), today);
    const rid = (String(r[6] || '').match(/R\d{6}-\d{6}/) || [''])[0];
    const row = { date: String(r[0] || '').trim(), item: name, qty: String(r[3] || '').trim(), price, shop: String(r[5] || '').trim() };
    const ref = { t: 'E', i, d: String(r[0] || ''), n: String(r[1] || ''), p: String(r[2] || '') };
    const text = `${row.date || 'No date'}, ${name}${row.qty ? ' ' + row.qty : ''}, ${baht(price)}${row.shop ? ' at ' + row.shop : ''}`;
    if (!date) { noDate += 1; lines.noDate.push({ text, ref, row }); return; }
    if (daysBetween(today, date) > WINDOW) return;
    if (!row.shop) { noShop += 1; noShopBaht += price; lines.noShop.push({ text, ref, row }); }
    const k = `${iso(date)}|${loose(name)}|${price}|${loose(row.shop)}`;
    // The same line several times inside ONE receipt is several of the item (three bottles). Only a repeat from another receipt is a double entry.
    if (seen.has(k)) { const first = seen.get(k); if (!rid || rid !== first) { dup += 1; dupBaht += price; lines.dup.push({ text, ref, row }); } } else seen.set(k, rid || true);
  });
  const rcptItems = (arr, kind) => arr.slice(0, 10).map((x) => ({ text: x.text, ref: x.ref, row: x.row, kind }));
  const rcptMore = (n) => (n > 10 ? { fix: '/#receipts', fixLabel: `Open Purchasing Receipts (${n - 10} more)` } : {});
  if (noDate) add({ id: `rcpt-nodate:${noDate}`, check: 'Receipts', line: `${plural(noDate, 'receipt line')} ${noDate === 1 ? 'has' : 'have'} no readable date, so ${noDate === 1 ? 'it does' : 'they do'} not show in the receipts list.`, items: rcptItems(lines.noDate, 'date'), ...rcptMore(noDate) });
  if (noShop) add({ id: `rcpt-noshop:${noShop}`, check: 'Receipts', line: `${plural(noShop, 'receipt line')} in the last 30 days ${noShop === 1 ? 'has' : 'have'} no shop.`, baht: noShopBaht, items: rcptItems(lines.noShop, 'shop'), ...rcptMore(noShop) });
  if (dup) add({ id: `rcpt-dup:${dup}:${Math.round(dupBaht)}`, check: 'Receipts', line: `${plural(dup, 'receipt line')} ${dup === 1 ? 'looks' : 'look'} entered twice (same day, item, price and shop). The second copy is listed. Delete it if it is a repeat.`, baht: dupBaht, items: rcptItems(lines.dup, 'delete'), ...rcptMore(dup) });

  // 7. Bank balance not refreshed.
  const asOf = bank && parseDate(String(bank.asOf || ''));
  const lastMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  if (asOf && today.getUTCDate() > BANK_DUE_DAY && asOf.getTime() < lastMonthEnd.getTime()) add({ id: `bank:${bank.asOf}`, check: 'Bank', line: `The bank balance is from ${bank.asOf}. Last month's statement (up to ${formatDMY(lastMonthEnd)}) was due by the ${BANK_DUE_DAY}th, so cash figures are drifting.`, fix: 'reports.html', fixLabel: 'Open Numbers' });

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
