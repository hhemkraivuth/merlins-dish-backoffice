const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baht = (n) => `฿${Math.round(n || 0).toLocaleString('en-AU')}`;
function when(iso) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const b = new Date(d.getTime() + 7 * 3600e3); const p = (n) => String(n).padStart(2, '0');
  return `${p(b.getUTCDate())}/${p(b.getUTCMonth() + 1)}/${b.getUTCFullYear()} ${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`;
}
let FINDINGS = [];
function draw(v) {
  FINDINGS = v.findings;
  $('light').innerHTML = `<span class="dot ${v.light}"></span><div><b>${esc(v.text)}</b><span>${v.baht >= 1 ? esc(baht(v.baht)) + ' at risk. ' : ''}${v.ranAt ? 'Last checked ' + esc(when(v.ranAt)) + '.' : 'Not checked yet. Press Check now.'}${v.ignored ? ' ' + v.ignored + ' ignored.' : ''}</span></div>`;
  $('list').innerHTML = v.findings.length ? v.findings.map(find).join('') : `<div class="clear">${v.never ? '' : 'Nothing to review. The books look right.'}</div>`;
}
// One finding: what it is, the money, and where or how to fix it, right on the card when possible.
function find(f) {
  const a = f.action || {};
  const typed = a.type === 'cost'
    ? `<div class="fixrow"><label>Cost per portion (฿)<input type="number" inputmode="decimal" min="0" step="any" data-val placeholder="for example 25.50"></label><button type="button" class="primary" data-fix>Save cost</button></div>`
    : a.type === 'split'
      ? `<div class="fixrow"><label>What was in the order?<input type="text" data-val value="${esc(a.text || '')}" placeholder="${esc(a.hint || 'Dark Beer Stew + Tubetti')}"></label><button type="button" class="primary" data-fix>Save items</button></div>`
      : '';
  const go = !typed && f.fix ? `<a href="${esc(f.fix)}">${esc(f.fixLabel || 'Open')}</a>` : '';
  return `<div class="find" data-id="${esc(f.id)}"><span class="tagc">${esc(f.check)}</span><p>${esc(f.line)}${f.baht >= 1 ? ` <span class="at">${esc(baht(f.baht))}</span>` : ''}</p>${typed}<div class="acts">${go}<button type="button" data-ignore>Ignore</button></div><div class="fmsg" data-msg></div></div>`;
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
  const fx = e.target.closest('[data-fix]');
  if (fx) {
    const card = fx.closest('.find'); const f = FINDINGS.find((x) => x.id === card.dataset.id); const val = card.querySelector('[data-val]').value.trim(); const msg = card.querySelector('[data-msg]');
    if (!val) { msg.textContent = 'Type it in first.'; return; }
    fx.disabled = true; msg.textContent = 'Saving…';
    try {
      if (f.action.type === 'cost') draw(await call('/api/item-cost/save', { name: f.action.name, cost: val }).then((d) => d.audit));
      else { const out = await call('/api/audit/split', { keys: f.action.keys, text: val }); draw(out.audit); $('status').textContent = [`Saved: ${out.items.join(', ')}.`, ...(out.notes || [])].join(' '); }
    } catch (err) { msg.textContent = err.message; fx.disabled = false; }
    return;
  }
  const b = e.target.closest('[data-ignore]'); if (!b) return;
  const id = b.closest('.find').dataset.id; b.disabled = true;
  try { draw(await call('/api/audit/ignore', { id })); } catch (err) { $('status').className = 'status err'; $('status').textContent = err.message; b.disabled = false; }
});
(async () => { try { draw(await call('/api/audit')); $('status').textContent = ''; } catch (err) { $('status').className = 'status err'; $('status').textContent = err.message; } })();
