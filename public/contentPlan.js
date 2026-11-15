const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let PLAN = null;
let VIEW = null;
const COLLAPSED = new Set(); // posts Lily has chosen to hide; every other post starts open // the month shown, as { y, m } with m from 0
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pillarOf = (name) => (PLAN.pillars || []).find((x) => x.name === name) || { name, short: name, color: '#3F4663', job: '', from: '' };
const ymd = (dmy) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy || ''); return m ? { d: +m[1], m: +m[2] - 1, y: +m[3] } : null; };

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (dmy) => { const q = ymd(dmy); return q ? `${WD[new Date(Date.UTC(q.y, q.m, q.d)).getUTCDay()]} ${dmy.slice(0, 5)}` : dmy; };
const fullCaption = (caption) => `${String(caption || '').trim()}\n\n${PLAN.footer || ''}`.trim();
function detail(p) {
  return `<details class="sub"><summary>Shot and sources</summary><div class="more">
    <b>Visual</b><p>${esc(p.visual)}</p>
    <b>Borrowed from</b><p>${esc(p.borrow)}</p>
    <b>Avoiding</b><p>${esc(p.avoid)}</p>
    <b>Audience</b><p>${esc(p.audience)}</p>
  </div></details>`;
}
function card(p) {
  const pl = pillarOf(p.pillar);
  const id = esc(p.id);
  const btns = p.status === 'approved'
    ? `<button class="done" data-id="${id}" data-s="published">Mark published</button><button class="no" data-id="${id}" data-s="proposed">Undo</button>`
    : p.status === 'dismissed'
      ? `<button class="no" data-id="${id}" data-s="proposed">Bring back</button>`
      : `<button class="yes" data-id="${id}" data-s="approved">Approve</button><button class="no" data-id="${id}" data-s="dismissed">Dismiss</button>`;
  const tick = p.status === 'approved' ? '<span class="ok">Approved</span>' : '';
  return `<details class="card post ${esc(p.status)}" id="post-${id}"${COLLAPSED.has(p.id) ? '' : ' open'}><summary class="ph"><span class="pd">${esc(dayLabel(p.date))}</span><span class="pill sm" style="background:${esc(pl.color)}">${esc(pl.short)}</span><span class="pt">${esc(p.title)}</span>${tick}<span class="chev" aria-hidden="true">&rsaquo;</span></summary>
    <div class="pb">
      <div class="meta"><span class="pill" style="background:${esc(pl.color)}">${esc(p.pillar)}</span><span class="chip">${esc(p.format)}</span><span class="chip">5:00 PM</span></div>
      <div class="hook"><b>Hook:</b> ${esc(p.hook)}</div>
      <div class="cap"><div class="caph"><b>Caption${p.edited ? ' (edited)' : ''}</b><button type="button" class="mini" data-copy="${id}">Copy all</button></div>
        <textarea class="capin" data-cap="${id}" rows="4" aria-label="Caption, editable">${esc(p.caption)}</textarea>
        <div class="capact" hidden><button type="button" class="mini main" data-save="${id}">Save edit</button><button type="button" class="mini" data-undo="${id}">Cancel</button></div>
        <div class="foot">${esc(PLAN.footer || '')}</div>
        ${p.edited ? `<button type="button" class="mini link" data-reset="${id}">Reset to original caption</button>` : ''}
      </div>
      <div class="why"><b>Why:</b> ${esc(p.why)}</div>
      <div class="pdef"><b>${esc(pl.name)}:</b> ${esc(pl.job)}</div>
      ${detail(p)}
      <div class="btns">${btns}</div>
    </div></details>`;
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
  const lead = new Date(Date.UTC(y, m, 1)).getUTCDay(); // Sunday first
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const todayDmy = PLAN.today || '';
  const evs = (PLAN.calendarDates || []).map((e) => ({ ...e, p: ymd(e.date) })).filter((e) => e.p && e.p.y === y && e.p.m === m);
  let cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="wd">${d}</div>`).join('');
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
function footerHtml() {
  return `<div class="footbox"><div class="caph"><b>Footer on every post</b><button type="button" class="mini" data-footedit>Edit footer</button></div><div class="foot" id="footView">${esc(PLAN.footer || '')}</div></div>`;
}
const CHANNELS = ['Instagram and Facebook', 'LINE broadcast'];
let DRAFT = { text: '', date: '', channels: ['Instagram and Facebook'] };
function briefHtml() {
  const list = (PLAN.briefs || []).slice().reverse();
  const items = list.map((b) => `<div class="bl"><span class="tag ${b.done ? 'done' : ''}">${b.done ? 'Done' : 'Waiting for Claude'}</span> ${esc(b.text)}<div class="meta">${esc([b.date, (b.channels || []).join(', ')].filter(Boolean).join(' · '))}${b.done && (b.posts || []).length ? ` · see ${b.posts.map((id) => `<a href="#post-${esc(id)}">${esc(id)}</a>`).join(', ')}` : ''}<button type="button" data-brief-rm="${esc(b.id)}">Remove</button></div></div>`).join('');
  return `<div class="briefbox"><h3>Brief for Claude</h3><p class="hint">A few words is enough: what is happening, which dish or drink, when it goes live. Claude writes the captions and shot designs. Posts go to Instagram and Facebook, and LINE broadcasts for big news.</p><textarea id="briefText" placeholder="e.g. New dessert goes live Thu, order web and IG only">${esc(DRAFT.text)}</textarea><div class="row"><input type="text" id="briefDate" inputmode="numeric" placeholder="Go live date DD/MM/YYYY (optional)" value="${esc(DRAFT.date)}" /></div><div class="row">${CHANNELS.map((c) => `<label class="chip"><input type="checkbox" data-bch="${esc(c)}" ${DRAFT.channels.includes(c) ? 'checked' : ''} />${esc(c)}</label>`).join('')}</div><button type="button" class="send" data-brief-send>Send brief</button>${items}</div>`;
}
function draw() {
  const ps = PLAN.proposals;
  const by = (s) => ps.filter((p) => p.status === s);
  const n = { review: by('proposed').length, ok: by('approved').length, no: by('dismissed').length, pub: by('published').length };
  $('top').innerHTML = `<div class="top">${n.review} to review, ${n.ok} approved to shoot, ${n.pub} published, ${n.no} dismissed. Plan prepared ${esc(PLAN.prepared)}.</div>`;
  if (!document.activeElement || !document.activeElement.closest || !document.activeElement.closest('.briefbox')) $('brief').innerHTML = briefHtml();
  $('story').innerHTML = storyHtml();
  $('pillars').innerHTML = pillarsHtml();
  $('cal').innerHTML = calHtml();
  $('footer').innerHTML = footerHtml();
  $('shoot').innerHTML = by('approved').map(card).join('') || '<p class="empty">Nothing approved yet.</p>';
  $('review').innerHTML = by('proposed').map(card).join('') || '<p class="empty">Everything has been decided.</p>';
  const pub = by('published');
  $('gone').innerHTML = `<div class="stack">${by('dismissed').map(card).join('') + pub.map((p) => `<div class="card"><div class="when">Published, ${esc(p.date)}</div><div class="name">${esc(p.title)}</div></div>`).join('')}</div>` || '<p class="empty">None.</p>';
  document.querySelectorAll('details.post[open] textarea.capin').forEach(grow);
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
    PLAN = d; draw(); st.textContent = ''; openFromHash();
  } catch (err) { st.className = 'status err'; st.textContent = err.message; }
}
const grow = (t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };
const postOf = (id) => PLAN.proposals.find((x) => x.id === id);
function openFromHash() {
  const el = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  if (el && el.tagName === 'DETAILS') { el.open = true; el.scrollIntoView({ block: 'start' }); }
}
window.addEventListener('hashchange', openFromHash);
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d.classList || !d.classList.contains('post')) return;
  const pid = d.id.replace(/^post-/, '');
  if (d.open) { COLLAPSED.delete(pid); d.querySelectorAll('textarea.capin').forEach(grow); } else COLLAPSED.add(pid);
}, true);
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-footedit],button[data-footsave],button[data-footcancel],button[data-footreset]');
  if (!b) return;
  if (b.dataset.footedit !== undefined) {
    $('footer').innerHTML = `<div class="footbox"><div class="caph"><b>Footer on every post</b></div><textarea class="capin" id="footIn" rows="4" aria-label="Footer, editable">${esc(PLAN.footer || '')}</textarea><div class="capact"><button type="button" class="mini main" data-footsave>Save footer</button><button type="button" class="mini" data-footcancel>Cancel</button><button type="button" class="mini link" data-footreset>Standard footer</button></div></div>`;
    grow($('footIn')); return;
  }
  if (b.dataset.footcancel !== undefined) { $('footer').innerHTML = footerHtml(); return; }
  try {
    b.disabled = true;
    const text = b.dataset.footreset !== undefined ? '' : $('footIn').value;
    const res = await fetch('/api/content-plan/footer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ footer: text }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Not saved');
    await load();
  } catch (err) { b.disabled = false; const st = $('status'); st.className = 'status err'; st.textContent = `Not saved: ${err.message}`; }
});
document.addEventListener('input', (e) => {
  const t = e.target.closest('textarea.capin');
  if (!t) return;
  grow(t);
  const p = postOf(t.dataset.cap);
  t.closest('.cap').querySelector('.capact').hidden = !p || t.value.trim() === String(p.caption).trim();
});
document.addEventListener('click', async (e) => {
  const c = e.target.closest('button[data-copy]');
  if (!c) return;
  const t = document.querySelector(`textarea[data-cap="${c.dataset.copy}"]`);
  if (!t) return;
  const text = fullCaption(t.value);
  try { await navigator.clipboard.writeText(text); }
  catch (err) { const x = document.createElement('textarea'); x.value = text; document.body.appendChild(x); x.select(); try { document.execCommand('copy'); } catch (z) { /* nothing more to try */ } x.remove(); }
  const old = c.textContent; c.textContent = 'Copied'; setTimeout(() => { c.textContent = old; }, 1500);
});
async function saveCaption(id, caption) {
  const res = await fetch('/api/content-plan/caption', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, caption }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'Not saved');
  await load();
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-save],button[data-undo],button[data-reset]');
  if (!b) return;
  const id = b.dataset.save || b.dataset.undo || b.dataset.reset;
  try {
    if (b.dataset.undo) { const t = document.querySelector(`textarea[data-cap="${id}"]`); t.value = postOf(id).caption; grow(t); t.closest('.cap').querySelector('.capact').hidden = true; return; }
    b.disabled = true;
    await saveCaption(id, b.dataset.reset ? '' : document.querySelector(`textarea[data-cap="${id}"]`).value);
  } catch (err) { b.disabled = false; const st = $('status'); st.className = 'status err'; st.textContent = `Not saved: ${err.message}`; }
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
document.addEventListener('input', (e) => {
  if (e.target.id === 'briefText') DRAFT.text = e.target.value;
  if (e.target.id === 'briefDate') DRAFT.date = e.target.value;
  if (e.target.dataset && e.target.dataset.bch) DRAFT.channels = [...document.querySelectorAll('[data-bch]')].filter((x) => x.checked).map((x) => x.dataset.bch);
});
async function briefCall(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'Not saved');
}
document.addEventListener('click', async (e) => {
  const send = e.target.closest('button[data-brief-send]');
  const rm = e.target.closest('button[data-brief-rm]');
  if (!send && !rm) return;
  const el = send || rm; el.disabled = true;
  try {
    if (send) { await briefCall('/api/content-plan/brief', DRAFT); DRAFT = { text: '', date: '', channels: DRAFT.channels }; }
    else await briefCall('/api/content-plan/brief/update', { id: rm.dataset.briefRm, remove: true });
    $('status').textContent = ''; $('status').className = 'status';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    await load();
  } catch (err) { el.disabled = false; const st = $('status'); st.className = 'status err'; st.textContent = `Not saved: ${err.message}`; }
});
load();
