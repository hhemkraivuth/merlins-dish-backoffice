const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let PLAN = null;

function detail(p) {
  return `<details><summary>Shot, caption and reasoning</summary><div class="more">
    <b>Visual</b><p>${esc(p.visual)}</p>
    <b>Caption</b><p>${esc(p.caption)}</p>
    <b>Borrowed from</b><p>${esc(p.borrow)}</p>
    <b>Avoiding</b><p>${esc(p.avoid)}</p>
    <b>Audience</b><p>${esc(p.audience)}</p>
  </div></details>`;
}
function card(p) {
  const chips = `<span class="chip">${esc(p.pillar)}</span><span class="chip">${esc(p.format)}</span>`;
  const btns = p.status === 'approved'
    ? `<div class="btns"><button class="done" data-id="${esc(p.id)}" data-s="published">Mark published</button><button class="no" data-id="${esc(p.id)}" data-s="proposed">Undo</button></div>`
    : p.status === 'dismissed'
      ? `<div class="btns"><button class="no" data-id="${esc(p.id)}" data-s="proposed">Bring back</button></div>`
      : `<div class="btns"><button class="yes" data-id="${esc(p.id)}" data-s="approved">Approve</button><button class="no" data-id="${esc(p.id)}" data-s="dismissed">Dismiss</button></div>`;
  return `<div class="card ${esc(p.status)}"><div class="when">Post ${esc(p.date)}, 5:00 PM</div><div class="name">${esc(p.title)}</div>
    <div>${chips}</div><div class="hook"><b>Hook:</b> ${esc(p.hook)}</div>${detail(p)}${btns}</div>`;
}
function items(list, key) {
  return list.map((i) => `<div class="item"><b>${esc(i.from)}</b>: ${esc(i.idea)}<small>${esc(key === 'use' ? 'For Merlin\'s: ' + i.use : 'Why not: ' + i.why)}</small></div>`).join('');
}
function draw() {
  const ps = PLAN.proposals;
  const by = (s) => ps.filter((p) => p.status === s);
  const n = { review: by('proposed').length, ok: by('approved').length, no: by('dismissed').length, pub: by('published').length };
  $('top').innerHTML = `<div class="top">${n.review} to review, ${n.ok} approved to shoot, ${n.pub} published, ${n.no} dismissed. Plan prepared ${esc(PLAN.prepared)}.</div>`;
  $('shoot').innerHTML = by('approved').map(card).join('') || '<p class="empty">Nothing approved yet.</p>';
  $('review').innerHTML = by('proposed').map(card).join('') || '<p class="empty">Everything has been decided.</p>';
  const pub = by('published');
  $('gone').innerHTML = (by('dismissed').map(card).join('') + pub.map((p) => `<div class="card"><div class="when">Published, ${esc(p.date)}</div><div class="name">${esc(p.title)}</div></div>`).join('')) || '<p class="empty">None.</p>';
  const s = PLAN.style || {};
  $('why').innerHTML = `
    <details class="box"><summary>What to borrow from competitors and inspo</summary>${items(PLAN.analysis.borrow, 'use')}</details>
    <details class="box"><summary>What to avoid</summary>${items(PLAN.analysis.avoid, 'why')}</details>
    <details class="box"><summary>Our Instagram: visual, context and copy</summary><div class="more"><b>Visual style</b><p>${esc(s.visual)}</p><b>Context style</b><p>${esc(s.context)}</p><b>Copywriting</b><p>${esc(s.copy)}</p><b>Sources</b><p>${esc(PLAN.sources)}</p></div></details>`;
}
async function load() {
  const st = $('status');
  try {
    const res = await fetch('/api/content-plan');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    PLAN = d; draw(); st.textContent = '';
  } catch (err) { st.className = 'status err'; st.textContent = err.message; }
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  const all = document.querySelectorAll('button[data-id]');
  all.forEach((x) => { x.disabled = true; });
  try {
    const res = await fetch('/api/content-plan/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.id, status: b.dataset.s }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Not saved');
    await load();
  } catch (err) { const st = $('status'); st.className = 'status err'; st.textContent = `Not saved: ${err.message}`; all.forEach((x) => { x.disabled = false; }); }
});
load();
