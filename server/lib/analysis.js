// Business analysis: weekly and monthly performance from the Ledger-based reports, October onwards.
// Pure functions. Weeks are Monday to Sunday, the same as the Numbers page, so the two always agree.
const { formatDMY, utc, parseDate, daysBetween } = require('./dates');
const { batchDishOf, normName } = require('./dishes');
const { periodOf, hourOf, sellThrough, priceMoves } = require('./reports');

const FROM = utc(2026, 10, 1);
const START = utc(2025, 11, 1);       // the very first month of Merlin's Dish
const GRAB_START = '2026-05';         // Grab operations begin
const GRAB_CUT = 0.32;                // Grab's cut, used only when a dish has never sold on LINE
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
function itemMix(ledger, today) {
  const months = new Map();
  for (const r of ledger) {
    if (r.date < FROM || r.type !== 'Order' || !(r.qty > 0)) continue;
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
const channelFromText = (a, b) => {
  const t = `${a || ''} ${b || ''}`;
  if (/grab/i.test(t)) return 'grab';
  if (/insta|(^|\W)ig(\W|$)/i.test(t)) return 'ig';
  return 'line';
};
const channelOfLedger = (r) => (r.channel === 'Grab' ? 'grab' : /^instagram$/i.test(r.orderFrom) ? 'ig' : 'line');
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
    const qty = num0(r[5]); const money = num0(r[6]) || num0(r[8]);
    if (!(qty > 0) && !(money > 0)) return;
    out.push({ date, desc: String(r[1] || '').trim(), channel: channelFromText(r[2], r[3]), branch: String(r[2] || '').trim(), orderFrom: String(r[3] || '').trim(), qty, money, orderNo: String(r[10] || '').trim() });
  });
  return out;
}
function eventsFromLedger(ledger, { from = null } = {}) {
  return ledger.filter((r) => r.type === 'Order' && (!from || r.date >= from)).map((r) => ({
    date: r.date, desc: r.desc, channel: channelOfLedger(r), branch: r.channel, orderFrom: r.orderFrom, qty: r.qty || 0, money: r.moneyIn || r.net || 0, orderNo: r.orderNo,
  }));
}

// Every order line since the start, never counted twice: Master Log before September, the Ledger from September, Sheet1 only for September rows the Ledger does not already hold.
function allEvents({ master = [], sheet1 = [], ledger = [] }) {
  const sep = utc(2026, 9, 1); const oct = utc(2026, 10, 1);
  const a = eventsFromRows(master, { carryDate: true, to: sep });
  const b = eventsFromLedger(ledger, { from: sep });
  const seen = new Set(b.filter((e) => e.date < oct).map(keyOf));
  const c = eventsFromRows(sheet1, { from: sep, to: oct }).filter((e) => { const k = keyOf(e); if (seen.has(k)) return false; seen.add(k); return true; });
  return { events: [...a, ...b, ...c], masterEvents: a };
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
function heatmap(ledger) {
  const seen = new Set(); const grid = Array.from({ length: 7 }, () => ({})); let noTime = 0; let total = 0;
  for (const r of ledger) {
    if (r.type !== 'Order' || r.date < FROM) continue;
    const k = `${r.channel}|${r.dmy}|${r.orderNo || `${r.time}${r.customer}`}`;
    if (!r.orderNo && !r.customer) continue;
    if (seen.has(k)) continue; seen.add(k); total += 1;
    const hh = hourOf(r.time); if (hh === null) { noTime += 1; continue; }
    const wd = (r.date.getUTCDay() + 6) % 7;
    grid[wd][hh] = (grid[wd][hh] || 0) + 1;
  }
  const hours = [...new Set(grid.flatMap((g) => Object.keys(g)))].sort();
  const lo = hours.length ? Number(hours[0]) : 10; const hi = hours.length ? Number(hours[hours.length - 1]) : 20;
  const cols = []; for (let h = lo; h <= hi; h += 1) cols.push(String(h).padStart(2, '0'));
  const max = Math.max(1, ...grid.flatMap((g) => Object.values(g)));
  return { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], hours: cols, cells: grid.map((g) => cols.map((h) => g[h] || 0)), max, noTime, total,
    perDay: grid.map((g) => Object.values(g).reduce((a, b) => a + b, 0)) };
}

// ---- cooked against sold, stock sitting, price creep, break-even --------------------------------------
function dishPerformance({ ledger, cookBatches, expense, today }) {
  const st = sellThrough(ledger.filter((r) => r.date >= FROM), cookBatches.filter((b) => b.date >= FROM), today);
  const sitting = st.map((d) => ({ dish: d.dish, cooked: d.cooked, sold: d.sold, remaining: d.remaining, sellPct: d.cooked ? Math.round((d.sold / d.cooked) * 100) : null, oldestAgeDays: d.oldestAgeDays, old: d.oldestAgeDays > 5 && d.remaining > 0 }));

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
  return { sitting, creep, moves, breakEven };
}

function buildAnalysis({ weekly = [], monthly = [], ledger = [], today, master = [], sheet1 = [], cookBatches = [], expense = [] }) {
  const chW = channelOrders(ledger, 'week'); const chM = channelOrders(ledger, 'month');
  const rpW = repeatCustomers(ledger, 'week'); const rpM = repeatCustomers(ledger, 'month');
  const weeks = weekly.filter((p) => p.to >= FROM).map((p) => shape(p, today, 'week', chW.get(p.key), rpW.get(p.key)));
  const months = monthly.filter((p) => p.to >= FROM).map((p) => shape(p, today, 'month', chM.get(p.key), rpM.get(p.key)));
  const done = weeks.filter((w) => !w.inProgress && !w.startsBeforeOct && w.gross > 0);
  const best = done.length ? done.reduce((a, b) => (b.margin > a.margin ? b : a)) : null;
  const worst = done.length ? done.reduce((a, b) => (b.margin < a.margin ? b : a)) : null;
  const last = weeks.filter((w) => !w.inProgress).slice(-2);
  const notes = [];
  if (last.length === 2) notes.push({ title: 'Last finished week against the one before', text: `Gross ${change(last[1].gross, last[0].gross) ?? 'n/a'}%, margin ${change(last[1].margin, last[0].margin) ?? 'n/a'}%, orders ${last[1].orders} against ${last[0].orders}.` });
  if (best && worst && best !== worst) notes.push({ title: 'Best and weakest full week', text: `Best: ${best.label}, margin ฿${best.margin.toLocaleString('en-AU')}. Weakest: ${worst.label}, margin ฿${worst.margin.toLocaleString('en-AU')}.` });
  const { events } = allEvents({ master, sheet1, ledger });
  return {
    today: formatDMY(today), from: formatDMY(FROM), weeks, months, mix: itemMix(ledger, today), notes, best: best && best.label, worst: worst && worst.label,
    history: buildHistory({ events, today }),
    heatmap: heatmap(ledger),
    dishes: dishPerformance({ ledger, cookBatches, expense, today }),
  };
}

module.exports = { buildAnalysis, allEvents, eventsFromRows, eventsFromLedger, buildHistory, repeatCustomers, heatmap, channelFromText, FROM, START, GRAB_START };
