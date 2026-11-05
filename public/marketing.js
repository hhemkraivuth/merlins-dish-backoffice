const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TITLES = { Competitor: 'Competitors', Inspo: 'Inspo accounts', Trend: 'Trends', 'Ad draft': 'Ad drafts (nothing runs without your approval)', Date: 'Dates and festivals' };

function note(n) {
  const draft = n.kind === 'Ad draft' && /draft/i.test(n.status) ? '<span class="draft">Draft</span>' : '';
  return `<div class="note"><b>${esc(n.title)}${draft}</b>${n.note ? esc(n.note) + '<br>' : ''}<small>${esc(n.date)}</small></div>`;
}

function draw(d) {
  $('top').innerHTML = `
    <div class="box"><h3>This week</h3><p class="big">${esc(d.week.text)}</p><p class="sub">Grab: ${esc(d.week.grabText)}<br>LINE: ${esc(d.week.lineText)}<br>Instagram: ${esc(d.week.igText)}</p></div>
    <div class="box"><h3>This month</h3><p class="big">${esc(d.month.text)}</p><p class="sub">Grab: ${esc(d.month.grabText)}<br>LINE: ${esc(d.month.lineText)}<br>Instagram: ${esc(d.month.igText)}</p></div>
    <div class="box"><h3>Competitor check</h3><p class="big ${d.auditDue ? 'due' : ''}">${d.auditDue ? 'Check pending' : 'Up to date'}</p><p class="sub">${esc(d.auditNote)} Claude runs it every Monday, the summary lands here.</p></div>
    <div class="box"><h3>Coming up</h3>${d.dates.length ? d.dates.map((x) => `<p class="sub">${esc(x.date)}: ${esc(x.label)} (${x.away} days)</p>`).join('') : '<p class="sub">Nothing fixed in the next 60 days.</p>'}</div>`;
  const filled = d.kinds.filter((k) => (d.notes[k] || []).length);
  $('sections').innerHTML = filled.length
    ? filled.map((k) => `<div class="box"><details open><summary>${esc(TITLES[k] || k)} (${d.notes[k].length})</summary>${d.notes[k].slice(0, 10).map(note).join('')}</details></div>`).join('')
    : '<div class="box"><p class="sub">Competitor checks, inspo, trends and ad drafts from Claude appear here once they are logged.</p></div>';
}

async function load() {
  const s = $('status');
  try {
    const res = await fetch('/api/marketing');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    draw(d);
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
load();
