const $ = (id) => document.getElementById(id);
let RAW = false; // true while building a CSV: plain numbers to 2 decimals, no thousands commas, so Excel reads them as numbers
const baht = (n) => (n === '' || n === null || n === undefined ? '' : RAW ? Math.round(Number(n) * 100) / 100 : Number(n).toLocaleString('en-AU', { maximumFractionDigits: 0 }));

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
  ['Meta ads', (p) => baht(p.ads)],
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

// One row per month, laid out like the Merlin's numbers tab: money in, Grab deductions, ads, costs, profit.
const dash = () => (RAW ? '' : '–'); // months from before the app only have a total cost
const PROFIT = [
  ['Month', (m) => m.label, true],
  ['Borrowed', (m) => (m.key ? (RAW ? (m.borrowed ?? '') : `<span class="borrowbox"><input class="borrow" data-key="${m.key}" data-saved="${m.borrowed ? Math.round(m.borrowed * 100) / 100 : ''}" inputmode="decimal" value="${m.borrowed ? commas(m.borrowed) : ''}" placeholder="0" aria-label="Borrowed in ${m.label}" /><button class="borrowsave" data-key="${m.key}" disabled>Save</button></span>`) : baht(m.borrowed))],
  ['Money to take out', (m) => (m.history ? dash() : baht(m.moneyToTakeOut))],
  ['Monthly net profit', (m) => baht(m.margin), false, (m) => m.margin < 0, (m) => m.margin >= 0],
  ['Costs (approx)', (m) => baht(m.costs !== undefined ? m.costs : m.foodCost + m.line.rider + m.overheads)],
  ['Overheads', (m) => (m.history ? dash() : baht(m.overheads))],
  ['Rider fees', (m) => (m.history ? dash() : baht(m.line.rider))],
  ['Cooking costs', (m) => (m.history ? dash() : baht(m.foodCost))],
  ['Meta ads', (m) => baht(m.ads)],
  ['Direct sales (LINE)', (m) => baht(m.line.net + m.line.delivery)],
  ['Grab sales', (m) => baht(m.grab.gross)],
  ['Merchant funded (discounts)', (m) => baht(m.grab.discount)],
  ['Service fee (commission)', (m) => baht(m.grab.commission)],
  ['Marketing fee', (m) => baht(m.grab.marketing)],
  ['Other Grab fees', (m) => baht(m.grab.otherFees)],
  ['Net Grab earning', (m) => baht(m.grab.net)],
  ['Total earning', (m) => baht(m.line.net + m.line.delivery + m.grab.net)],
];

// 24171 -> 24,171 and 15069.12 -> 15,069.12 (two decimals only when there are some)
const commas = (n) => Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 });

function drawProfit(months) {
  const t = $('profit');
  if (!months.length) { t.innerHTML = '<tr><td>No data yet.</td></tr>'; return; }
  const sumOf = (f) => months.reduce((s, m) => s + f(m), 0);
  const total = {
    label: 'Total',
    line: { net: sumOf((m) => m.line.net), delivery: sumOf((m) => m.line.delivery), rider: sumOf((m) => m.line.rider) },
    grab: { gross: sumOf((m) => m.grab.gross), discount: sumOf((m) => m.grab.discount), commission: sumOf((m) => m.grab.commission), marketing: sumOf((m) => m.grab.marketing), otherFees: sumOf((m) => m.grab.otherFees), net: sumOf((m) => m.grab.net) },
    ads: sumOf((m) => m.ads), foodCost: sumOf((m) => m.foodCost), overheads: sumOf((m) => m.overheads), margin: sumOf((m) => m.margin),
    moneyToTakeOut: sumOf((m) => m.moneyToTakeOut || 0),
    borrowed: sumOf((m) => m.borrowed || 0),
    costs: sumOf((m) => (m.history ? m.costs : m.foodCost + m.line.rider + m.overheads)),
  };
  const cells = (m) => PROFIT.map((c) => `<td class="${c[3] && c[3](m) ? 'neg' : c[4] && c[4](m) ? 'pos' : ''}">${c[1](m)}</td>`).join('');
  t.innerHTML = `<tr>${PROFIT.map((c) => `<th>${c[0]}</th>`).join('')}</tr>` + [...months].reverse().map((m) => `<tr>${cells(m)}</tr>`).join('') + `<tr style="font-weight:600">${cells(total)}</tr>`;
  wireBorrowed(t);
}

// Borrowed: type a figure, then press Save (or Enter). The button stays disabled until the figure differs from what is saved.
function wireBorrowed(t) {
  const clean = (v) => String(v ?? '').replace(/[฿,\s]/g, '');
  t.querySelectorAll('input.borrow').forEach((inp) => {
    const btn = t.querySelector(`button.borrowsave[data-key="${inp.dataset.key}"]`);
    const label = inp.getAttribute('aria-label').replace('Borrowed in ', '');
    const dirty = () => clean(inp.value) !== clean(inp.dataset.saved);
    const mark = () => { btn.disabled = !dirty(); btn.textContent = 'Save'; inp.classList.toggle('unsaved', dirty()); };
    const save = async () => {
      if (!dirty()) return;
      const amount = clean(inp.value);
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const r = await call('/api/borrowed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month: inp.dataset.key, amount }) });
        inp.dataset.saved = r.amount ? String(r.amount) : '';
        inp.value = r.amount ? commas(r.amount) : '';
        mark();
        say(`Saved. Borrowed for ${label}: ฿${baht(r.amount || 0)}.`);
        load();
      } catch (err) { btn.textContent = 'Save'; btn.disabled = false; say(`Not saved. ${err.message}`, true); }
    };
    inp.addEventListener('input', mark);
    inp.addEventListener('blur', () => { const v = clean(inp.value); if (v !== '' && !Number.isNaN(Number(v))) inp.value = commas(v); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    btn.addEventListener('click', save);
  });
}

window.addEventListener('beforeunload', (e) => {
  if (document.querySelector('input.borrow.unsaved')) { e.preventDefault(); e.returnValue = ''; }
});

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

// ---- CSV downloads (open in Excel). Same columns as the tables on this page, but every period, not just what is shown. ----
let DATA = { daily: [], weekly: [], monthly: [], profit: [] };
const csvCell = (v) => { const t = String(v ?? '').replace(/<[^>]*>/g, ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
function downloadCsv(name, columns, rows) {
  RAW = true;
  let lines;
  try {
    lines = [columns.map((c) => csvCell(c[0])).join(','), ...rows.map((r) => columns.map((c) => csvCell(c[1](r))).join(','))];
  } finally { RAW = false; }
  const today = new Date().toISOString().slice(0, 10);
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `merlins-dish-${name}-${today}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const CSV_SETS = { profit: () => [PROFIT, DATA.profit], monthly: () => [COLUMNS, DATA.monthly], weekly: () => [COLUMNS, DATA.weekly], daily: () => [COLUMNS, DATA.daily] };
document.querySelectorAll('[data-csv]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.csv; const [cols, rows] = CSV_SETS[k]();
  if (!rows.length) { say('Nothing to download yet.', true); return; }
  downloadCsv(k === 'profit' ? 'summary' : k, cols, rows);
  say(`Downloaded ${rows.length} rows.`);
}));

async function load() {
  try {
    const d = await call('/api/reports/summary');
    if (!d.daily) say('The server is still on an older version, so the Daily table is empty. Wait for the Railway deploy to finish, then refresh.', true);
    draw('daily', (d.daily || []).slice(-60), true);
    draw('weekly', d.weekly, true);
    draw('monthly', d.monthly, true);
    drawProfit(d.profit || d.monthly || []);
    DATA = { daily: d.daily || [], weekly: d.weekly || [], monthly: d.monthly || [], profit: d.profit || d.monthly || [] };
  } catch (err) { say(err.message, true); }
}

$('csv').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  const lines = [];
  let failed = 0;
  // One file at a time, so a bad file never stops the others. Each CSV replaces only its own Grab days, so re-importing is safe.
  for (const [i, f] of files.entries()) {
    say(`Importing ${i + 1} of ${files.length}: ${f.name}…`);
    try {
      const fd = new FormData();
      fd.append('csv', f);
      const r = await call('/api/ledger/grab-csv', { method: 'POST', body: fd });
      lines.push(`${f.name}: ${r.imported} rows for ${r.days.length} days, ${r.orders} orders. Replaced ${r.replaced} rows already there.${r.flagged ? ` ${r.flagged} rows carry XXXXXX or a missing figure.` : ''}${r.problems.length ? ` Skipped: ${r.problems.slice(0, 3).join(' ')}` : ''}`);
    } catch (err) { failed += 1; lines.push(`${f.name}: ${err.message}`); }
  }
  say(lines.join('\n'), failed > 0);
  load();
  e.target.value = '';
});

$('driveImport').addEventListener('click', async () => {
  say('Checking the "Ready for BOH" folder in Drive…');
  try {
    const r = await call('/api/ledger/drive-import', { method: 'POST' });
    if (!r.files.length) { say('Nothing waiting in "Ready for BOH".'); return; }
    const lines = r.files.map((f) => f.ok
      ? `${f.name}: ${f.orders} orders, ${f.imported} rows, replaced ${f.replaced}.${f.flagged ? ` ${f.flagged} rows carry XXXXXX or a missing figure.` : ''}${f.moved ? '' : ' Imported, but could not be moved to "Imported".'}`
      : `${f.name}: ${f.error} It stays in "Ready for BOH".`);
    say(lines.join('\n'), r.files.some((f) => !f.ok));
    load();
  } catch (err) { say(err.message, true); }
});

$('weeklyExport').addEventListener('click', async () => {
  say('Saving last week (Sunday to Saturday) to Drive…');
  try {
    const r = await call('/api/export/weekly', { method: 'POST' });
    say(r.text, r.files.some((f) => !f.ok));
  } catch (err) { say(err.message, true); }
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

$('manGo').addEventListener('click', async () => {
  try {
    const r = await call('/api/ledger/manual-orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: $('manText').value }) });
    const lines = r.added.map((o) => `Added ${o.date} ${o.name}, ฿${baht(o.total)} (${o.ref})`).concat(r.skipped.map((o) => `Already there: ${o.date} ${o.name}, ฿${baht(o.total)}`), r.problems);
    say(lines.join('\n'), r.problems.length > 0 && !r.added.length);
    if (r.added.length) { $('manText').value = ''; load(); }
  } catch (err) { say(err.message, true); }
});

$('delGo').addEventListener('click', async () => {
  const where = $('delWhere').value; // ledger-Grab, ledger-LINE, ledger-All, expense, overheads
  const isLedger = where.startsWith('ledger-');
  const label = isLedger ? `${where.slice(7)} rows of the Ledger` : where === 'expense' ? 'rows of the Expense Log' : 'rows of the Overheads tab';
  const body = { from: $('delFrom').value.trim(), to: $('delTo').value.trim() || $('delFrom').value.trim(), target: isLedger ? 'ledger' : where, channel: isLedger ? where.slice(7) : 'All' };
  const post = (extra) => call('/api/ledger/delete-range', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...extra }) });
  try {
    const peek = await post({ dryRun: true });
    if (!peek.count) { say('No rows match that range.'); return; }
    if (!confirm(`Delete ${peek.count} ${label} from ${body.from} to ${body.to}? This cannot be undone.${isLedger ? '' : ' Stock lots are not changed.'}`)) { say('Nothing deleted.'); return; }
    const r = await post({});
    say(`${r.deleted} rows deleted.`);
    $('detail').innerHTML = '';
    load();
  } catch (err) { say(err.message, true); }
});

load();
