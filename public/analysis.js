const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baht = (n) => (n === null || n === undefined ? '' : `${n < 0 ? '-' : ''}฿${Math.abs(Math.round(n)).toLocaleString('en-AU')}`);
const pc = (n) => (n === null || n === undefined ? '' : `${n}%`);
const COLORS = { gross: '#294BD4', food: '#F8CC1A', margin: '#2E8B6E', line: '#E63D23', grab: '#63CBC6' };
let data = null; let kind = 'weeks'; let range = 'oct';
const SERIES = { grab: ['Grab', '#63CBC6'], line: ['LINE', '#E63D23'], ig: ['Instagram', '#8A4FD6'] };

// A simple SVG chart. bars: [{name, color, values}], line: {name, color, values, unit} drawn on its own scale.
function chart({ labels, bars = [], line = null, partial = [], money = true }) {
  const W = 720; const H = 260; const L = 46; const R = line ? 40 : 10; const T = 12; const B = 48;
  const pw = W - L - R; const ph = H - T - B;
  const all = bars.length ? bars.flatMap((b) => b.values.map((v) => v || 0)) : [0, 1];
  const lo = Math.min(0, ...all); const hi = Math.max(1, ...all);
  const nice = (m) => { const p = 10 ** Math.floor(Math.log10(m)); return Math.ceil(m / p) * p; };
  const top = nice(hi); const bottom = lo < 0 ? -nice(-lo) : 0;
  const y = (v) => T + ph - ((v - bottom) / (top - bottom)) * ph;
  const n = labels.length; const slot = pw / Math.max(n, 1);
  const bw = Math.min(28, (slot * 0.8) / Math.max(bars.length, 1));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
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
      svg += `<rect x="${x}" y="${y0}" width="${bw - 2}" height="${Math.max(h, 1)}" rx="2" fill="${b.color}" opacity="${partial[i] ? 0.45 : 1}"><title>${esc(lab)}: ${esc(b.name)} ${money ? baht(v) : v}${partial[i] ? ' (not finished)' : ''}</title></rect>`;
    });
    svg += `<text x="${cx}" y="${H - B + 14}" text-anchor="end" font-size="10" fill="#6C6A7A" transform="rotate(-35 ${cx} ${H - B + 14})">${esc(lab)}${partial[i] ? '*' : ''}</text>`;
  });
  if (line) {
    const vs = line.values.map((v) => v ?? 0); const lm = Math.max(1, ...vs.map(Math.abs)); const ln = Math.min(0, ...vs);
    const ly = (v) => T + ph - ((v - ln) / (lm - ln)) * ph;
    const pts = line.values.map((v, i) => (v === null || v === undefined ? null : [L + slot * i + slot / 2, ly(v)]));
    svg += `<polyline fill="none" stroke="${line.color}" stroke-width="2.5" points="${pts.filter(Boolean).map((p) => p.join(',')).join(' ')}"/>`;
    pts.forEach((p, i) => { if (p) svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${line.color}"><title>${esc(labels[i])}: ${line.values[i]}${line.unit}</title></circle>`; });
    svg += `<text x="${W - R + 4}" y="${ly(lm) + 4}" font-size="10" fill="${line.color}">${Math.round(lm)}${line.unit}</text><text x="${W - R + 4}" y="${ly(ln) + 4}" font-size="10" fill="${line.color}">${Math.round(ln)}${line.unit}</text>`;
  }
  svg += '</svg>';
  const legend = [...bars.map((b) => [b.color, b.name]), ...(line ? [[line.color, `${line.name} (right axis)`]] : [])];
  return svg + `<div class="legend">${legend.map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join('')}</div>`;
}


// Several lines on one scale. markers: [{ index, label }] draw a dashed vertical line with a label.
function lineChart({ labels, series, markers = [], money = true, partial = [] }) {
  const W = 720; const H = 280; const L = 50; const R = 10; const T = 22; const B = 56;
  const pw = W - L - R; const ph = H - T - B; const n = labels.length;
  const vals = series.flatMap((x) => x.values.map((v) => v || 0));
  const hi = Math.max(1, ...vals); const nice = (m) => { const p = 10 ** Math.floor(Math.log10(m)); return Math.ceil(m / p) * p; }; const top = nice(hi);
  const x = (i) => L + (n <= 1 ? pw / 2 : (pw * i) / (n - 1)); const y = (v) => T + ph - (v / top) * ph;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i += 1) { const v = (top * i) / 4; svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#F3DCC8"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#6C6A7A">${money ? baht(v) : Math.round(v)}</text>`; }
  const every = Math.max(1, Math.ceil(n / 14));
  labels.forEach((lab, i) => { if (i % every === 0 || i === n - 1) svg += `<text x="${x(i)}" y="${H - B + 14}" text-anchor="end" font-size="10" fill="#6C6A7A" transform="rotate(-35 ${x(i)} ${H - B + 14})">${esc(lab)}</text>`; });
  markers.forEach((m) => { svg += `<line x1="${x(m.index)}" x2="${x(m.index)}" y1="${T - 6}" y2="${T + ph}" stroke="#1B2559" stroke-dasharray="4 3" opacity=".5"/><text x="${x(m.index) + 4}" y="${T + 4}" font-size="10" fill="#1B2559">${esc(m.label)}</text>`; });
  series.forEach((sr) => {
    const pts = sr.values.map((v, i) => [x(i), y(v || 0)]);
    svg += `<polyline fill="none" stroke="${sr.color}" stroke-width="2.4" points="${pts.map((p) => p.join(',')).join(' ')}"/>`;
    if (n <= 40) pts.forEach((p, i) => { svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${sr.color}" opacity="${partial[i] ? 0.4 : 1}"><title>${esc(labels[i])}: ${esc(sr.name)} ${money ? baht(sr.values[i]) : sr.values[i]}</title></circle>`; });
  });
  svg += '</svg>';
  return svg + `<div class="legend">${series.map((sr) => `<span><i style="background:${sr.color}"></i>${esc(sr.name)}</span>`).join('')}</div>`;
}
const tbl = (head, rows) => `<div class="tablewrap" style="margin:8px 0 0"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

function card(title, why, body) { return `<div class="chart-card"><h2>${esc(title)}</h2><p class="why">${esc(why)}</p>${body}</div>`; }

function markerIdx(rows, key) { const i = rows.findIndex((r) => r.key >= key); return i; }

function draw() {
  const mode = kind;                               // 'weeks' | 'months'
  const rows = data[mode];
  const hist = data.history[mode];
  const since = range === 'start';
  let html = '';

  // Sales by channel: three separate lines. Weeks use the Monday key, months the YYYY-MM key.
  const h = since ? hist : hist.filter((r) => r.key >= (mode === 'months' ? '2026-10' : '2026-09-28'));
  const hl = h.map((r) => r.label); const hp = h.map((r) => r.inProgress);
  const mk = [];
  if (since && h.length) {
    const gKey = mode === 'months' ? data.history.markers.grab : `${data.history.markers.grab}-01`;
    const gi = h.findIndex((r) => r.key >= gKey); if (gi > 0) mk.push({ index: gi, label: 'Grab starts' });
    mk.push({ index: 0, label: `First order ${data.history.first}` });
  }
  const lines = (a, b, c, names) => [{ name: names[0], color: SERIES.grab[1], values: a }, { name: names[1], color: SERIES.line[1], values: b }, { name: names[2], color: SERIES.ig[1], values: c }];
  html += card('Sales by channel', since ? 'Grab, LINE and Instagram as separate lines, from the first order. Grab starts in May 2026.' : 'Grab, LINE and Instagram as separate lines.', h.length ? lineChart({ labels: hl, partial: hp, markers: mk, series: lines(h.map((r) => r.grab), h.map((r) => r.line), h.map((r) => r.ig), ['Grab sales', 'LINE sales', 'Instagram sales']) }) : '<p class="why">No sales found.</p>');
  html += card('Portions sold by channel', 'How many portions each channel moves, which shows volume without the price differences.', h.length ? lineChart({ labels: hl, partial: hp, markers: mk, money: false, series: lines(h.map((r) => r.portionsGrab), h.map((r) => r.portionsLine), h.map((r) => r.portionsIg), ['Grab portions', 'LINE portions', 'Instagram portions']) }) : '');
  html += card('Total sales', 'All three channels together.', h.length ? lineChart({ labels: hl, partial: hp, markers: mk, series: [{ name: 'Total sales', color: COLORS.gross, values: h.map((r) => r.total) }] }) : '');

  if (since) html += '<p class="status">Margin, food cost and the analysis below start in October, when the Ledger begins. Switch to From October to see them.</p>';
  else html += octCharts(rows);
  $('charts').innerHTML = html;
  $('tableBox').innerHTML = since ? tableOf(h, [['Period', 'label'], ['Grab', 'grab', baht], ['LINE', 'line', baht], ['Instagram', 'ig', baht], ['Total', 'total', baht], ['Portions Grab', 'portionsGrab'], ['Portions LINE', 'portionsLine'], ['Portions IG', 'portionsIg']]) : tableOf(rows, TABLE_COLS);
  $('deep').style.display = since ? 'none' : '';
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
  const heat = hm.total ? `<div class="tablewrap" style="margin:8px 0 0"><table><thead><tr><th></th>${hm.hours.map((h) => `<th>${h}</th>`).join('')}<th>Total</th></tr></thead><tbody>${hm.days.map((dn, i) => `<tr><td>${dn}</td>${hm.cells[i].map((v) => `<td style="${shade(v)}">${v || ''}</td>`).join('')}<td><b>${hm.perDay[i]}</b></td></tr>`).join('')}</tbody></table></div><p class="why" style="margin-top:6px">${hm.total - hm.noTime} of ${hm.total} orders have a time. Darker is busier. Hour is the hour the order came in.</p>` : '<p class="why">No orders with a time yet.</p>';
  const creepSeries = d.creep.filter((c) => c.batches.length > 1);
  const palette = ['#294BD4', '#E63D23', '#2E8B6E', '#F8CC1A', '#8A4FD6', '#63CBC6', '#1B2559'];
  let creep = creepSeries.length ? lineChart({ labels: creepSeries[0].batches.map((_, i) => `batch ${i + 1}`), series: creepSeries.map((c, i) => ({ name: c.dish, color: palette[i % palette.length], values: c.batches.map((b) => b.perPortion) })), money: true }) : '';
  creep += tbl(['Dish', 'First batch', 'Latest batch', 'Change'], d.creep.map((c) => [c.dish, baht(c.first), baht(c.latest), c.changePct === null ? '' : `${c.changePct > 0 ? '+' : ''}${c.changePct}%`]));
  if (d.moves.length) creep += `<h2 style="font-size:14px;margin:12px 0 2px">Ingredients that moved 10% or more</h2>` + tbl(['Ingredient', 'Date', 'Before', 'Now', 'Change'], d.moves.map((m) => [m.name, m.date, m.from, m.to, `${m.changePct > 0 ? '+' : ''}${m.changePct}%`]));
  $('deep').innerHTML =
    card('Weekday and hour', 'Which days and hours bring orders, so cooking and posting times follow demand.', heat)
    + card('Sell-through and stock sitting', 'Portions cooked against sold since October, first in first out. Dishes with stock older than 5 days are flagged for a flash sale.', tbl(['Dish', 'Cooked', 'Sold', 'Left', 'Sold %', 'Oldest left', ''], d.sitting.map((x) => [x.dish, x.cooked, x.sold, x.remaining, x.sellPct === null ? '' : `${x.sellPct}%`, x.remaining ? `${x.oldestAgeDays} days` : '', x.old ? 'Flash sale' : ''])))
    + card('Price creep', 'Cost per portion of each batch, in the order cooked. A rising line shows before the margin does.', creep)
    + card('Break-even per batch', 'Portions you must sell to cover the latest batch. Uses the LINE price (kept in full), or the Grab price less its cut when a dish has never sold on LINE.', tbl(['Dish', 'Latest batch', 'Earns per portion', 'Basis', 'Break-even', 'Of the batch'], d.breakEven.map((b) => [b.dish, `${baht(b.batchCost)} (${b.portions} portions, ${b.batchDate})`, b.earnPerPortion === null ? '' : baht(b.earnPerPortion), b.basis, b.breakEvenPortions === null ? '' : `${b.breakEvenPortions} portions`, b.breakEvenPct === null ? '' : `${b.breakEvenPct}%`])));
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
    $('status').textContent = `From ${data.from}. Weeks run Monday to Sunday, the same as the Numbers page. * means not finished yet.`;
    $('notes').innerHTML = data.notes.map((n) => `<li><b>${esc(n.title)}.</b> ${esc(n.text)}</li>`).join('');
    if (data.warnings && data.warnings.length) $('status').textContent += `\n${data.warnings.join('\n')}`;
    draw(); drawMix(); drawDeep();
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
