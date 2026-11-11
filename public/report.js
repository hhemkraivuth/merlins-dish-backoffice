const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
let LIST = []; let CURRENT = null;

function stampOf(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const bkk = new Date(d.getTime() + 7 * 3600e3);
  return `${pad(bkk.getUTCDate())}/${pad(bkk.getUTCMonth() + 1)}/${bkk.getUTCFullYear()} ${pad(bkk.getUTCHours())}:${pad(bkk.getUTCMinutes())} Bangkok`;
}

function tabs(slug) {
  $('tabs').innerHTML = LIST.map((r) => `<button type="button" data-slug="${MD.esc(r.slug)}" class="${r.slug === slug ? 'on' : ''}">${MD.esc(r.title)}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => open(b.dataset.slug)));
}

async function open(slug) {
  const s = $('status'); s.className = 'status'; s.textContent = 'Loading…';
  try {
    const res = await fetch(`/api/marketing/report/${encodeURIComponent(slug)}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    CURRENT = d;
    tabs(slug);
    $('doc').innerHTML = MD.render(d.markdown);
    $('stamp').textContent = d.updated ? `Posted ${stampOf(d.updated)}.` : '';
    document.title = `Merlin's Dish — ${d.title}`;
    history.replaceState(null, '', `report.html?doc=${encodeURIComponent(slug)}`);
    s.textContent = '';
  } catch (err) { s.className = 'status err'; s.textContent = err.message; }
}

// One file that opens in any browser, tables included, so it can be saved or sent on from the phone.
function download() {
  if (!CURRENT) return;
  const t = new Date(Date.now() + 7 * 3600e3);
  const dmy = `${pad(t.getUTCDate())}-${pad(t.getUTCMonth() + 1)}-${t.getUTCFullYear()}`;
  const css = 'body{font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;line-height:1.5;color:#1B2559}h2{font-size:24px}h3{font-size:20px;margin-top:24px}table{border-collapse:collapse;font-size:14px;margin:0 0 14px}th,td{border:1px solid #F3DCC8;padding:6px 9px;text-align:left;vertical-align:top}th{background:#FFF7EE}.tw{overflow-x:auto}a{color:#294BD4}code{background:#F3ECE4;padding:1px 5px;border-radius:4px}';
  const html = `<!DOCTYPE html><html lang="en-AU"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${MD.esc(CURRENT.title)}</title><style>${css}</style></head><body>${MD.render(CURRENT.markdown)}<p style="color:#6C6A7A;font-size:13px">Merlin's Dish, ${MD.esc(CURRENT.title)}, posted ${MD.esc(stampOf(CURRENT.updated))}.</p></body></html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  a.download = `merlins-dish-${CURRENT.slug}-${dmy}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  const s = $('status'); s.className = 'status'; s.textContent = `Downloaded ${a.download}.`;
}

async function load() {
  const s = $('status');
  try {
    const res = await fetch('/api/marketing/reports');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    LIST = d.reports || [];
    if (!LIST.length) { s.textContent = 'No full report has been posted yet. The Sunday check posts one each week.'; $('dl').style.display = 'none'; $('pr').style.display = 'none'; return; }
    const want = new URLSearchParams(location.search).get('doc');
    await open(LIST.some((r) => r.slug === want) ? want : LIST[0].slug);
  } catch (err) { s.className = 'status err'; s.textContent = err.message; }
}
$('dl').addEventListener('click', download);
$('pr').addEventListener('click', () => window.print());
load();
