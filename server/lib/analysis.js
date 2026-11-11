// Business analysis: weekly and monthly performance from the Ledger-based reports, October onwards.
// Pure functions. Weeks run Sunday to Saturday, the same as the Numbers page, so the two always agree.
const { formatDMY, utc, parseDate, daysBetween } = require('./dates');
const { batchDishOf, normName, NOT_A_PORTION } = require('./dishes');
const { periodOf, hourOf, sellThrough, priceMoves } = require('./reports');
const { historyMonths } = require('./history');

const FROM = utc(2026, 10, 1);
const MASTER_FROM = utc(2026, 8, 1);   // Aug and Sep 2026 come from the Master Log (no time of day, no cook batches)
const START = utc(2025, 11, 1);       // the very first month of Merlin's Dish
const GRAB_START = '2026-05';         // Grab operations begin
const GRAB_CUT = 0.32;                // Grab's cut, used only when a dish has never sold on LINE
const parseDMYs = (t) => { const [d, m, y] = String(t).split('/').map(Number); return utc(y, m, d); };
const r1 = (n) => Math.round(n * 10) / 10;
const pct = (a, b) => (b > 0 ? r1((a / b) * 100) : null);
const change = (now, before) => (before > 0 ? r1(((now - before) / before) * 100) : null);

function shape(p, today, kind, ch, rep) {
  const gross = p.grab.gross + p.line.gross;
  const orders = p.grab.orders + p.line.orders;
  const fees = p.grab.commission + p.grab.marketing + p.grab.otherFees;
  return {
    label: kind === 'month' ? p.label : `${formatDMY(p.from).slice(0, 5)} to ${formatDMY(p.to).slice(0, 5)}`,
    from: formatDMY(p.from), to: formatDMY(p.to),
    inProgress: p.to >= today,                    // this week or month is not finished
    startsBeforeOct: p.from < FROM,               // the first week can start in September
    gross: Math.round(gross), revenue: Math.round(p.revenue), foodCost: Math.round(p.foodCost), margin: Math.round(p.margin),
    marginPct: p.marginPct, orders, lineOrders: p.line.orders,
    aov: orders ? Math.round(gross / orders) : null,
    grabShare: pct(p.grab.gross, gross),
    discountPct: pct(p.grab.discount + p.line.discount, gross),
    grabFeePct: pct(fees, p.grab.gross),
    foodCostPct: pct(p.foodCost, gross),
    ads: Math.round(p.ads), overheads: Math.round(p.overheads), portionsCooked: p.cookPortions,
    // three sales lines
    grabOrders: p.grab.orders, igOrders: ch ? ch.ig.size : 0, lineOnlyOrders: ch ? ch.line.size : 0,
    grabGross: ch ? Math.round(ch.gross.grab) : Math.round(p.grab.gross), lineGross: ch ? Math.round(ch.gross.line) : 0, igGross: ch ? Math.round(ch.gross.ig) : 0,
    newOrders: rep ? rep.newOrders : 0, repeatOrders: rep ? rep.repeatOrders : 0,
    repeatPct: rep && (rep.newOrders + rep.repeatOrders) ? Math.round((rep.repeatOrders / (rep.newOrders + rep.repeatOrders)) * 1000) / 10 : null,
    adsPerDirectOrder: p.ads > 0 && (p.line.orders) ? Math.round(p.ads / p.line.orders) : null,
  };
}

// Items sold per month (portions), batch dishes by name, everything else by its ledger description.
function inPeriod(d, per, floor = FROM) { return d >= floor && (!per || ((!per.from || d >= per.from) && (!per.to || d <= per.to))); }
function itemMix(ledger, today, per = null, masterEvents = []) {
  const months = new Map();
  for (const e of masterEvents) {
    if (!inPeriod(e.date, per, MASTER_FROM) || !(e.qty > 0) || NOT_A_PORTION.test(e.desc)) continue;
    const key = `${e.date.getUTCFullYear()}-${String(e.date.getUTCMonth() + 1).padStart(2, '0')}`;
    const name = batchDishOf(e.desc) || e.desc.replace(/\s*\(.*$/, '').trim();
    if (!name) continue;
    if (!months.has(key)) months.set(key, new Map());
    const m = months.get(key); m.set(name, (m.get(name) || 0) + e.qty);
  }
  for (const r of ledger) {
    if (!inPeriod(r.date, per) || r.type !== 'Order' || !(r.qty > 0)) continue;
    const key = `${r.date.getUTCFullYear()}-${String(r.date.getUTCMonth() + 1).padStart(2, '0')}`;
    const name = batchDishOf(r.desc) || r.desc.replace(/\s*\(.*$/, '').trim();
    if (!name) continue;
    if (!months.has(key)) months.set(key, new Map());
    const m = months.get(key); m.set(name, (m.get(name) || 0) + r.qty);
  }
  return [...months].sort().map(([key, m]) => ({ month: key, items: [...m].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, qty]) => ({ name, qty })) }));
}


// ---- channels -----------------------------------------------------------------------------------------
// Three sales lines: Grab, LINE (direct, everything that is not Grab or Instagram) and Instagram.
const CHANNELS = ['grab', 'line', 'ig'];
const channelFromText = (a, b, date) => {
  const t = `${a || ''} ${b || ''}`;
  if (/grab/i.test(t)) return 'grab';
  // From May 2026 a blank "Order from" is a Grab dish with no new/returning label. Direct customers are always named.
  if (!String(b || '').trim() && date && date >= utc(2026, 5, 1)) return 'grab';
  if (/insta|(^|\W)ig(\W|$)/i.test(t)) return 'ig';
  return 'line';
};
const channelOfLedger = (r) => (r.channel === 'Grab' ? 'grab' : /^(ig|instagram)$/i.test(r.orderFrom) ? 'ig' : 'line');
const num0 = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const keyOf = (e) => `${formatDMY(e.date)}|${e.orderNo}|${normName(e.desc)}|${e.qty}|${e.money}`;

// Order rows from a raw sheet (Master Log or Sheet1): Date | Description | Branch | Order from | Type | QTY | Money In | Cost | Net | Customer | Order No
function eventsFromRows(rows = [], { carryDate = false, from = null, to = null } = {}) {
  const out = []; let last = null;
  rows.forEach((r, i) => {
    if (!r || (i === 0 && /date/i.test(String(r[0] || '')))) return;
    let date = parseDate(r[0]);
    if (date) last = date; else if (carryDate && String(r[0] ?? '').trim() === '' && String(r[1] || '').trim()) date = last;
    if (!date || (from && date < from) || (to && date >= to)) return;
    if (String(r[4] || '').trim().toLowerCase() !== 'order') return;
    // Money In is the price of ONE portion. Net Income is portions x price, so that is the sales figure.
    const qty = num0(r[5]); const money = num0(r[8]) || qty * num0(r[6]);
    if (!(qty > 0) && !(money > 0)) return;
    out.push({ date, desc: String(r[1] || '').trim(), channel: channelFromText(r[2], r[3], date), branch: String(r[2] || '').trim(), orderFrom: String(r[3] || '').trim(), qty, money, orderNo: String(r[10] || '').trim(), customer: String(r[9] || '').trim() });
  });
  return out;
}
function eventsFromLedger(ledger, { from = null } = {}) {
  return ledger.filter((r) => r.type === 'Order' && (!from || r.date >= from)).map((r) => ({
    date: r.date, desc: r.desc, channel: channelOfLedger(r), branch: r.channel, orderFrom: r.orderFrom, qty: r.qty || 0, money: r.net ?? ((r.moneyIn || 0) * (r.qty || 0)), orderNo: r.orderNo,
  }));
}

// Every order line since the start, never counted twice: the Master Log runs to the end of September, BOH (the Ledger) takes over from 01/10/2026.
function allEvents({ master = [], ledger = [] }) {
  const oct = utc(2026, 10, 1);
  const a = eventsFromRows(master, { carryDate: true, to: oct });
  const b = eventsFromLedger(ledger, { from: oct });
  return { events: [...a, ...b], masterEvents: a };
}

function emptySteps(type, from, today) {
  const keys = new Map();
  const step = (d) => (type === 'week' ? new Date(d.getTime() + 7 * 86400000) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
  let d = periodOf(from, type).from;
  for (let g = 0; d <= today && g < 400; d = step(d), g += 1) { const p = periodOf(d, type); keys.set(p.key, { key: p.key, from: p.from, to: p.to, label: type === 'month' ? p.label : `${formatDMY(p.from).slice(0, 5)} to ${formatDMY(p.to).slice(0, 5)}`, inProgress: p.to >= today }); }
  return keys;
}

// Sales (baht) and portions per channel per week or month, since the very first order.
function buildHistory({ events, today }) {
  const first = events.length ? events.reduce((m, e) => (e.date < m ? e.date : m), events[0].date) : START;
  const from = first < START ? first : START;
  const out = {};
  for (const type of ['week', 'month']) {
    const steps = emptySteps(type, from, today);
    for (const v of steps.values()) Object.assign(v, { grab: 0, line: 0, ig: 0, portionsGrab: 0, portionsLine: 0, portionsIg: 0 });
    for (const e of events) {
      const v = steps.get(periodOf(e.date, type).key); if (!v) continue;
      v[e.channel] += e.money;
      v[`portions${e.channel === 'grab' ? 'Grab' : e.channel === 'ig' ? 'Ig' : 'Line'}`] += e.qty;
    }
    out[type === 'week' ? 'weeks' : 'months'] = [...steps.values()].map((v) => ({
      label: v.label, key: v.key, inProgress: v.inProgress,
      grab: Math.round(v.grab), line: Math.round(v.line), ig: Math.round(v.ig), total: Math.round(v.grab + v.line + v.ig),
      portionsGrab: v.portionsGrab, portionsLine: v.portionsLine, portionsIg: v.portionsIg,
    }));
  }
  const map = new Map();
  for (const e of events) { const k = `${e.branch}|${e.orderFrom}|${e.channel}`; map.set(k, (map.get(k) || 0) + 1); }
  const mapping = [...map].map(([k, rows]) => { const [branch, orderFrom, channel] = k.split('|'); return { branch, orderFrom, channel, rows }; }).sort((a, b) => b.rows - a.rows).slice(0, 14);
  return { ...out, mapping, first: formatDMY(first), markers: { start: '2025-11', grab: GRAB_START } };
}

// Monthly result straight from the Master Log: sales (Order and Delivery rows) less every cost row logged (recipe, ads, overheads,
// Grab fees, riders, waste, staff). Net Income is the figure each row already carries. Rows are never counted twice.
function monthlyResult(master = [], today) {
  const oct = utc(2026, 10, 1);
  // The Master Log is used to the end of September 2026 only. From October the numbers come from BOH (see buildAnalysis).
  const cut = utc(2026, 10, 1);
  const by = new Map(); let last = null; let lastDate = null;
  master.forEach((r, i) => {
    if (!r || (i === 0 && /date/i.test(String(r[0] || '')))) return;
    let date = parseDate(r[0]);
    if (date) last = date; else if (String(r[0] ?? '').trim() === '' && String(r[1] || '').trim()) date = last;
    if (!date || date >= cut) return;
    const type = String(r[4] || '').trim().toLowerCase();
    const net = num0(r[8]) || (type === 'order' || type === 'delivery' ? num0(r[5]) * num0(r[6]) : -num0(r[7]));
    if (!type || !net) return;
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const v = by.get(key) || { sales: 0, costs: 0 };
    if (type === 'order' || type === 'delivery') v.sales += net; else v.costs += Math.abs(net) * (net < 0 ? 1 : -1);
    by.set(key, v);
    if (!lastDate || date > lastDate) lastDate = date;
  });
  const months = [...by].sort().map(([key, v]) => ({ key, label: `${key.slice(5)}/${key.slice(0, 4)}`, sales: Math.round(v.sales), costs: Math.round(v.costs), net: Math.round(v.sales - v.costs), inProgress: false }));
  return { months, lastDate: lastDate ? formatDMY(lastDate) : null };
}

// Aug and Sep from the Master Log. Sales, orders and channels come from the order rows; margin for a MONTH is the
// Master Log's own monthly profit (history table). A week in Aug/Sep has no margin, food cost is not split out there.
function masterRecipeCosts(master = []) {
  const out = []; let last = null;
  master.forEach((r, i) => {
    if (!r || (i === 0 && /date/i.test(String(r[0] || '')))) return;
    let date = parseDate(r[0]);
    if (date) last = date; else if (String(r[0] ?? '').trim() === '' && String(r[1] || '').trim()) date = last;
    if (!date || date < MASTER_FROM || date >= FROM || String(r[4] || '').trim().toLowerCase() !== 'recipe') return;
    const v = Math.abs(num0(r[8]) || num0(r[5]) * num0(r[7])); if (v > 0) out.push({ date, cost: v });
  });
  return out;
}
function masterPeriods(masterEvents, type, today, per, recipeCosts = []) {
  const firstSeen = new Map();
  for (const e of [...masterEvents].sort((a, b) => a.date - b.date)) { const w = normName(e.customer); if (w && !firstSeen.has(w)) firstSeen.set(w, e.date.getTime()); }
  const by = new Map();
  const orders = new Map();
  for (const e of masterEvents) {
    if (e.date >= FROM || e.date < MASTER_FROM) continue;
    const pr = periodOf(e.date, type); const key = pr.key;
    if (!by.has(key)) by.set(key, { pr, gross: { grab: 0, line: 0, ig: 0 }, ord: { grab: new Set(), line: new Set(), ig: new Set() } });
    const v = by.get(key); v.gross[e.channel] += e.money;
    if (e.orderNo) {
      const k = `${formatDMY(e.date)}|${e.orderNo}`;
      if (!v.ord[e.channel].has(k) && e.customer && e.channel !== 'grab') { v.seen = v.seen || new Set(); if (!v.seen.has(k)) { v.seen.add(k); if (firstSeen.get(normName(e.customer)) < e.date.getTime()) v.rep = (v.rep || 0) + 1; else v.nw = (v.nw || 0) + 1; } }
      v.ord[e.channel].add(k);
    }
  }
  for (const c of recipeCosts) { if (c.date >= FROM || c.date < MASTER_FROM) continue; const v = by.get(periodOf(c.date, type).key); if (v) v.food = (v.food || 0) + c.cost; }
  const hist = new Map(historyMonths().map((h) => [h.key, h]));
  return [...by.values()].sort((a, b) => a.pr.from - b.pr.from).filter((v) => !per || ((!per.from || v.pr.to >= per.from) && (!per.to || v.pr.from <= per.to))).map((v) => {
    const gross = v.gross.grab + v.gross.line + v.gross.ig;
    const n = v.ord.grab.size + v.ord.line.size + v.ord.ig.size;
    const h = type === 'month' ? hist.get(v.pr.key) : null;
    const margin = h ? Math.round(h.margin) : null;
    const grossH = h ? h.grab.gross + h.line.gross : gross;
    return {
      label: type === 'month' ? v.pr.label : `${formatDMY(v.pr.from).slice(0, 5)} to ${formatDMY(v.pr.to).slice(0, 5)}`,
      from: formatDMY(v.pr.from), to: formatDMY(v.pr.to), inProgress: false, startsBeforeOct: true, fromMaster: true,
      gross: Math.round(h ? grossH : gross), revenue: h ? Math.round(h.revenue) : null, foodCost: v.food ? Math.round(v.food) : null, margin, marginPct: h && grossH > 0 ? r1((margin / grossH) * 100) : null,
      orders: n, lineOrders: v.ord.line.size + v.ord.ig.size, aov: n ? Math.round(gross / n) : null,
      grabShare: pct(v.gross.grab, gross), discountPct: h ? pct(h.grab.discount, grossH) : null, grabFeePct: h && h.grab.gross ? pct(h.grab.commission + h.grab.marketing + h.grab.otherFees, h.grab.gross) : null, foodCostPct: v.food ? pct(v.food, gross) : null,
      ads: h ? Math.round(h.ads) : null, overheads: null, portionsCooked: null,
      grabOrders: v.ord.grab.size, igOrders: v.ord.ig.size, lineOnlyOrders: v.ord.line.size,
      grabGross: Math.round(v.gross.grab), lineGross: Math.round(v.gross.line), igGross: Math.round(v.gross.ig),
      newOrders: v.nw || 0, repeatOrders: v.rep || 0, repeatPct: (v.nw || v.rep) ? r1(((v.rep || 0) / ((v.nw || 0) + (v.rep || 0))) * 100) : null, adsPerDirectOrder: h && h.ads > 0 && (v.ord.line.size + v.ord.ig.size) ? Math.round(h.ads / (v.ord.line.size + v.ord.ig.size)) : null,
    };
  });
}

// Orders and sales per channel from the Ledger (October on), for the three lines with orders.
function channelOrders(ledger, type) {
  const by = new Map();
  for (const r of ledger) {
    if (r.type !== 'Order' || r.date < FROM) continue;
    const key = periodOf(r.date, type).key; const ch = channelOfLedger(r);
    if (!by.has(key)) by.set(key, { grab: new Set(), line: new Set(), ig: new Set(), gross: { grab: 0, line: 0, ig: 0 } });
    const v = by.get(key);
    if (r.orderNo) v[ch].add(`${r.dmy}|${r.orderNo}`);
    v.gross[ch] += r.net ?? 0;
  }
  return by;
}

// ---- repeat customers ---------------------------------------------------------------------------------
// A repeat order is one from a customer who ordered on an earlier day (counting from October, the first day of the Ledger).
function repeatCustomers(ledger, type) {
  const orders = new Map();
  for (const r of ledger) {
    if (r.type !== 'Order' || r.date < FROM || !r.customer) continue;
    const k = `${r.channel}|${r.dmy}|${r.orderNo || r.customer}`;
    if (!orders.has(k)) orders.set(k, { date: r.date, who: normName(r.customer) });
  }
  const list = [...orders.values()].sort((a, b) => a.date - b.date);
  const firstSeen = new Map();
  const by = new Map();
  for (const o of list) {
    const key = periodOf(o.date, type).key;
    if (!by.has(key)) by.set(key, { newOrders: 0, repeatOrders: 0 });
    const f = firstSeen.get(o.who);
    if (f === undefined || f.getTime() === o.date.getTime()) { if (f === undefined) firstSeen.set(o.who, o.date); by.get(key).newOrders += 1; } else by.get(key).repeatOrders += 1;
  }
  return by;
}

// ---- when orders come: weekday by hour ----------------------------------------------------------------
function heatmap(ledger, per = null, masterEvents = []) {
  const seen = new Set(); const grid = Array.from({ length: 7 }, () => ({})); let noTime = 0; let total = 0;
  for (const r of ledger) {
    if (r.type !== 'Order' || !inPeriod(r.date, per)) continue;
    const k = `${r.channel}|${r.dmy}|${r.orderNo || `${r.time}${r.customer}`}`;
    if (!r.orderNo && !r.customer) continue;
    if (seen.has(k)) continue; seen.add(k); total += 1;
    const hh = hourOf(r.time); if (hh === null) { noTime += 1; continue; }
    const wd = r.date.getUTCDay(); // Sunday = 0
    grid[wd][hh] = (grid[wd][hh] || 0) + 1;
  }
  // Aug and Sep (Master Log) have the date but not the time, so they count toward the weekday totals only.
  const dayOnly = Array(7).fill(0); const mseen = new Set(); let masterOrders = 0;
  for (const e of masterEvents) {
    if (!inPeriod(e.date, per, MASTER_FROM) || e.date >= FROM || !e.orderNo) continue;
    const k = `${formatDMY(e.date)}|${e.orderNo}`; if (mseen.has(k)) continue; mseen.add(k);
    dayOnly[e.date.getUTCDay()] += 1; masterOrders += 1;
  }
  // The day always runs 10:00 to 22:00, and stretches only if an order lands outside it.
  const seenHours = [...new Set(grid.flatMap((g) => Object.keys(g).map(Number)))];
  const lo = Math.min(10, ...seenHours); const hi = Math.max(22, ...seenHours);
  const cols = []; for (let h = lo; h <= hi; h += 1) cols.push(String(h).padStart(2, '0'));
  const max = Math.max(1, ...grid.flatMap((g) => Object.values(g)));
  // All seven days, Sunday on top to Saturday at the bottom, so it is ready if Merlin's Dish opens weekends.
  const order = [0, 1, 2, 3, 4, 5, 6];
  const noHourOf = (i) => dayOnly[i];
  return { days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], hours: cols, cells: order.map((i) => cols.map((h) => grid[i][h] || 0)), max, noTime, total: total + masterOrders,
    perDay: order.map((i) => Object.values(grid[i]).reduce((x, y) => x + y, 0) + noHourOf(i)), dayOnly, masterOrders };
}

// ---- cooked against sold, stock sitting, price creep, break-even --------------------------------------
function dishPerformance({ ledger, cookBatches, expense, today, per = null, waste = [], countRows = [] }) {
  const allLedger = ledger; const allBatches = cookBatches;
  ledger = ledger.filter((r) => inPeriod(r.date, per)); cookBatches = cookBatches.filter((b) => inPeriod(b.date, per));
  if (per) expense = expense.filter((e) => !e.date || ((!per.from || e.date >= per.from) && (!per.to || e.date <= per.to)));
  waste = waste.filter((w) => inPeriod(w.date, per));
  const st = sellThrough(ledger, cookBatches, today, waste);
  // A count typed on the Ready Counts tab beats cooked minus sold for that dish (count, plus cooked after it, minus sold after it).
  const counted = new Map(require('./logViews').buildReadyStock({ today, ledger: allLedger, cookBatches: allBatches, countRows }).items.filter((i) => i.basis === 'counted').map((i) => [String(i.dish).toLowerCase(), i]));
  const sitting = st.map((d) => {
    const c = counted.get(String(d.dish).toLowerCase());
    const remaining = c ? c.left : d.remaining;
    const age = c ? (c.ageDays || 0) : d.oldestAgeDays;
    return { dish: d.dish, cooked: d.cooked, sold: d.sold, wasted: d.wasted, wasteCost: Math.round(d.wasteCost), remaining, counted: !!c, sellPct: d.cooked ? Math.round((d.sold / d.cooked) * 100) : null, oldestAgeDays: age, old: age > 5 && remaining > 0 };
  });

  const batches = new Map();
  for (const b of cookBatches.filter((x) => x.date >= FROM && x.portions > 0 && x.cost > 0)) {
    if (!batches.has(b.dish)) batches.set(b.dish, []);
    batches.get(b.dish).push({ date: formatDMY(b.date), t: b.date.getTime(), portions: b.portions, cost: Math.round(b.cost), perPortion: Math.round((b.cost / b.portions) * 100) / 100 });
  }
  const creep = [...batches].map(([dish, list]) => {
    list.sort((a, b) => a.t - b.t);
    const f = list[0]; const l = list[list.length - 1];
    return { dish, batches: list.map(({ date, perPortion, portions }) => ({ date, perPortion, portions })), first: f.perPortion, latest: l.perPortion, changePct: f.perPortion > 0 ? Math.round(((l.perPortion - f.perPortion) / f.perPortion) * 1000) / 10 : null };
  });
  const moves = priceMoves(expense, 0.1).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 10)
    .map((m) => ({ name: m.name, date: formatDMY(m.date), from: Math.round(m.from * 10000) / 10000, to: Math.round(m.to * 10000) / 10000, changePct: Math.round(m.change * 1000) / 10 }));

  // Break-even: what the latest batch cost, over what one portion earns. LINE price (kept in full), else Grab price less Grab's cut.
  const price = new Map();
  for (const r of ledger) {
    if (r.type !== 'Order' || r.date < FROM || !(r.qty > 0)) continue;
    const dish = batchDishOf(r.desc); if (!dish) continue;
    const ch = r.channel === 'Grab' ? 'grab' : 'line';
    const p = price.get(dish) || { grab: [0, 0], line: [0, 0] };
    p[ch][0] += r.net ?? 0; p[ch][1] += r.qty; price.set(dish, p);
  }
  const breakEven = creep.map((c) => {
    const p = price.get(c.dish); const last = batches.get(c.dish).slice(-1)[0];
    let earn = null; let basis = '';
    if (p && p.line[1] > 0) { earn = p.line[0] / p.line[1]; basis = 'LINE price'; }
    else if (p && p.grab[1] > 0) { earn = (p.grab[0] / p.grab[1]) * (1 - GRAB_CUT); basis = `Grab price less ${Math.round(GRAB_CUT * 100)}%`; }
    const be = earn > 0 ? Math.ceil(last.cost / earn) : null;
    return { dish: c.dish, batchCost: last.cost, batchDate: last.date, portions: last.portions, earnPerPortion: earn === null ? null : Math.round(earn), basis, breakEvenPortions: be, breakEvenPct: be && last.portions ? Math.round((be / last.portions) * 100) : null };
  });
  // Menu engineering: profit per serve in each channel (Grab after Grab's cut, direct in full), units sold, then the four boxes.
  // Popular = at least 70% of an even share of units. Profitable = at or above the average profit per serve, weighted by units.
  const rows = [];
  for (const c of creep) {
    const p = price.get(c.dish); if (!p) continue;
    const cost = c.latest; const grabUnits = p.grab[1]; const lineUnits = p.line[1]; const units = grabUnits + lineUnits;
    if (!(units > 0) || !(cost > 0)) continue;
    const grabEarn = grabUnits > 0 ? (p.grab[0] / grabUnits) * (1 - GRAB_CUT) : null;
    const lineEarn = lineUnits > 0 ? p.line[0] / lineUnits : null;
    const totalProfit = (grabEarn === null ? 0 : (grabEarn - cost) * grabUnits) + (lineEarn === null ? 0 : (lineEarn - cost) * lineUnits);
    rows.push({ dish: c.dish, cost, units, grabUnits, lineUnits, grabProfit: grabEarn === null ? null : Math.round(grabEarn - cost), lineProfit: lineEarn === null ? null : Math.round(lineEarn - cost), perServe: totalProfit / units, totalProfit: Math.round(totalProfit) });
  }
  const allUnits = rows.reduce((a, r) => a + r.units, 0);
  const avgProfit = allUnits ? rows.reduce((a, r) => a + r.perServe * r.units, 0) / allUnits : 0;
  const popularAt = rows.length ? (allUnits / rows.length) * 0.7 : 0;
  const engineering = rows.map((r) => {
    const popular = r.units >= popularAt; const profitable = r.perServe >= avgProfit;
    const box = popular && profitable ? 'Star' : popular ? 'Plowhorse' : profitable ? 'Puzzle' : 'Dog';
    return { ...r, perServe: Math.round(r.perServe), box };
  }).sort((a, b) => b.totalProfit - a.totalProfit);
  return { sitting, creep, moves, breakEven, engineering, engineeringBars: { avgProfit: Math.round(avgProfit), popularAt: Math.round(popularAt) } };
}

// Master Log months to September, then BOH months from October (sales after Grab fees, and what is left after costs).
function withBoh(res, bohMonths) {
  const extra = bohMonths.map((m) => ({ key: m.label, label: m.label, sales: m.revenue, costs: m.revenue - m.margin, net: m.margin, inProgress: m.inProgress }));
  return { months: [...res.months, ...extra], lastDate: res.lastDate };
}

// Master Log months to September, then BOH months (revenue after Grab fees, and the margin after food, overheads and ads).
function resultWithBoh(res, months) {
  const keyOfM = (m) => `${m.from.slice(6)}-${m.from.slice(3, 5)}`;
  const boh = months.filter((m) => keyOfM(m) >= '2026-10').map((m) => ({ key: keyOfM(m), label: m.label, sales: m.revenue, costs: m.revenue - m.margin, net: m.margin, inProgress: m.inProgress }));
  return { ...res, months: [...res.months, ...boh] };
}

function buildAnalysis({ weekly = [], monthly = [], ledger = [], today, master = [], cookBatches = [], expense = [], waste = [], lotBook = null, period = null, countRows = [] }) {
  const per = period && (period.from || period.to) ? period : null;
  const overlaps = (p) => !per || ((!per.from || p.to >= per.from) && (!per.to || p.from <= per.to));
  const chW = channelOrders(ledger, 'week'); const chM = channelOrders(ledger, 'month');
  const rpW = repeatCustomers(ledger, 'week'); const rpM = repeatCustomers(ledger, 'month');
  const { events, masterEvents } = allEvents({ master, ledger });
  const firstLedgerWeek = weekly.filter((p) => p.to >= FROM)[0];
  const rc = masterRecipeCosts(master);
  const mW = masterPeriods(masterEvents, 'week', today, per, rc).filter((w) => !firstLedgerWeek || parseDMYs(w.from) < firstLedgerWeek.from);
  const mM = masterPeriods(masterEvents, 'month', today, per, rc);
  const weeks = [...mW, ...weekly.filter((p) => p.to >= FROM && overlaps(p)).map((p) => shape(p, today, 'week', chW.get(p.key), rpW.get(p.key)))];
  const months = [...mM, ...monthly.filter((p) => p.to >= FROM && overlaps(p)).map((p) => shape(p, today, 'month', chM.get(p.key), rpM.get(p.key)))];
  const done = weeks.filter((w) => !w.inProgress && !w.startsBeforeOct && w.gross > 0 && !w.fromMaster);
  const best = done.length ? done.reduce((a, b) => (b.margin > a.margin ? b : a)) : null;
  const worst = done.length ? done.reduce((a, b) => (b.margin < a.margin ? b : a)) : null;
  const last = weeks.filter((w) => !w.inProgress && !w.fromMaster).slice(-2);
  const notes = [];
  if (last.length === 2) notes.push({ title: 'Last finished week against the one before', text: `Gross ${change(last[1].gross, last[0].gross) ?? 'n/a'}%, margin ${change(last[1].margin, last[0].margin) ?? 'n/a'}%, orders ${last[1].orders} against ${last[0].orders}.` });
  if (best && worst && best !== worst) notes.push({ title: 'Best and weakest full week', text: `Best: ${best.label}, margin ฿${best.margin.toLocaleString('en-AU')}. Weakest: ${worst.label}, margin ฿${worst.margin.toLocaleString('en-AU')}.` });
  const dishes = dishPerformance({ ledger, cookBatches, expense, today, per, waste, countRows });
  const owner = (() => {
    const own = require('./ownerViews');
    const delivery = own.deliveryScorecard(ledger.filter((r) => inPeriod(r.date, per)));
    const breakEven = own.weeklyBreakEven(weeks);
    const cash = own.cashTiedUp(lotBook, dishes.sitting, dishes.creep);
    return { delivery, breakEven, cash, monday: own.mondayPage({ weeks, delivery, breakEven, cash, dishes }) };
  })();
  return {
    owner,
    today: formatDMY(today), from: formatDMY(FROM), weeks, months, mix: itemMix(ledger, today, per, masterEvents), notes, best: best && best.label, worst: worst && worst.label,
    history: { ...buildHistory({ events, today }), result: withBoh(monthlyResult(master, today), months) },
    heatmap: heatmap(ledger, per, masterEvents),
    dishes,
    period: per ? { from: per.from ? formatDMY(per.from) : null, to: per.to ? formatDMY(per.to) : null } : null,
  };
}

module.exports = { monthlyResult, buildAnalysis, allEvents, eventsFromRows, eventsFromLedger, buildHistory, repeatCustomers, heatmap, channelFromText, FROM, START, GRAB_START };
