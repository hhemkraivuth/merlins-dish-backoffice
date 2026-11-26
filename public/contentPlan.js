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
const h12 = (t) => { const [h, m] = String(t || '17:00').split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const TIMES = []; for (let h = 7; h <= 21; h++) for (const m of ['00', '30']) TIMES.push(`${String(h).padStart(2, '0')}:${m}`);
function dateOptions(current) {
  const t = ymd(PLAN.today) || { y: new Date().getFullYear(), m: new Date().getMonth(), d: new Date().getDate() };
  const out = [];
  for (let i = 0; i < 28; i++) {
    const x = new Date(Date.UTC(t.y, t.m, t.d + i));
    out.push(`${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`);
  }
  if (current && !out.includes(current)) out.unshift(current);
  return out;
}
function thumb(p, big) {
  const m = (p.media || [])[0];
  const cls = big ? 'thumb' : 'thumb sm';
  if (!m) return `<div class="${cls} none"><span>No file yet</span></div>`;
  return `<div class="${cls}"><img src="/api/content-plan/media/${esc(m.id)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('none');this.replaceWith(document.createTextNode('${m.kind === 'video' ? 'Video' : 'Photo'}: ' + this.parentNode.dataset.name))" />${m.kind === 'video' ? '<em>Video</em>' : ''}${(p.media || []).length > 1 ? `<em class="n">+${p.media.length - 1}</em>` : ''}</div>`.replace('<div class="' + cls + '">', `<div class="${cls}" data-name="${esc(m.name)}">`);
}
const STATUS_CHIP = { proposed: ['To review', 'warn'], approved: ['Approved', 'dark'], published: ['Published', 'ok'], dismissed: ['Dismissed', 'grey'] };
function card(p) {
  const pl = pillarOf(p.pillar);
  const id = esc(p.id);
  const locked = p.status === 'published' || p.status === 'dismissed';
  const [chipText, chipCls] = p.queueStatus === 'failed' ? ['Failed to post', 'bad'] : STATUS_CHIP[p.status] || STATUS_CHIP.proposed;
  const dsel = `<select data-sched="date" data-pid="${id}" aria-label="Date" ${locked ? 'disabled' : ''}>${dateOptions(p.date).map((d) => `<option value="${esc(d)}" ${d === p.date ? 'selected' : ''}>${esc(dayLabel(d))}</option>`).join('')}</select>`;
  const tsel = `<select data-sched="time" data-pid="${id}" aria-label="Time" ${locked ? 'disabled' : ''}>${(TIMES.includes(p.time) ? TIMES : [p.time, ...TIMES]).map((t) => `<option value="${t}" ${t === p.time ? 'selected' : ''}>${h12(t)}</option>`).join('')}</select>`;
  const btns = p.status === 'approved'
    ? `<button class="no" data-id="${id}" data-s="proposed">Undo approval</button>`
    : p.status === 'dismissed'
      ? `<button class="no" data-id="${id}" data-s="proposed">Bring back</button>`
      : p.status === 'published' ? '' : `<button class="yes" data-id="${id}" data-s="approved">Approve and publish</button><button class="no" data-id="${id}" data-s="dismissed">Dismiss</button>`;
  const line = p.status === 'approved' ? `<div class="when">Posts ${esc(dayLabel(p.date))} at ${esc(h12(p.time))}, Instagram then Facebook</div>`
    : p.status === 'published' ? `<div class="when">Posted ${esc(dayLabel(p.date))} at ${esc(h12(p.time))}${p.igUrl ? ` · <a href="${esc(p.igUrl)}" target="_blank" rel="noopener">Instagram</a>` : ''}${p.fbUrl ? ` · <a href="${esc(p.fbUrl)}" target="_blank" rel="noopener">Facebook</a>` : ''}</div>` : '';
  const warn = p.queueStatus === 'failed' ? `<div class="warn">Did not post: ${esc(p.queueNote || 'see the Content Queue tab')}. Undo approval and approve again to retry.</div>`
    : (p.status === 'approved' && !(p.media || []).length) ? '<div class="warn">No file linked yet. Claude links it from your Raw shoots folder before it posts.</div>' : '';
  const capBlock = p.status === 'published' ? `<div class="cap"><div class="foot" style="margin:0;color:inherit">${esc(p.caption)}</div></div>` : `<div class="cap"><div class="caph"><b>Caption${p.edited ? ' (edited)' : ''}</b><button type="button" class="mini" data-copy="${id}">Copy all</button></div>
        <textarea class="capin" data-cap="${id}" rows="4" aria-label="Caption, editable">${esc(p.caption)}</textarea>
        <div class="capact" hidden><button type="button" class="mini main" data-save="${id}">Save edit</button><button type="button" class="mini" data-undo="${id}">Cancel</button></div>
        <div class="foot">${esc(PLAN.footer || '')}</div>
        ${p.edited ? `<button type="button" class="mini link" data-reset="${id}">Reset to original caption</button>` : ''}
      </div>`;
  return `<div class="card post ${esc(p.status)}" id="post-${id}">
    <div class="prow">${thumb(p, true)}
      <div class="pmain">
        <div class="meta"><span class="pill sm" style="background:${esc(pl.color)}">${esc(p.pillar)}</span><span class="chip st ${chipCls}">${esc(chipText)}</span></div>
        <div class="name">${esc(p.title)}</div>
        ${locked ? line || `<div class="when">${esc(dayLabel(p.date))}, ${esc(h12(p.time))}</div>` : `<div class="sched"><label>Date${dsel}</label><label>Time${tsel}</label></div>${line}`}
      </div>
    </div>
    ${warn}
    ${capBlock}
    ${btns ? `<div class="btns">${btns}</div>` : ''}
    ${p.status === 'approved' ? `<button type="button" class="mini link" data-id="${id}" data-s="published">Mark published by hand</button>` : ''}
    <details class="sub"><summary>Details</summary><div class="more">
      <p><b>Why:</b> ${esc(p.why)}</p>
      <p><b>Hook:</b> ${esc(p.hook)}</p>
      <p><b>Files and visual direction:</b> ${(p.media || []).length ? esc((p.media || []).map((m) => m.name || m.id).join(', ')) + '. ' : ''}${esc(p.visual)}</p>
      <p><b>${esc(pl.name)}:</b> ${esc(pl.job)}</p>
      <p><b>Borrowed from:</b> ${esc(p.borrow)}</p>
      <p><b>Avoiding:</b> ${esc(p.avoid)}</p>
      <p><b>Audience:</b> ${esc(p.audience)}</p>
    </div></details>
  </div>`;
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
let BRIEF_OPEN = false;
let DRAFT = { text: '', date: '', channels: ['Instagram and Facebook'] };
function briefHtml() {
  const list = (PLAN.briefs || []).slice().reverse();
  const items = list.map((b) => `<div class="bl"><span class="tag ${b.done ? 'done' : ''}">${b.done ? 'Done' : 'Waiting for Claude'}</span> ${esc(b.text)}<div class="meta">${esc([b.date, (b.channels || []).join(', ')].filter(Boolean).join(' · '))}${b.done && (b.posts || []).length ? ` · see ${b.posts.map((id) => `<a href="#post-${esc(id)}">${esc(id)}</a>`).join(', ')}` : ''}<button type="button" data-brief-rm="${esc(b.id)}">Remove</button></div></div>`).join('');
  const waiting = (PLAN.briefs || []).filter((b) => !b.done).length;
  return `<details class="briefbox" id="briefDetails" ${BRIEF_OPEN ? 'open' : ''}><summary><b>Brief for Claude</b>${waiting ? ` <span class="tag">${waiting} waiting</span>` : ''}</summary><p class="hint">A few words is enough: what is happening, which dish or drink, when it goes live. Claude writes the captions and shot designs. Posts go to Instagram and Facebook, and LINE broadcasts for big news.</p><textarea id="briefText" placeholder="e.g. New dessert goes live Thu, IG and Facebook">${esc(DRAFT.text)}</textarea><div class="row"><input type="text" id="briefDate" inputmode="numeric" placeholder="Go live date DD/MM/YYYY (optional)" value="${esc(DRAFT.date)}" /></div><div class="row">${CHANNELS.map((c) => `<label class="chip"><input type="checkbox" data-bch="${esc(c)}" ${DRAFT.channels.includes(c) ? 'checked' : ''} />${esc(c)}</label>`).join('')}</div><button type="button" class="send" data-brief-send>Send brief</button>${items}</details>`;
}
const dmyNum = (d) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(d || '')); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null; };
// Approved and published always show. A post still waiting for review shows only while its day has not passed. Dismissed ones are hidden.
function visible(p) {
  if (p.status === 'approved' || p.status === 'published') return true;
  if (p.status !== 'proposed') return false;
  const t = dmyNum(PLAN.today); const d = dmyNum(p.date);
  return t === null || d === null || d >= t;
}
// The review runs on the hour from 10:00 to 23:00 Bangkok (UTC+7). Shows the next of those hours.
function nextSync() {
  const h = new Date(Date.now() + 7 * 3600e3).getUTCHours();
  const next = h < 10 ? 10 : (h >= 23 ? 10 : h + 1);
  return `${String(next).padStart(2, '0')}:00${h >= 23 ? ' tomorrow' : ''}`;
}
function draw() {
  const ps = PLAN.proposals.filter(visible);
  const by = (s) => ps.filter((p) => p.status === s);
  const n = { review: by('proposed').length, ok: by('approved').length, pub: by('published').length };
  $('top').innerHTML = `<div class="top">${n.ok} approved, ${n.pub} published, ${n.review} to review. Last new posts added ${esc(PLAN.prepared)}. Next sync about ${nextSync()}.</div>`;
  if (!document.activeElement || !document.activeElement.closest || !document.activeElement.closest('.briefbox')) $('brief').innerHTML = briefHtml();
  $('story').innerHTML = storyHtml();
  $('pillars').innerHTML = pillarsHtml();
  $('cal').innerHTML = calHtml();
  $('footer').innerHTML = footerHtml();
  $('shoot').innerHTML = by('approved').map(card).join('') || '<p class="empty">Nothing approved yet.</p>';
  $('review').innerHTML = by('proposed').map(card).join('') || '<p class="empty">Everything has been decided.</p>';
  const pub = by('published');
  $('pubd').innerHTML = pub.length ? `<div class="stack">${pub.map(card).join('')}</div>` : '<p class="empty">Nothing published yet.</p>';
  document.querySelectorAll('.card.post textarea.capin').forEach(grow);
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
  if (el) { if (el.tagName === 'DETAILS') el.open = true; el.scrollIntoView({ block: 'start' }); }
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
// After she saves an edit, a grammar check suggests fixes. Nothing changes until she taps Use suggestion.
const SUG = {};
async function checkGrammar(id, text) {
  const box = (cls, html) => { const cap = document.querySelector(`#post-${id} .cap`); if (!cap) return; const old = cap.querySelector('.sugg'); if (old) old.remove(); const d = document.createElement('div'); d.className = `sugg ${cls}`; d.dataset.sugFor = id; d.innerHTML = html; cap.appendChild(d); };
  box('', '<b>Checking grammar…</b>');
  try {
    const res = await fetch('/api/content-plan/caption-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, caption: text }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Check failed');
    if (!d.changed) return box('ok', '<b>Grammar check</b>No changes needed. Your edit is saved.');
    SUG[id] = d.suggestion;
    box('', `<b>Suggested wording (your edit is saved)</b><div class="st">${esc(d.suggestion)}</div>${(d.notes || []).length ? `<ul>${d.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}<div class="acts"><button type="button" class="mini main" data-usesug="${id}">Use suggestion</button><button type="button" class="mini" data-keepsug="${id}">Keep mine</button></div>`);
  } catch (err) { box('err', `<b>Grammar check</b>Not available right now (${esc(err.message)}). Your edit is saved as you wrote it.`); }
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-usesug],button[data-keepsug]');
  if (!b) return;
  const id = b.dataset.usesug || b.dataset.keepsug;
  if (b.dataset.keepsug) { const box = b.closest('.sugg'); if (box) box.remove(); return; }
  try { b.disabled = true; await saveCaption(id, SUG[id] || ''); } catch (err) { b.disabled = false; const st = $('status'); st.className = 'status err'; st.textContent = `Not saved: ${err.message}`; }
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
    const mine = b.dataset.reset ? '' : document.querySelector(`textarea[data-cap="${id}"]`).value;
    await saveCaption(id, mine);
    if (b.dataset.save) checkGrammar(id, mine.trim());
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
document.addEventListener('toggle', (e) => { if (e.target.id === 'briefDetails') BRIEF_OPEN = e.target.open; }, true);
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
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-sched]');
  if (!sel) return;
  const id = sel.dataset.pid;
  const date = document.querySelector(`select[data-sched="date"][data-pid="${id}"]`).value;
  const time = document.querySelector(`select[data-sched="time"][data-pid="${id}"]`).value;
  document.querySelectorAll(`select[data-pid="${id}"]`).forEach((x) => { x.disabled = true; });
  try {
    const res = await fetch('/api/content-plan/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, date, time }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Not saved');
    await load();
  } catch (err) { document.querySelectorAll(`select[data-pid="${id}"]`).forEach((x) => { x.disabled = false; }); const st = $('status'); st.className = 'status err'; st.textContent = `Not saved: ${err.message}`; }
});
load();
