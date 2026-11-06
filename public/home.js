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
      window.PigOffice($('office'), d.teams.map((t) => ({ name: t.name, open: [] })), (i) => {
        const el = document.getElementById(`team-${slug(d.teams[i].name)}`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500);
      });
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
