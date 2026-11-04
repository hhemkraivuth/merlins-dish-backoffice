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
  ['Ads (Meta, Grab)', (p) => baht(p.ads)],
  ['Margin after overheads and ads', (p) => baht(p.margin), false, (p) => p.margin < 0],
  ['Margin %', (p) => (p.marginPct === null ? '' : p.marginPct + '%')],
  ['Purchases (memo)', (p) => baht(p.purchases)],
];

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function draw(id, periods, clickable) {
  const t = $(id);
  if (!periods.length) { t.innerHTML = '<tr><td>No data yet. Import the Grab CSV and sync LINE orders.</td></tr>'; return; }
  const head = `<tr>${COLUMNS.map((c) => `<th>${c[0]}</th>`).join('')}</tr>`;
  const body = periods.map((p, i) => ({ p, i })).reverse().map(({ p, i }) => `<tr class="${clickable ? 'row' : ''}" data-from="${clickable ? p.from : ''}" data-to="${clickable ? p.to : ''}" data-i="${i}" title="${(p.missingCosts.length ? 'No cost found for: ' + p.missingCosts.join(', ') : '')}">${COLUMNS.map((c) => `<td class="${c[3] && c[3](p) ? 'neg' : ''}">${c[1](p)}</td>`).join('')}</tr>`).join('');
  t.innerHTML = head + body;
  if (clickable) t.querySelectorAll('tr.row').forEach((tr) => tr.addEventListener('click', () => showDay(tr.dataset.from, tr.dataset.to, periods[Number(tr.dataset.i)])));
}

function table(headers, rows) {
  if (!rows.length) return '<p class="intro-body">Nothing logged.</p>';
  return `<div class="tablewrap"><table><tr>${headers.map((h, i) => `<th class="${i === 0 || h[1] ? 'left' : ''}">${h[0] || h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${headers[i][1] ? 'left' : ''}">${c}</td>`).join('')}</tr>`).join('')}</table></div>`;
}


// Edit and Delete for each Ledger row of the open day. Rows are found by their Source Key.
function wireRows(box, d) {
  const byKey = new Map(d.rows.filter((r) => r.key).map((r) => [r.key, r]));
  box.querySelectorAll('span.act').forEach((span) => {
    const td = span.closest('td'); td.classList.add('act');
    const tr = span.closest('tr');
    const key = span.dataset.key;
    const row = byKey.get(key);
    const show = () => {
      td.innerHTML = '<button class="edit">Edit</button><button class="danger del">Delete</button>';
      td.querySelector('.edit').addEventListener('click', edit);
      td.querySelector('.del').addEventListener('click', async () => {
        if (!confirm(`Delete this row?\n${row.channel} ${row.type}: ${row.desc} (${row.orderNo || 'no order number'})`)) return;
        try { await call('/api/ledger/row/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) }); say('Row deleted.'); reopen(); load(); } catch (err) { say(err.message, true); }
      });
    };
    const edit = () => {
      const cells = tr.querySelectorAll('td');
      const field = (i, name, val, wide) => { cells[i].innerHTML = `<input class="cell${wide ? ' wide' : ''}" data-f="${name}" value="${esc(val ?? '')}" />`; };
      field(0, 'time', row.time); field(2, 'customer', row.customer, true); field(6, 'desc', row.desc, true);
      field(7, 'qty', row.qty); field(8, 'moneyIn', row.moneyIn); field(9, 'cost', row.cost); field(10, 'net', row.net);
      td.innerHTML = '<button class="save">Save</button><button class="cancel">Cancel</button>';
      td.querySelector('.cancel').addEventListener('click', () => reopen());
      td.querySelector('.save').addEventListener('click', async () => {
        const changes = {};
        tr.querySelectorAll('input.cell').forEach((i) => { changes[i.dataset.f] = i.value; });
        try { await call('/api/ledger/row/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, changes }) }); say('Row saved. Net income is not recalculated, so edit Net too if you change Money in.'); reopen(); load(); } catch (err) { say(err.message, true); }
      });
    };
    show();
  });
}

let current = null;
const reopen = () => { if (current) showDay(current.from, current.to, current.p); };

async function showDay(from, to, p) {
  current = { from, to, p };
  const box = $('detail');
  box.innerHTML = '<p class="intro-body">Loading…</p>';
  try {
    const d = await call('/api/reports/day?date=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to || from));
    const range = d.from !== d.to;
    const s = d.summary || p;
    const when = (r) => (range ? `${esc(r.date)}<br>` : '');
    const head = s ? `<p class="intro-body">Net income ฿${baht(s.revenue)}, food cost ฿${baht(s.foodCost)}, rider fees ฿${baht(s.line.rider)}, new customers ${d.people.new}, RT customers ${d.people.rt}, overheads ฿${baht(s.overheads)}, ads ฿${baht(s.ads)}, margin after overheads and ads ฿${baht(s.margin)}${s.marginPct === null ? '' : ' (' + s.marginPct + '%)'}.</p>` : '';
    box.innerHTML = `<h3>${esc(d.date)} <button id="delPeriod" class="alt-btn">Delete all rows in this period</button></h3>${head}
      <h3>Orders and fees</h3>
      ${table([['Time', 1], ['Order', 1], ['Customer', 1], ['Status', 1], ['Channel', 1], ['Type', 1], ['Description', 1], ['Qty'], ['Money in'], ['Cost'], ['Net'], ['Flags', 1], ['']],
        d.rows.map((r) => [when(r) + esc(r.time), esc(r.orderNo), esc(r.customer), esc(r.status), esc(r.channel), esc(r.type), esc(r.desc), r.qty ?? '', baht(r.moneyIn), baht(r.cost), baht(r.net), r.flags ? `<span class="flag">${esc(r.flags)}</span>` : '', r.key ? `<span class="act" data-key="${esc(r.key)}"></span>` : '']))}
      <h3>Orders by hour</h3>
      ${Object.keys(d.byHour).length ? `<p class="intro-body">${Object.keys(d.byHour).sort().map((h) => `${h}:00 → ${d.byHour[h]}`).join(' · ')}</p>` : '<p class="intro-body">No order times logged.</p>'}
      <h3>Cooked</h3>
      ${table([['Date', 1], ['Dish', 1], ['Portions'], ['Batch cost'], ['Per portion']], d.cooked.map((c) => [esc(c.date), esc(c.dish), c.portions, baht(c.cost), c.perPortion === null ? '' : c.perPortion]))}
      <h3>Bought</h3>
      ${table([['Date', 1], ['Item', 1], ['Type', 1], ['Amount']], d.bought.map((b) => [esc(b.date), esc(b.name), esc(b.kind), baht(b.amount)]))}`;
    wireRows(box, d);
    $('delPeriod').addEventListener('click', async () => {
      const body = { from: d.from, to: d.to, channel: 'All' };
      const post = (extra) => call('/api/ledger/delete-range', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...extra }) });
      try {
        const peek = await post({ dryRun: true });
        if (!peek.count) { say('No ledger rows in this period.'); return; }
        if (!confirm(`Delete all ${peek.count} ledger rows (Grab and LINE) for ${d.date}? This cannot be undone.`)) { say('Nothing deleted.'); return; }
        const r = await post({});
        say(`${r.deleted} rows deleted.`);
        box.innerHTML = '';
        load();
      } catch (err) { say(err.message, true); }
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { box.innerHTML = ''; say(err.message, true); }
}

async function load() {
  try {
    const d = await call('/api/reports/summary');
    if (!d.daily) say('The server is still on an older version, so the Daily table is empty. Wait for the Railway deploy to finish, then refresh.', true);
    draw('daily', (d.daily || []).slice(-60), true);
    draw('weekly', d.weekly, true);
    draw('monthly', d.monthly, true);
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

$('delGo').addEventListener('click', async () => {
  const body = { from: $('delFrom').value.trim(), to: $('delTo').value.trim(), channel: $('delChannel').value };
  const post = (extra) => call('/api/ledger/delete-range', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...extra }) });
  try {
    const peek = await post({ dryRun: true });
    if (!peek.count) { say('No rows match that range.'); return; }
    if (!confirm(`Delete ${peek.count} ${body.channel} rows from ${body.from} to ${body.to}? This cannot be undone.`)) { say('Nothing deleted.'); return; }
    const r = await post({});
    say(`${r.deleted} rows deleted.`);
    $('detail').innerHTML = '';
    load();
  } catch (err) { say(err.message, true); }
});

load();
