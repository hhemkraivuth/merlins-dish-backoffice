const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baht = (n) => `฿${Math.round(n || 0).toLocaleString('en-AU')}`;
function when(iso) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const b = new Date(d.getTime() + 7 * 3600e3); const p = (n) => String(n).padStart(2, '0');
  return `${p(b.getUTCDate())}/${p(b.getUTCMonth() + 1)}/${b.getUTCFullYear()} ${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`;
}
function draw(v) {
  $('light').innerHTML = `<span class="dot ${v.light}"></span><div><b>${esc(v.text)}</b><span>${v.baht >= 1 ? esc(baht(v.baht)) + ' at risk. ' : ''}${v.ranAt ? 'Last checked ' + esc(when(v.ranAt)) + '.' : 'Not checked yet. Press Check now.'}${v.ignored ? ' ' + v.ignored + ' ignored.' : ''}</span></div>`;
  $('list').innerHTML = v.findings.length ? v.findings.map((f) => `<div class="find" data-id="${esc(f.id)}"><span class="tagc">${esc(f.check)}</span><p>${esc(f.line)}${f.baht >= 1 ? ` <span class="at">${esc(baht(f.baht))}</span>` : ''}</p><div class="acts"><a href="${esc(f.fix || 'home.html')}">Fix it</a><button type="button" data-ignore>Ignore</button></div></div>`).join('') : `<div class="clear">${v.never ? '' : 'Nothing to review. The books look right.'}</div>`;
}
async function call(url, body) {
  const res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
  return d;
}
$('run').addEventListener('click', async () => {
  $('run').disabled = true; $('status').className = 'status'; $('status').textContent = 'Checking the books…';
  try { draw(await call('/api/audit/run', {})); $('status').textContent = ''; } catch (err) { $('status').className = 'status err'; $('status').textContent = err.message; }
  $('run').disabled = false;
});
$('list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ignore]'); if (!b) return;
  const id = b.closest('.find').dataset.id; b.disabled = true;
  try { draw(await call('/api/audit/ignore', { id })); } catch (err) { $('status').className = 'status err'; $('status').textContent = err.message; b.disabled = false; }
});
(async () => { try { draw(await call('/api/audit')); $('status').textContent = ''; } catch (err) { $('status').className = 'status err'; $('status').textContent = err.message; } })();
