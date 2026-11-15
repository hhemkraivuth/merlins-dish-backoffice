const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let PLAN = null;
let VIEW = null; // the month shown, as { y, m } with m from 0
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pillarOf = (name) => (PLAN.pillars || []).find((x) => x.name === name) || { name, short: name, color: '#3F4663', job: '', from: '' };
const ymd = (dmy) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy || ''); return m ? { d: +m[1], m: +m[2] - 1, y: +m[3] } : null; };

const fullCaption = (p) => `${p.caption}\n\n${p.footer || PLAN.footer || ''}`.trim();
function detail(p) {
  return `<details><summary>Shot and sources</summary><div class="more">
    <b>Visual</b><p>${esc(p.visual)}</p>
    <b>Borrowed from</b><p>${esc(p.borrow)}</p>
    <b>Avoiding</b><p>${esc(p.avoid)}</p>
    <b>Audience</b><p>${esc(p.audience)}</p>
  </div></details>`;
}
function card(p) {
  const pl = pillarOf(p.pillar);
  const chips = `<span class="pill" style="background:${esc(pl.color)}">${esc(p.pillar)}</span><span class="chip">${esc(p.format)}</span>`;
  const pdef = `<div class="pdef"><b>Pillar job:</b> ${esc(pl.job)} <b>From:</b> ${esc(pl.from)}</div>`;
  const btns = p.status === 'approved'
    ? `<div class="btns"><button class="done" data-id="${esc(p.id)}" data-s="published">Mark published</button><button class="no" data-id="${esc(p.id)}" data-s="proposed">Undo</button></div>`
    : p.status === 'dismissed'
      ? `<div class="btns"><button class="no" data-id="${esc(p.id)}" data-s="proposed">Bring back</button></div>`
      : `<div class="btns"><button class="yes" data-id="${esc(p.id)}" data-s="approved">Approve</button><button class="no" data-id="${esc(p.id)}" data-s="dismissed">Dismiss</button></div>`;
  return `<div class="card ${esc(p.status)}" id="post-${esc(p.id)}"><div class="when">Post ${esc(p.date)}, 5:00 PM</div><div class="name">${esc(p.title)}</div>
    <div>${chips}</div>${pdef}<div class="hook"><b>Hook:</b> ${esc(p.hook)}</div><div class="cap"><b>Caption</b><div class="capt" id="cap-${esc(p.id)}">${esc(fullCaption(p))}</div><button type="button" class="copy" data-copy="${esc(p.id)}">Copy caption and footer</button></div><div class="why"><b>Why this post:</b> ${esc(p.why)}</div>${detail(p)}${btns}</div>`;
}
function items(list, key) {
  return list.map((i) => `<div class="item"><b>${esc(i.from)}</b>: ${esc(i.idea)}<small>${esc(key === 'use' ? 'For Merlin\'s: ' + i.use : 'Why not: ' + i.why)}</small></div>`).join('');
}
function storyHtml() {
  const s = PLAN.story;
  if (!s) return '';
  return `<div class="story"><div class="sh">${esc(s.headline)}</div>${s.points.map((x) => `<div class="sp"><b>${esc(x.title)}:</b> ${esc(x.body)}</div>`).join('')}<div class="sp"><b>Cadence:</b> ${esc(PLAN.cadence || '')}</div></div>`;
}
function pillarsHtml() {
  return (PLAN.pillars || []).map((x) => `<div class="pitem"><span class="pill" style="background:${esc(x.color)}">${esc(x.name)}</span><br><b>Job:</b> ${esc(x.job)}<br><b>Comes from:</b> ${esc(x.from)}</div>`).join('');
}
function calHtml() {
  const ps = PLAN.proposals;
  if (!VIEW) {
    const first = ps.map((p) => ymd(p.date)).filter(Boolean).sort((a, b) => a.y - b.y || a.m - b.m || a.d - b.d)[0];
    const now = new Date();
    VIEW = first ? { y: first.y, m: first.m } : { y: now.getFullYear(), m: now.getMonth() };
  }
  const { y, m } = VIEW;
  const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const todayDmy = PLAN.today || '';
  const evs = (PLAN.calendarDates || []).map((e) => ({ ...e, p: ymd(e.date) })).filter((e) => e.p && e.p.y === y && e.p.m === m);
  let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="wd">${d}</div>`).join('');
  for (let i = 0; i < lead; i++) cells += '<div class="c off"></div>';
  for (let d = 1; d <= days; d++) {
    const dmy = `${String(d).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${y}`;
    const posts = ps.filter((p) => p.date === dmy).map((p) => { const pl = pillarOf(p.pillar); return `<a class="p ${esc(p.status)}" href="#post-${esc(p.id)}" style="background:${esc(pl.color)}" title="${esc(p.title)}">${esc(pl.short)}</a>`; }).join('');
    const ev = evs.filter((e) => e.p.d === d).map((e) => `<span class="ev">${esc(e.label.split(' (')[0])}</span>`).join('');
    cells += `<div class="c ${dmy === todayDmy ? 'today' : ''}"><span class="dn">${d}</span>${posts}${ev}</div>`;
  }
  const legend = (PLAN.pillars || []).map((x) => `<span><span class="pill" style="background:${esc(x.color)}">${esc(x.short)}</span>${esc(x.name)}</span>`).join('');
  const dates = evs.length ? `<p class="dates">${evs.map((e) => `<b>${esc(e.date.slice(0, 5))}</b> ${esc(e.label)}`).join('<br>')}</p>` : '';
  const counts = ps.filter((p) => { const q = ymd(p.date); return q && q.y === y && q.m === m; }).length;
  return `<div class="calnav"><button type="button" data-nav="-1" aria-label="Previous month">&lsaquo;</button><span class="m">${MONTHS[m]} ${y} <small class="when">${counts} posts, 5:00 PM</small></span><button type="button" data-nav="1" aria-label="Next month">&rsaquo;</button></div><div class="cal">${cells}</div><div class="legend">${legend}</div><div class="legend">Faded means to review, solid means approved, struck through means dismissed.</div>${dates}`;
}
function draw() {
  const ps = PLAN.proposals;
  const by = (s) => ps.filter((p) => p.status === s);
  const n = { review: by('proposed').length, ok: by('approved').length, no: by('dismissed').length, pub: by('published').length };
  $('top').innerHTML = `<div class="top">${n.review} to review, ${n.ok} approved to shoot, ${n.pub} published, ${n.no} dismissed. Plan prepared ${esc(PLAN.prepared)}.</div>`;
  $('story').innerHTML = storyHtml();
  $('pillars').innerHTML = pillarsHtml();
  $('cal').innerHTML = calHtml();
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
  const c = e.target.closest('button[data-copy]');
  if (!c) return;
  const p = PLAN.proposals.find((x) => x.id === c.dataset.copy);
  if (!p) return;
  const text = fullCaption(p);
  try { await navigator.clipboard.writeText(text); }
  catch (err) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (x) { /* nothing more to try */ } t.remove(); }
  const old = c.textContent; c.textContent = 'Copied'; setTimeout(() => { c.textContent = old; }, 1500);
});
document.addEventListener('click', (e) => {
  const n = e.target.closest('button[data-nav]');
  if (!n || !VIEW) return;
  const d = new Date(Date.UTC(VIEW.y, VIEW.m + Number(n.dataset.nav), 1));
  VIEW = { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  $('cal').innerHTML = calHtml();
});
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
