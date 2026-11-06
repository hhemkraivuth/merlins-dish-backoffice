const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baht = (n) => (n === null || n === undefined ? '' : `${n < 0 ? '-' : ''}฿${Math.abs(Math.round(n)).toLocaleString('en-AU')}`);
const pc = (n) => (n === null || n === undefined ? '' : `${n}%`);
const COLORS = { gross: '#294BD4', food: '#F8CC1A', margin: '#2E8B6E', line: '#E63D23', grab: '#63CBC6' };
let data = null; let kind = 'months'; let range = 'start'; // monthly, from the very first month (Nov 2025)
const SERIES = { grab: ['Grab', '#63CBC6'], line: ['LINE / direct', '#E63D23'], ig: ['Instagram', '#8A4FD6'] };

// ---- charts -------------------------------------------------------------------------------------------
// Tap, click or drag on any chart: the nearest period locks on, a dotted line runs up through it, a dotted line
// runs across the chart at each series' level with its number at the edge, and a readout above the chart (clear of
// your finger) lists every number for that period.
const REG = [];
const nice = (m) => { const p = 10 ** Math.floor(Math.log10(m)); return Math.ceil(m / p) * p; };
const fmtOf = (money, unit = '') => (v) => (v === null || v === undefined ? '' : money ? baht(v) : `${Math.round(v * 10) / 10}${unit}`);
function wrap(svg, desc, legendItems) {
  const id = REG.push(desc) - 1;
  const legend = `<div class="legend">${legendItems.map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join('')}</div>`;
  return `<div class="cc" data-ch="${id}"><div class="readout">Tap or drag on the chart to read the numbers.</div>${svg}</div>${legend}`;
}

// bars: [{name, color, values}], line: {name, color, values, unit} on its own right hand scale.
function chart({ labels, bars = [], line = null, partial = [], money = true }) {
  const W = 720; const H = 260; const L = 46; const R = line ? 40 : 10; const T = 12; const B = 48;
  const pw = W - L - R; const ph = H - T - B;
  const all = bars.length ? bars.flatMap((b) => b.values.map((v) => v || 0)) : [0, 1];
  const lo = Math.min(0, ...all); const hi = Math.max(1, ...all);
  const top = nice(hi); const bottom = lo < 0 ? -nice(-lo) : 0;
  const y = (v) => T + ph - ((v - bottom) / (top - bottom)) * ph;
  const n = labels.length; const slot = pw / Math.max(n, 1);
  const bw = Math.min(28, (slot * 0.8) / Math.max(bars.length, 1));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" style="touch-action:pan-y">`;
  for (let i = 0; i <= 4; i += 1) {
    const v = bottom + ((top - bottom) * i) / 4;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#F3DCC8"/>`;
    if (bars.length) svg += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#6C6A7A">${money ? baht(v) : Math.round(v)}</text>`;
  }
  labels.forEach((lab, i) => {
    const cx = L + slot * i + slot / 2;
    bars.forEach((b, j) => {
      const v = b.values[i] || 0; const x = cx - (bw * bars.length) / 2 + bw * j;
      const y0 = y(Math.max(v, 0)); const h = Math.abs(y(v) - y(0));
      svg += `<rect x="${x}" y="${y0}" width="${bw - 2}" height="${Math.max(h, 1)}" rx="2" fill="${b.color}" opacity="${partial[i] ? 0.45 : 1}"/>`;
    });
    svg += `<text x="${cx}" y="${H - B + 14}" text-anchor="end" font-size="10" fill="#6C6A7A" transform="rotate(-35 ${cx} ${H - B + 14})">${esc(lab)}${partial[i] ? '*' : ''}</text>`;
  });
  const series = bars.map((b) => ({ name: b.name, color: b.color, values: b.values.map((v) => v || 0), y: (v) => y(v), fmt: fmtOf(money) }));
  if (line) {
    const vs = line.values.map((v) => v ?? 0); const lm = Math.max(1, ...vs.map(Math.abs)); const ln = Math.min(0, ...vs);
    const ly = (v) => T + ph - ((v - ln) / (lm - ln)) * ph;
    const pts = line.values.map((v, i) => (v === null || v === undefined ? null : [L + slot * i + slot / 2, ly(v)]));
    svg += `<polyline fill="none" stroke="${line.color}" stroke-width="2.5" points="${pts.filter(Boolean).map((p) => p.join(',')).join(' ')}"/>`;
    pts.forEach((p) => { if (p) svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${line.color}"/>`; });
    svg += `<text x="${W - R + 4}" y="${ly(lm) + 4}" font-size="10" fill="${line.color}">${Math.round(lm)}${line.unit}</text><text x="${W - R + 4}" y="${ly(ln) + 4}" font-size="10" fill="${line.color}">${Math.round(ln)}${line.unit}</text>`;
    series.push({ name: line.name, color: line.color, values: line.values, y: ly, fmt: fmtOf(false, line.unit) });
  }
  svg += '<g class="xh"></g></svg>';
  const xs = labels.map((_, i) => L + slot * i + slot / 2);
  return wrap(svg, { W, H, L, R, T, ph, xs, labels, partial, series, bars: bars.length > 0 }, [...bars.map((b) => [b.color, b.name]), ...(line ? [[line.color, `${line.name} (right axis)`]] : [])]);
}

// Several lines on one scale. markers: [{ index, label }] draw a dashed vertical line with a label.
function lineChart({ labels, series, markers = [], money = true, partial = [] }) {
  const W = 720; const H = 280; const L = 50; const R = 10; const T = 22; const B = 56;
  const pw = W - L - R; const ph = H - T - B; const n = labels.length;
  const vals = series.flatMap((x) => x.values.map((v) => v || 0));
  const lo = Math.min(0, ...vals); const hi = Math.max(1, ...vals); const top = nice(hi); const bottom = lo < 0 ? -nice(-lo) : 0;
  const x = (i) => L + (n <= 1 ? pw / 2 : (pw * i) / (n - 1)); const y = (v) => T + ph - ((v - bottom) / (top - bottom)) * ph;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" style="touch-action:pan-y">`;
  for (let i = 0; i <= 4; i += 1) { const v = bottom + ((top - bottom) * i) / 4; svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#F3DCC8"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#6C6A7A">${money ? baht(v) : Math.round(v)}</text>`; }
  const every = Math.max(1, Math.ceil(n / 14));
  labels.forEach((lab, i) => { if (i % every === 0 || i === n - 1) svg += `<text x="${x(i)}" y="${H - B + 14}" text-anchor="end" font-size="10" fill="#6C6A7A" transform="rotate(-35 ${x(i)} ${H - B + 14})">${esc(lab)}</text>`; });
  markers.forEach((m) => { svg += `<line x1="${x(m.index)}" x2="${x(m.index)}" y1="${T - 6}" y2="${T + ph}" stroke="#1B2559" stroke-dasharray="4 3" opacity=".5"/><text x="${x(m.index) + 4}" y="${T + 4}" font-size="10" fill="#1B2559">${esc(m.label)}</text>`; });
  series.forEach((sr) => {
    const pts = sr.values.map((v, i) => [x(i), y(v || 0)]);
    svg += `<polyline fill="none" stroke="${sr.color}" stroke-width="2.4" points="${pts.map((p) => p.join(',')).join(' ')}"/>`;
    if (n <= 40) pts.forEach((p, i) => { svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${sr.color}" opacity="${partial[i] ? 0.4 : 1}"/>`; });
  });
  svg += '<g class="xh"></g></svg>';
  const xs = labels.map((_, i) => x(i));
  return wrap(svg, { W, H, L, R, T, ph, xs, labels, partial, series: series.map((sr) => ({ name: sr.name, color: sr.color, values: sr.values.map((v) => v || 0), y, fmt: fmtOf(money) })), bars: false }, series.map((sr) => [sr.color, sr.name]));
}

function wire(root) {
  root.querySelectorAll('.cc').forEach((box) => {
    const d = REG[Number(box.dataset.ch)]; if (!d || box.dataset.wired) return; box.dataset.wired = '1';
    const svg = box.querySelector('svg'); const g = svg.querySelector('.xh'); const out = box.querySelector('.readout');
    const show = (clientX) => {
      const r = svg.getBoundingClientRect(); const px = ((clientX - r.left) / r.width) * d.W;
      let at = 0; d.xs.forEach((xv, i) => { if (Math.abs(xv - px) < Math.abs(d.xs[at] - px)) at = i; });
      const x = d.xs[at]; let html = `<line x1="${x}" x2="${x}" y1="${d.T - 6}" y2="${d.T + d.ph}" stroke="#1B2559" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      // value labels at the right edge, nudged apart so they never sit on top of each other
      const rows = d.series.map((sr) => ({ sr, yy: sr.y(sr.values[at] || 0) })).sort((a, b) => a.yy - b.yy);
      let prev = -99; rows.forEach((row) => { row.ly = Math.max(row.yy, prev + 12); prev = row.ly; });
      rows.forEach(({ sr, yy, ly }) => {
        const v = sr.values[at];
        html += `<line x1="${d.L}" x2="${d.W - d.R}" y1="${yy}" y2="${yy}" stroke="${sr.color}" stroke-width="1.2" stroke-dasharray="3 3" opacity=".9"/>`
          + `<circle cx="${x}" cy="${yy}" r="5" fill="#fff" stroke="${sr.color}" stroke-width="2.5"/>`
          + `<text x="${d.W - d.R - 2}" y="${ly - 3}" text-anchor="end" font-size="12" font-weight="700" fill="${sr.color}" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(sr.fmt(v))}</text>`;
      });
      g.innerHTML = html;
      out.innerHTML = `<b>${esc(d.labels[at])}${d.partial[at] ? ' (not finished)' : ''}</b> ` + d.series.map((sr) => `<span><i style="background:${sr.color}"></i>${esc(sr.name)} <b>${esc(sr.fmt(sr.values[at]))}</b></span>`).join('');
    };
    let down = false;
    svg.addEventListener('pointerdown', (e) => { down = true; try { svg.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } show(e.clientX); });
    svg.addEventListener('pointermove', (e) => { if (down || e.pointerType === 'mouse') show(e.clientX); });
    svg.addEventListener('pointerup', () => { down = false; });
    svg.addEventListener('pointercancel', () => { down = false; });
  });
}
const tbl = (head, rows) => `<div class="tablewrap" style="margin:8px 0 0"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

function card(title, why, body) { return `<div class="chart-card"><h2>${esc(title)}</h2><p class="why">${esc(why)}</p>${body}</div>`; }

function markerIdx(rows, key) { const i = rows.findIndex((r) => r.key >= key); return i; }

function draw() {
  REG.length = 0;
  const mode = kind;                               // 'weeks' | 'months'
  const rows = data[mode];
  const hist = data.history[mode];
  const since = range === 'start';
  let html = '';

  // Sales by channel: three separate lines. Weeks use the Sunday key, months the YYYY-MM key.
  const h = since ? hist : hist.filter((r) => r.key >= (mode === 'months' ? '2026-10' : '2026-09-27'));
  const hl = h.map((r) => r.label); const hp = h.map((r) => r.inProgress);
  const mk = [];
  if (since && h.length) {
    const gKey = mode === 'months' ? data.history.markers.grab : `${data.history.markers.grab}-01`;
    const gi = h.findIndex((r) => r.key >= gKey); if (gi > 0) mk.push({ index: gi, label: 'Grab starts' });
    mk.push({ index: 0, label: `First order ${data.history.first}` });
  }
  const lines = (a, b, c, names) => [{ name: names[0], color: SERIES.grab[1], values: a }, { name: names[1], color: SERIES.line[1], values: b }, { name: names[2], color: SERIES.ig[1], values: c }];
  html += card('Sales by channel', since ? 'Grab, LINE (direct customers, not labelled Instagram) and Instagram as separate lines, from the first order in Nov 2025. Grab starts in May 2026. Tap a point to read the number.' : 'Grab, LINE and Instagram as separate lines.', h.length ? lineChart({ labels: hl, partial: hp, markers: mk, series: lines(h.map((r) => r.grab), h.map((r) => r.line), h.map((r) => r.ig), ['Grab sales', 'LINE / direct sales', 'Instagram sales']) }) : '<p class="why">No sales found.</p>');
  html += card('Portions sold by channel', 'How many portions each channel moves, which shows volume without the price differences.', h.length ? lineChart({ labels: hl, partial: hp, markers: mk, money: false, series: lines(h.map((r) => r.portionsGrab), h.map((r) => r.portionsLine), h.map((r) => r.portionsIg), ['Grab portions', 'LINE / direct portions', 'Instagram portions']) }) : '');
  html += card('Total sales', 'All three channels together.', h.length ? lineChart({ labels: hl, partial: hp, markers: mk, series: [{ name: 'Total sales', color: COLORS.gross, values: h.map((r) => r.total) }] }) : '');

  if (since && mode === 'months') {
    const rs = (data.history.result && data.history.result.months) || [];
    if (rs.length) html += card('Monthly result', `Sales less every cost (food, ads, overheads, Grab fees, riders). Nov 2025 to Sep 2026 comes from the Master Log, October onwards from BOH. Faded bars are not finished yet.`, chart({ labels: rs.map((r) => r.label), partial: rs.map((r) => r.inProgress), bars: [{ name: 'Sales', color: COLORS.gross, values: rs.map((r) => r.sales) }, { name: 'Costs', color: COLORS.food, values: rs.map((r) => r.costs) }, { name: 'Result', color: COLORS.margin, values: rs.map((r) => r.net) }] }));
  }
  if (since) html += '<p class="status">Margin, food cost and the deeper analysis below use the Ledger, which starts in October. Switch to From October to see them.</p>';
  else html += octCharts(rows);
  $('charts').innerHTML = html;
  wire($('charts'));
  $('tableBox').innerHTML = since ? tableOf(h, [['Period', 'label'], ['Grab', 'grab', baht], ['LINE', 'line', baht], ['Instagram', 'ig', baht], ['Total', 'total', baht], ['Portions Grab', 'portionsGrab'], ['Portions LINE', 'portionsLine'], ['Portions IG', 'portionsIg']]) : tableOf(rows, TABLE_COLS);
  $('deep').style.display = since ? 'none' : '';
  $('when').style.display = '';
}

function tableOf(rows, cols) {
  return `<table><thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(c[2] ? c[2](r[c[1]]) : r[c[1]] ?? '')}${c[1] === 'label' && r.inProgress ? ' *' : ''}${c[1] === 'label' && r.startsBeforeOct ? ' (starts in Sept)' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const TABLE_COLS = [['Period', 'label'], ['Gross', 'gross', baht], ['Food cost', 'foodCost', baht], ['Margin', 'margin', baht], ['Margin %', 'marginPct', pc], ['Orders', 'orders'], ['Grab', 'grabOrders'], ['LINE', 'lineOnlyOrders'], ['IG', 'igOrders'], ['Avg order', 'aov', baht], ['Discounts', 'discountPct', pc], ['Grab fees', 'grabFeePct', pc], ['Ads', 'ads', baht]];

function octCharts(rows) {
  if (!rows.length) return '<p class="status">No orders found from October yet.</p>';
  const labels = rows.map((r) => r.label); const partial = rows.map((r) => r.inProgress);
  const col = (k) => rows.map((r) => r[k]);
  return card('Sales, food cost and margin', 'Is the money coming in faster than the cost of making it? Faded bars are not finished yet.', chart({ labels, partial, bars: [{ name: 'Gross sales', color: COLORS.gross, values: col('gross') }, { name: 'Food cost', color: COLORS.food, values: col('foodCost') }, { name: 'Margin after overheads and ads', color: COLORS.margin, values: col('margin') }] }))
    + card('Margin as a share of sales', 'The honest health check. A busy week with a thin margin is not a good week.', chart({ labels, partial, bars: [], line: { name: 'Margin %', color: COLORS.margin, values: col('marginPct'), unit: '%' } }))
    + card('Orders by channel', 'Grab, LINE and Instagram orders as three separate bars. Growth in LINE and Instagram means less commission paid.', chart({ labels, partial, money: false, bars: [{ name: 'Grab orders', color: SERIES.grab[1], values: col('grabOrders') }, { name: 'LINE orders', color: SERIES.line[1], values: col('lineOnlyOrders') }, { name: 'Instagram orders', color: SERIES.ig[1], values: col('igOrders') }] }))
    + card('Average order value', 'Gross sales divided by orders. Bundles and value adds should push this up.', chart({ labels, partial, bars: [{ name: 'Average order', color: COLORS.gross, values: col('aov') }] }))
    + card('Food cost and discounts as a share of sales', 'If either climbs, a promotion or a low yield batch is eating margin.', chart({ labels, partial, money: false, bars: [{ name: 'Food cost %', color: COLORS.food, values: col('foodCostPct') }, { name: 'Discounts %', color: COLORS.line, values: col('discountPct') }] }))
    + card('Repeat customers', 'New orders against orders from someone who ordered on an earlier day. Counted from 01/10/2026, so the first weeks look mostly new.', chart({ labels, partial, money: false, bars: [{ name: 'New customers', color: COLORS.grab, values: col('newOrders') }, { name: 'Repeat customers', color: COLORS.margin, values: col('repeatOrders') }] }) + `<p class="why" style="margin-top:6px">Repeat share: ${rows.map((r) => `${esc(r.label)} ${r.repeatPct === null ? 'n/a' : r.repeatPct + '%'}`).join(' · ')}</p>`)
    + card('Meta ads against direct orders', 'Ad spend and LINE plus Instagram orders in the same week. Orders are not attributed to ads, so organic orders land here too. Kept apart from Grab.', chart({ labels, partial, bars: [{ name: 'Meta ads', color: COLORS.food, values: col('ads') }], line: { name: 'LINE + Instagram orders', color: COLORS.line, values: rows.map((r) => r.lineOrders), unit: '' } }) + tbl(['Period', 'Ads', 'Direct orders', 'Ads per direct order'], rows.map((r) => [r.label, baht(r.ads), r.lineOrders, r.adsPerDirectOrder === null ? '' : baht(r.adsPerDirectOrder)])));
}

function drawDeep() {
  const d = data.dishes; const hm = data.heatmap;
  const shade = (v) => (v ? `background:rgba(41,75,212,${0.12 + 0.75 * (v / hm.max)});color:${v / hm.max > 0.5 ? '#fff' : 'inherit'}` : '');
  const top3 = []; hm.cells.forEach((row, di) => row.forEach((v, hi) => { if (v) top3.push([v, hm.days[di], hm.hours[hi]]); }));
  top3.sort((a, b) => b[0] - a[0]);
  const quiet = hm.perDay.map((v, i) => [v, hm.days[i]]).sort((a, b) => a[0] - b[0])[0];
  const adv = hm.total && top3.length ? `<p class="why" style="margin:8px 0 0"><b>Busiest:</b> ${top3.slice(0, 3).map((t) => `${t[1]} ${t[2]}:00 (${t[0]})`).join(', ')}. <b>Quietest day:</b> ${quiet[1]} (${quiet[0]} orders), the best day to boost.</p>` : '';
  const heat = hm.total ? `<div class="tablewrap" style="margin:8px 0 0"><table><thead><tr><th></th>${hm.hours.map((h) => `<th>${h}</th>`).join('')}<th>Total</th></tr></thead><tbody>${hm.days.map((dn, i) => `<tr><td>${dn}</td>${hm.cells[i].map((v) => `<td style="${shade(v)}">${v || ''}</td>`).join('')}<td><b>${hm.perDay[i]}</b></td></tr>`).join('')}</tbody></table></div>${adv}<p class="why" style="margin-top:6px">Monday to Friday, the days Merlin's Dish operates. ${hm.total - hm.noTime} of ${hm.total} orders have a time${hm.weekend ? `; ${hm.weekend} weekend orders are not drawn` : ''}. Darker is busier. The hour is when the order came in. Times exist from October, when the Ledger began.</p>` : '<p class="why">No orders with a time yet.</p>';
  const creepSeries = d.creep.filter((c) => c.batches.length > 1);
  const palette = ['#294BD4', '#E63D23', '#2E8B6E', '#F8CC1A', '#8A4FD6', '#63CBC6', '#1B2559'];
  let creep = creepSeries.length ? lineChart({ labels: creepSeries[0].batches.map((_, i) => `batch ${i + 1}`), series: creepSeries.map((c, i) => ({ name: c.dish, color: palette[i % palette.length], values: c.batches.map((b) => b.perPortion) })), money: true }) : '';
  creep += tbl(['Dish', 'First batch', 'Latest batch', 'Change'], d.creep.map((c) => [c.dish, baht(c.first), baht(c.latest), c.changePct === null ? '' : `${c.changePct > 0 ? '+' : ''}${c.changePct}%`]));
  if (d.moves.length) creep += `<h2 style="font-size:14px;margin:12px 0 2px">Ingredients that moved 10% or more</h2>` + tbl(['Ingredient', 'Date', 'Before', 'Now', 'Change'], d.moves.map((m) => [m.name, m.date, m.from, m.to, `${m.changePct > 0 ? '+' : ''}${m.changePct}%`]));
  $('deep').innerHTML =
    card('Sell-through and stock sitting', 'Portions cooked against sold since October, first in first out. Dishes with stock older than 5 days are flagged for a flash sale.', tbl(['Dish', 'Cooked', 'Sold', 'Left', 'Sold %', 'Oldest left', ''], d.sitting.map((x) => [x.dish, x.cooked, x.sold, x.remaining, x.sellPct === null ? '' : `${x.sellPct}%`, x.remaining ? `${x.oldestAgeDays} days` : '', x.old ? 'Flash sale' : ''])))
    + card('Price creep', 'Cost per portion of each batch, in the order cooked. A rising line shows before the margin does.', creep)
    + card('Break-even per batch', 'Portions you must sell to cover the latest batch. Uses the LINE price (kept in full), or the Grab price less its cut when a dish has never sold on LINE.', tbl(['Dish', 'Latest batch', 'Earns per portion', 'Basis', 'Break-even', 'Of the batch'], d.breakEven.map((b) => [b.dish, `${baht(b.batchCost)} (${b.portions} portions, ${b.batchDate})`, b.earnPerPortion === null ? '' : baht(b.earnPerPortion), b.basis, b.breakEvenPortions === null ? '' : `${b.breakEvenPortions} portions`, b.breakEvenPct === null ? '' : `${b.breakEvenPct}%`])));
  $('when').innerHTML = card('Weekday and hour', 'The most important one: when orders come in, so you know where and when to boost sales.', heat);
  const m = data.history.mapping;
  $('check').innerHTML = m.length ? `<details class="sum-more"><summary>Check how the history was sorted into Grab, LINE and Instagram</summary><p class="why">Each row is a Branch and Order from pair found in the sheets, and the channel it was counted under. If one is in the wrong channel, tell me.</p>${tbl(['Branch', 'Order from', 'Counted as', 'Rows'], m.map((x) => [x.branch || '(blank)', x.orderFrom || '(blank)', SERIES[x.channel][0], x.rows]))}</details>` : '';
}

function drawMix() {
  $('mix').innerHTML = data.mix.length ? `<h2 style="font-size:16px">Best sellers by month (portions)</h2>` + data.mix.map((m) => `<div class="tablewrap"><table><thead><tr><th>${esc(m.month)}</th><th>Portions</th></tr></thead><tbody>${m.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td></tr>`).join('')}</tbody></table></div>`).join('') : '';
}

async function load() {
  try {
    const res = await fetch('/api/analysis');
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    $('status').textContent = `From ${data.from}. Weeks run Sunday to Saturday. Merlin's Dish operates on weekdays. * means not finished yet.`;
    $('notes').innerHTML = data.notes.map((n) => `<li><b>${esc(n.title)}.</b> ${esc(n.text)}</li>`).join('');
    if (data.warnings && data.warnings.length) $('status').textContent += `\n${data.warnings.join('\n')}`;
    draw(); drawMix(); drawDeep(); wire($('deep'));
  } catch (err) { $('status').className = 'status err'; $('status').textContent = err.message; }
}
$('toggle').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !data) return;
  kind = b.dataset.k; [...$('toggle').children].forEach((x) => x.classList.toggle('on', x === b)); draw();
});
$('range').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !data) return;
  range = b.dataset.r; [...$('range').children].forEach((x) => x.classList.toggle('on', x === b)); draw();
});
load();
