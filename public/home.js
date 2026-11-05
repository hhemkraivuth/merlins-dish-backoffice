const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SHOW = 3; // handoffs shown before "show the rest"

function handoff(h) {
  return `<p class="ho"><span class="who">${esc(h.from)} to ${esc(h.to)}${h.raised ? `, raised ${esc(h.raised)}` : ''}</span>${esc(h.message)}</p>`;
}

function card(t) {
  const [first, ...rest] = t.updates;
  const head = `${esc(t.name)}`;
  const asof = t.asOf ? `Data to ${esc(t.asOf)}` : 'No data yet';
  const open = t.open || [];
  const shown = open.slice(0, SHOW).map(handoff).join('');
  const more = open.length > SHOW ? `<details class="rest"><summary>Show the other ${open.length - SHOW}</summary>${open.slice(SHOW).map(handoff).join('')}</details>` : '';
  return `<section class="team">
    <h3>${head}</h3>
    <div class="asof">${asof}</div>
    <p class="latest">${esc(first)}</p>
    ${rest.length ? `<ul class="more">${rest.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : ''}
    <div class="open-head">Open handoffs <span class="n ${open.length ? '' : 'zero'}">${open.length}</span></div>
    ${open.length ? shown + more : '<p class="none">Nothing waiting on this team.</p>'}
  </section>`;
}

async function load() {
  const s = $('status');
  s.className = 'status'; s.textContent = 'Loading…';
  try {
    const res = await fetch('/api/pit');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    $('today').textContent = `Today, ${d.today}`;
    $('openTotal').textContent = d.openTotal ? `${d.openTotal} open handoff${d.openTotal === 1 ? '' : 's'} across the teams` : 'No open handoffs';
    $('teams').innerHTML = d.teams.map(card).join('');
    s.textContent = '';
  } catch (err) { s.className = 'status err'; s.textContent = err.message; }
}

$('reload').addEventListener('click', load);
load();
