const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-');

function handoff(h) {
  return `<p class="ho"><span class="who">${esc(h.from)} to ${esc(h.to)}</span>${esc(h.message)}</p>`;
}

// Short on purpose: one headline, one line for the week, and a count. Everything else is one tap away.
function card(t) {
  const open = t.open || [];
  const details = (t.updates || []).slice(1);
  return `<section class="team" id="team-${slug(t.name)}">
    <div class="teamtop"><h3>${esc(t.name)}</h3><span class="when">${esc(t.when || 'No data yet')}</span></div>
    <p class="latest">${esc(t.headline || (t.updates || [])[0] || '')}</p>
    ${t.sub ? `<p class="sub">${esc(t.sub)}</p>` : ''}
    ${open.length ? `<details class="rest"><summary><span class="n">${open.length}</span> waiting</summary>${open.map(handoff).join('')}</details>` : '<p class="clear">Nothing waiting</p>'}
    ${details.length ? `<details class="rest"><summary>More</summary><ul class="more">${details.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></details>` : ''}
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
    $('today').textContent = `Today, ${d.today}`;
    $('openTotal').textContent = d.openTotal ? `${d.openTotal} handoff${d.openTotal === 1 ? '' : 's'} waiting` : 'Nothing waiting';
    $('teams').innerHTML = d.teams.map(card).join('');
    if (!officeDrawn && window.PigOffice) {
      officeDrawn = true;
      window.PigOffice($('office'), d.teams, (i) => {
        const el = document.getElementById(`team-${slug(d.teams[i].name)}`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500);
      });
    } else if (window.PigOffice) {
      d.teams.forEach((t, i) => { const n = document.querySelectorAll('#office .plate')[i]; if (n) { const c = (t.open || []).length; n.innerHTML = `${esc(t.name)}${c ? `<span class="n">${c}</span>` : ''}`; } });
    }
    s.textContent = '';
  } catch (err) { s.className = 'status err'; s.textContent = err.message; }
}

$('reload').addEventListener('click', load);
load();
