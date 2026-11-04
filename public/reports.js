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
  ['Margin', (p) => baht(p.margin), false, (p) => p.margin < 0],
  ['Margin %', (p) => (p.marginPct === null ? '' : p.marginPct + '%')],
  ['Purchases (memo)', (p) => baht(p.purchases)],
];

function draw(id, periods) {
  const t = $(id);
  if (!periods.length) { t.innerHTML = '<tr><td>No data yet. Import the Grab CSV and sync LINE orders.</td></tr>'; return; }
  const head = `<tr>${COLUMNS.map((c) => `<th>${c[0]}</th>`).join('')}</tr>`;
  const body = [...periods].reverse().map((p) => `<tr title="${(p.missingCosts.length ? 'No cost found for: ' + p.missingCosts.join(', ') : '')}">${COLUMNS.map((c) => `<td class="${c[3] && c[3](p) ? 'neg' : ''}">${c[1](p)}</td>`).join('')}</tr>`).join('');
  t.innerHTML = head + body;
}

async function load() {
  try {
    const d = await call('/api/reports/summary');
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
