const $ = (id) => document.getElementById(id);
const baht = (n) => (n === '' || n === null || n === undefined ? '' : Number(n).toLocaleString('en-AU', { maximumFractionDigits: 0 }));

function say(msg, err) { const s = $('status'); s.textContent = msg; s.className = 'status' + (err ? ' err' : ''); }

async function call(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

const COLUMNS = [
  ['Period', (p) => p.label, true],
  ['Grab orders', (p) => p.grab.orders],
  ['Grab gross', (p) => baht(p.grab.gross)],
  ['Grab fees + discounts', (p) => baht(p.grab.discount + p.grab.commission + p.grab.marketing + p.grab.otherFees)],
  ['Grab net', (p) => baht(p.grab.net)],
  ['LINE orders', (p) => p.line.orders],
  ['LINE net', (p) => baht(p.line.net)],
  ['Delivery charged', (p) => baht(p.line.delivery)],
  ['Net income', (p) => baht(p.revenue)],
  ['Recipe costs', (p) => baht(p.recipeCost + p.lineEstCost)],
  ['Batch cook costs', (p) => baht(p.cookCost)],
  ['Rider fees paid', (p) => baht(p.line.rider)],
  ['Margin before overheads', (p) => baht(p.marginBeforeOverheads)],
  ['Overheads bought', (p) => baht(p.overheads)],
  ['Margin after overheads', (p) => baht(p.margin), false, (p) => p.margin < 0],
  ['Margin %', (p) => (p.marginPct === null ? '' : p.marginPct + '%')],
  ['Purchases (memo)', (p) => baht(p.purchases)],
];

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function draw(id, periods, clickable) {
  const t = $(id);
  if (!periods.length) { t.innerHTML = '<tr><td>No data yet. Import the Grab CSV and sync LINE orders.</td></tr>'; return; }
  const head = `<tr>${COLUMNS.map((c) => `<th>${c[0]}</th>`).join('')}</tr>`;
  const body = [...periods].reverse().map((p) => `<tr class="${clickable ? 'row' : ''}" data-date="${clickable ? p.from : ''}" title="${(p.missingCosts.length ? 'No cost found for: ' + p.missingCosts.join(', ') : '')}">${COLUMNS.map((c) => `<td class="${c[3] && c[3](p) ? 'neg' : ''}">${c[1](p)}</td>`).join('')}</tr>`).join('');
  t.innerHTML = head + body;
  if (clickable) t.querySelectorAll('tr.row').forEach((tr) => tr.addEventListener('click', () => showDay(tr.dataset.date)));
}

function table(headers, rows) {
  if (!rows.length) return '<p class="intro-body">Nothing logged.</p>';
  return `<div class="tablewrap"><table><tr>${headers.map((h, i) => `<th class="${i === 0 || h[1] ? 'left' : ''}">${h[0] || h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${headers[i][1] ? 'left' : ''}">${c}</td>`).join('')}</tr>`).join('')}</table></div>`;
}

async function showDay(dmy) {
  const box = $('detail');
  box.innerHTML = '<p class="intro-body">Loading…</p>';
  try {
    const d = await call('/api/reports/day?date=' + encodeURIComponent(dmy));
    const s = d.summary;
    const head = s ? `<p class="intro-body">Net income ฿${baht(s.revenue)}, food cost ฿${baht(s.foodCost)}, rider fees ฿${baht(s.line.rider)}, new customers ${d.people.new}, RT customers ${d.people.rt}, overheads ฿${baht(s.overheads)}, margin after overheads ฿${baht(s.margin)}${s.marginPct === null ? '' : ' (' + s.marginPct + '%)'}.</p>` : '';
    box.innerHTML = `<h3>${esc(d.date)}</h3>${head}
      <h3>Orders and fees</h3>
      ${table([['Time', 1], ['Order', 1], ['Customer', 1], ['Status', 1], ['Channel', 1], ['Type', 1], ['Description', 1], ['Qty'], ['Money in'], ['Cost'], ['Net'], ['Flags', 1]],
        d.rows.map((r) => [esc(r.time), esc(r.orderNo), esc(r.customer), esc(r.status), esc(r.channel), esc(r.type), esc(r.desc), r.qty ?? '', baht(r.moneyIn), baht(r.cost), baht(r.net), r.flags ? `<span class="flag">${esc(r.flags)}</span>` : '']))}
      <h3>Orders by hour</h3>
      ${Object.keys(d.byHour).length ? `<p class="intro-body">${Object.keys(d.byHour).sort().map((h) => `${h}:00 → ${d.byHour[h]}`).join(' · ')}</p>` : '<p class="intro-body">No order times logged.</p>'}
      <h3>Cooked</h3>
      ${table([['Dish', 1], ['Portions'], ['Batch cost'], ['Per portion']], d.cooked.map((c) => [esc(c.dish), c.portions, baht(c.cost), c.perPortion === null ? '' : c.perPortion]))}
      <h3>Bought</h3>
      ${table([['Item', 1], ['Type', 1], ['Amount']], d.bought.map((b) => [esc(b.name), esc(b.kind), baht(b.amount)]))}`;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { box.innerHTML = ''; say(err.message, true); }
}

async function load() {
  try {
    const d = await call('/api/reports/summary');
    if (!d.daily) say('The server is still on an older version, so the Daily table is empty. Wait for the Railway deploy to finish, then refresh.', true);
    draw('daily', (d.daily || []).slice(-60), true);
    draw('weekly', d.weekly);
    draw('monthly', d.monthly);
  } catch (err) { say(err.message, true); }
}

$('csv').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  say('Importing…');
  try {
    const fd = new FormData();
    fd.append('csv', f);
    const r = await call('/api/ledger/grab-csv', { method: 'POST', body: fd });
    say(`Imported ${r.imported} rows for ${r.days.join(', ')}.\n${r.orders} orders. Replaced ${r.replaced} rows that were already there.${r.flagged ? `\n${r.flagged} rows carry XXXXXX or a missing figure.` : ''}${r.problems.length ? `\nSkipped: ${r.problems.slice(0, 3).join(' ')}` : ''}`);
    load();
  } catch (err) { say(err.message, true); }
  e.target.value = '';
});

$('sync').addEventListener('click', async () => {
  say('Reading LINE orders…');
  try {
    const r = await call('/api/ledger/sync-line', { method: 'POST' });
    say(`${r.added} new LINE rows added (${r.read} read).${r.problems.length ? `\nChecks: ${r.problems.slice(0, 3).join(' ')}` : ''}`);
    load();
  } catch (err) { say(err.message, true); }
});

$('refresh').addEventListener('click', async () => {
  say('Updating…');
  try {
    const r = await call('/api/reports/refresh', { method: 'POST' });
    say(`Weekly Report and Monthly Report tabs updated (${r.weeks} weeks, ${r.months} months).`);
  } catch (err) { say(err.message, true); }
});

load();
