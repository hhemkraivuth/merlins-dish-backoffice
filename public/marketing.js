const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TITLES = { Competitor: 'Competitors', Inspo: 'Inspo accounts', Trend: 'Trends', 'Ad draft': 'Ad drafts (nothing runs without your approval)', Date: 'Dates and festivals' };

// "Key: ..." and "Borrow: ..." each go on their own line so long summaries are easier to read.
// Key is the one thing to know. Borrow is the one idea from an inspo account worth copying for Merlin's.
function parts(text) {
  const t = String(text || '');
  const re = /(?:^|\s)(Key|Borrow):\s*/g;
  const out = { summary: '', Key: '', Borrow: '' };
  let label = 'summary'; let last = 0; let m;
  while ((m = re.exec(t))) { out[label] = (out[label] ? out[label] + ' ' : '') + t.slice(last, m.index).trim(); label = m[1]; last = m.index + m[0].length; }
  out[label] = (out[label] ? out[label] + ' ' : '') + t.slice(last).trim();
  return out;
}
function body(text) {
  const p = parts(text);
  return (p.summary ? esc(p.summary) + '<br>' : '') + (p.Key ? `<b>Key:</b> ${esc(p.Key)}<br>` : '') + (p.Borrow ? `<b>Borrow:</b> ${esc(p.Borrow)}<br>` : '');
}

function note(n) {
  const draft = n.kind === 'Ad draft' && /draft/i.test(n.status) ? '<span class="draft">Draft</span>' : '';
  return `<div class="note"><b>${esc(n.title)}${draft}</b>${body(n.note)}<small>${esc(n.date)}</small></div>`;
}

// Full history as a CSV for Excel, same approach as the Numbers page. Key is split into its own column.
let HISTORY = [];
function downloadNotes() {
  const cell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ['Date', 'Kind', 'Title', 'Summary', 'Key', 'Borrow', 'Status'];
  const rows = HISTORY.map((n) => { const p = parts(n.note); return [n.date, n.kind, n.title, p.summary, p.Key, p.Borrow, n.status]; });
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
    <div class="box"><h3>Coming up</h3>${d.dates.length ? d.dates.map((x) => `<p class="sub">${esc(x.day)} ${esc(x.date)}: ${esc(x.label)} (${x.away} days)</p>`).join('') : '<p class="sub">Nothing fixed in the next 60 days.</p>'}</div>`;
  const EMPTY = { Competitor: 'Updated every Sunday night.', Inspo: 'Updated every Sunday night.', Trend: 'Updated every Sunday night.', 'Ad draft': 'Drafts only, nothing runs without your approval.', Date: 'Festivals and holidays, updated every Sunday night.' };
  const section = (title, list, empty) => `<div class="box"><details ${list.length ? 'open' : ''}><summary>${esc(title)} (${list.length})</summary>${list.length ? list.map(note).join('') : `<p class="sub">${esc(empty)}</p>`}</details></div>`;
  // Competitors: Grab shops first, then the Instagram accounts (their title starts with @). Nothing is cut off.
  const cl = d.notes.Competitor || [];
  const social = cl.filter((n) => /^\s*@/.test(n.title));
  const grab = cl.filter((n) => !/^\s*@/.test(n.title));
  const status = `<p class="big ${d.auditDue ? 'due' : ''}">${d.auditDue ? 'Check pending' : 'Up to date'}</p><p class="sub">${esc(d.auditNote)} Claude runs it every Sunday at 11pm, the summary lands here.</p>`;
  const competitors = `<div class="box"><h3>Grab competitors</h3>${status}<details ${grab.length ? 'open' : ''}><summary>Grab shops (${grab.length})</summary>${grab.length ? grab.map(note).join('') : '<p class="sub">Add a screenshot folder per shop in Competitor Grab screenshots. Updated every Sunday night.</p>'}</details></div>`
    + `<div class="box"><h3>Social competitors</h3><details ${social.length ? 'open' : ''}><summary>Instagram accounts (${social.length})</summary>${social.length ? social.map(note).join('') : '<p class="sub">Updated every Sunday night.</p>'}</details></div>`;
  // Order: Trends under Coming up, then competitors, then everything else.
  // Inspo: @hangrybeefnoodle (the content plan account) always sits at the top.
  if (d.notes.Inspo) d.notes.Inspo = [...d.notes.Inspo].sort((a, b) => (/hangrybeefnoodle/i.test(b.title) ? 1 : 0) - (/hangrybeefnoodle/i.test(a.title) ? 1 : 0));
  const rest = d.kinds.filter((k) => k !== 'Competitor' && k !== 'Trend').map((k) => section(TITLES[k] || k, d.notes[k] || [], EMPTY[k] || 'Nothing logged yet.')).join('');
  $('sections').innerHTML = section(TITLES.Trend, d.notes.Trend || [], EMPTY.Trend) + competitors + rest;
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
