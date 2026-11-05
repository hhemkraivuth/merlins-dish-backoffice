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

let officeDrawn = false;
async function load() {
  const s = $('status');
  s.className = 'status'; s.textContent = 'Loading…';
  try {
    const res = await fetch('/api/pit');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    $('today').textContent = d.today;
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

$('reload').addEventListener('click', load);
load();
