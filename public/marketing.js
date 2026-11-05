const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TITLES = { Competitor: 'Competitors', Inspo: 'Inspo accounts', Trend: 'Trends', 'Ad draft': 'Ad drafts (nothing runs without your approval)', Date: 'Dates and festivals' };

// "Key: ..." goes on its own line so long summaries are easier to read.
function body(text) {
  const parts = String(text || '').split(/\s+Key:\s*/);
  return parts.length > 1 ? `${esc(parts[0])}<br><b>Key:</b> ${esc(parts.slice(1).join(' Key: '))}<br>` : (text ? esc(text) + '<br>' : '');
}

function note(n) {
  const draft = n.kind === 'Ad draft' && /draft/i.test(n.status) ? '<span class="draft">Draft</span>' : '';
  return `<div class="note"><b>${esc(n.title)}${draft}</b>${body(n.note)}<small>${esc(n.date)}</small></div>`;
}

// Full history as a CSV for Excel, same approach as the Numbers page. Key is split into its own column.
let HISTORY = [];
function downloadNotes() {
  const cell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ['Date', 'Kind', 'Title', 'Summary', 'Key', 'Status'];
  const rows = HISTORY.map((n) => { const p = String(n.note || '').split(/\s+Key:\s*/); return [n.date, n.kind, n.title, p[0], p.slice(1).join(' Key: '), n.status]; });
  const blob = new Blob(['\ufeff' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const t = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `merlins-dish-marketing-notes-${String(t.getDate()).padStart(2, '0')}-${String(t.getMonth() + 1).padStart(2, '0')}-${t.getFullYear()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  return rows.length;
}

function draw(d) {
  HISTORY = d.history || [];
  $('top').innerHTML = `
    <div class="box"><h3>This week</h3><p class="big">${esc(d.week.text)}</p><p class="sub">Grab: ${esc(d.week.grabText)}<br>LINE: ${esc(d.week.lineText)}<br>Instagram: ${esc(d.week.igText)}</p></div>
    <div class="box"><h3>This month</h3><p class="big">${esc(d.month.text)}</p><p class="sub">Grab: ${esc(d.month.grabText)}<br>LINE: ${esc(d.month.lineText)}<br>Instagram: ${esc(d.month.igText)}</p></div>
    <div class="box"><h3>Competitor check</h3><p class="big ${d.auditDue ? 'due' : ''}">${d.auditDue ? 'Check pending' : 'Up to date'}</p><p class="sub">${esc(d.auditNote)} Claude runs it every Sunday at 11pm, the summary lands here.</p></div>
    <div class="box"><h3>Coming up</h3>${d.dates.length ? d.dates.map((x) => `<p class="sub">${esc(x.day)} ${esc(x.date)}: ${esc(x.label)} (${x.away} days)</p>`).join('') : '<p class="sub">Nothing fixed in the next 60 days.</p>'}</div>`;
  const EMPTY = { Competitor: 'Updated every Sunday night.', Inspo: 'Updated every Sunday night.', Trend: 'Updated every Sunday night.', 'Ad draft': 'Drafts only, nothing runs without your approval.', Date: 'Festivals and holidays, updated every Sunday night.' };
  $('sections').innerHTML = d.kinds.map((k) => {
    const list = d.notes[k] || [];
    return `<div class="box"><details ${list.length ? 'open' : ''}><summary>${esc(TITLES[k] || k)} (${list.length})</summary>${list.length ? list.slice(0, 10).map(note).join('') : `<p class="sub">${esc(EMPTY[k] || 'Nothing logged yet.')}</p>`}</details></div>`;
  }).join('');
}

async function load() {
  const s = $('status');
  try {
    const res = await fetch('/api/marketing');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    draw(d);
    $('dlNotes').textContent = `Download all notes (CSV, ${HISTORY.length} rows)`;
    if (!$('kind').options.length) $('kind').innerHTML = d.kinds.map((k) => `<option>${esc(k)}</option>`).join('');
    s.textContent = '';
  } catch (err) { s.className = 'status err'; s.textContent = err.message; }
}

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = $('addStatus');
  a.textContent = 'Saving…';
  try {
    const res = await fetch('/api/marketing/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: $('kind').value, title: $('title').value, note: $('note').value }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Not saved');
    $('title').value = ''; $('note').value = '';
    a.textContent = 'Saved.';
    load();
  } catch (err) { a.textContent = `Not saved: ${err.message}`; }
});
$('dlNotes').addEventListener('click', () => { const n = downloadNotes(); const st = $('status'); st.className = 'status'; st.textContent = `Downloaded ${n} rows.`; });
load();
