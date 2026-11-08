const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Where each team's card leads. Top line only here, the detail lives on the team's own page.
const PAGE = { 'Grab sales': 'reports.html', 'Direct sales': 'reports.html', Operations: '/#batchcook', Purchasing: '/#receipts', Marketing: 'marketing.html' };

// One short line per team message: first sentence only, names shortened, year dropped.
const TEAM = (v) => esc(String(v).replace('App sales, Direct sales', 'Sales').replace('App sales', 'Grab sales'));
function short(m) {
  let t = String(m).split(/(?<=[.?!])\s/)[0].replace(/\/2026/g, '');
  if (t.length > 90) t = t.slice(0, 87).trimEnd() + '…';
  return t;
}
function chatter(h) {
  return `<p class="ho"><span class="who">${TEAM(h.from)} to ${TEAM(h.to)}</span>${esc(short(h.message))}</p>`;
}

function card(t) {
  const open = t.open || [];
  return `<section class="team" id="team-${slug(t.name)}">
    <a class="tlink" href="${PAGE[t.name] || '#'}">
      <span class="tname">${esc(t.name)}</span>
      <span class="top">${esc(t.top || '')}</span>
      <span class="line">${esc(t.line || '')}</span>
      ${t.note ? `<span class="note ${t.stale ? 'stale' : ''}">${esc(t.note)}</span>` : ''}
    </a>
    ${open.length ? `<details class="rest"><summary>Team chatter <span class="n">${open.length}</span></summary>${open.map(chatter).join('')}</details>` : ''}
  </section>`;
}

// "06/11/2026" -> "Friday 6 November 2026"
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(dmy) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dmy || ''));
  if (!m) return dmy || 'The Pit';
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return `${DAYS[d.getUTCDay()]} ${+m[1]} ${MONTHS[+m[2] - 1]} ${m[3]}`;
}

// The pit's look and decorations. Saved in the app, so every phone shows the same pit.
async function initDecor(pit, today) {
  const msg = $('pitMsg'), themeSel = $('pitTheme'), panel = $('pitPanel'), editBtn = $('pitEdit');
  const effective = (t) => (t === 'auto' ? window.PigOffice.autoLook(today) : { theme: t, bday: [] });
  let saved = { theme: 'auto', items: [] };
  const say = (t) => { msg.textContent = t || ''; };
  const post = async (body) => {
    const res = await fetch('/api/pit/layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Not saved (${res.status})`);
    return data;
  };
  try {
    const res = await fetch('/api/pit/layout');
    const data = await res.json().catch(() => ({}));
    if (res.ok) saved = data;
  } catch (err) { /* keep the default look */ }
  themeSel.innerHTML = [['auto', 'Automatic'], ['normal', 'Normal'], ...window.PigOffice.THEMES.map((t) => [t.id, t.label])].map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  themeSel.value = saved.theme;
  pit.setLook(effective(saved.theme)); pit.setItems(saved.items);

  const GROUPS = window.PigOffice.GROUPS;
  $('pitPalette').innerHTML = Object.keys(GROUPS).map((g) => `<details class="pgroup" data-g="${g}"><summary>${esc(GROUPS[g])}</summary><div class="pitems">${window.PigOffice.TYPES.filter((t) => t.group === g).map((t) => `<button class="pal" type="button" data-t="${t.id}">${window.PigOffice.preview(t.id)}<span>${esc(t.label)}</span></button>`).join('')}</div></details>`).join('');
  // One group open at a time, so the panel stays short.
  $('pitPalette').addEventListener('toggle', (e) => { if (e.target.open) document.querySelectorAll('#pitPalette details').forEach((d) => { if (d !== e.target) d.open = false; }); }, true);
  const marks = (state) => document.querySelectorAll('#pitPalette .pal').forEach((b) => b.classList.toggle('on', state.palette === b.dataset.t));
  pit.onChange((state) => { marks(state); $('pitRemove').disabled = state.selected === null; });
  $('pitPalette').addEventListener('click', (e) => {
    const b = e.target.closest('.pal'); if (!b) return;
    pit.setPalette(b.classList.contains('on') ? null : b.dataset.t);
  });

  const stop = () => { pit.setEditing(false); panel.hidden = true; themeSel.disabled = false; editBtn.textContent = 'Decorate'; };
  editBtn.addEventListener('click', () => {
    if (!panel.hidden) { pit.setItems(saved.items); stop(); say(''); return; }
    pit.setEditing(true); panel.hidden = false; themeSel.disabled = true; editBtn.textContent = 'Close'; say('');
    $('pitRemove').disabled = true;
  });
  $('pitCancel').addEventListener('click', () => { pit.setItems(saved.items); stop(); say('Changes dropped.'); });
  $('pitRemove').addEventListener('click', () => pit.removeSelected());
  $('pitClear').addEventListener('click', () => { if (confirm('Take every decoration you placed out of the pit?')) pit.clear(); });
  $('pitSave').addEventListener('click', async () => {
    try { saved = await post({ theme: saved.theme, items: pit.getItems() }); pit.setItems(saved.items); stop(); say('Saved.'); } catch (err) { say(err.message); }
  });
  themeSel.addEventListener('change', async () => {
    const theme = themeSel.value;
    pit.setLook(effective(theme));
    try { saved = await post({ theme, items: saved.items }); say('Saved.'); } catch (err) { say(err.message); themeSel.value = saved.theme; pit.setLook(effective(saved.theme)); }
  });
}

let officeDrawn = false;
async function load() {
  const s = $('status');
  s.className = 'status'; s.textContent = 'Loading…';
  try {
    const res = await fetch('/api/pit');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    $('today').textContent = longDate(d.today);
    $('teams').innerHTML = d.teams.map(card).join('');
    if (!officeDrawn && window.PigOffice) {
      officeDrawn = true;
      const pit = window.PigOffice($('office'), d.teams.map((t) => ({ name: t.name, open: [] })), (i) => {
        const el = document.getElementById(`team-${slug(d.teams[i].name)}`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500);
      });
      initDecor(pit, d.today);
    }
    s.textContent = '';
  } catch (err) { s.className = 'status err'; s.textContent = err.message; }
}

// Same full list as the Weekly Receipts page.
const loadShop = (refresh) => window.ShoppingPlan && window.ShoppingPlan.load($('shopPlan'), { compact: false, refresh });

// What is left, from the customer bot (read only), taken at 03:00 each day.
async function loadStock(refresh) {
  const box = $('stockLeft');
  try {
    const res = await fetch(`/api/stock-left${refresh ? '?refresh=1' : ''}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    const snap = d.snapshot;
    if (!snap) { box.innerHTML = `<p class="muted">${esc(d.note || 'No stock snapshot yet.')} Set BOT_URL on Railway to the customer bot address so BOH can read it.</p>`; return; }
    const when = new Date(snap.takenAt).toLocaleString('en-AU', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const rows = snap.items.length
      ? snap.items.map((i) => `<div class="stock-line"><span>${esc(i.name)}</span><b>${i.soldOut ? 'Sold out' : i.left}</b></div>`).join('')
      : '<p class="muted">The bot has no counts set. Use "setstock" or "left" in the bot group.</p>';
    box.innerHTML = `${rows}<p class="muted">As at ${esc(when)} Bangkok time.${d.note ? ' ' + esc(d.note) : ''}</p>`;
  } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
}
$('reload').addEventListener('click', () => { load(); loadShop(true); loadStock(true); });
load();
loadStock(false);
loadShop(false);
