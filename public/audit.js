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
      : a.type === 'customer'
        ? `<div class="fixrow"><label>Customer name<input type="text" data-val placeholder="as shown on the Grab order"></label><button type="button" class="primary" data-fix>Save name</button></div>`
        : a.type === 'gap'
          ? `<div class="chips">${['cook:Cook not logged', 'bought:Purchase not logged', 'wasted:Wasted', 'free:Given away', 'miscount:Earlier count wrong', 'lost:Lost'].map((x) => `<button type="button" class="rsn" data-gap="${x.split(':')[0]}">${x.split(':')[1]}</button>`).join('')}</div>`
          : a.type === 'close'
            ? `<div class="fixrow"><label>Why was the shop shut? (optional)<input type="text" data-val placeholder="for example rain, no riders"></label><button type="button" class="primary" data-closeday>Mark closed</button></div>`
            : a.type === 'meatcatch'
              ? `<div class="fixrow"><button type="button" class="primary" data-meat>Catch up meat now</button></div>`
              : a.type === 'drinkmap'
                ? `<div class="fixrow"><label>Which stock item is it?<select data-val>${(a.options || []).map((o) => `<option>${esc(o)}</option>`).join('')}</select></label><button type="button" class="primary" data-drink>Save</button></div>`
                : '';
  const go = !typed && f.fix ? `<a href="${esc(f.fix)}">${esc(f.fixLabel || 'Open')}</a>` : '';
  const how = f.how ? `<div class="how">${esc(f.how)}</div>` : '';
  const chips = (f.chips || []).length ? `<div class="chips">${f.chips.map((c) => `<a href="${esc(c.href)}">${esc(c.label)}</a>`).join('')}</div>` : '';
  const links = (f.links || []).map((l) => `<a href="${esc(l.href)}"${l.ext ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)}</a>`).join('');
  const items = (f.items || []).map((it, n) => {
    const ctl = it.kind === 'date' ? `<input type="text" inputmode="numeric" data-iv placeholder="DD/MM/YYYY"><button type="button" data-itm>Save date</button>`
      : it.kind === 'shop' ? `<input type="text" data-iv placeholder="Shop name"><button type="button" data-itm>Save shop</button>`
        : `<button type="button" class="del" data-itm>Delete this line</button>`;
    return `<div class="itm" data-n="${n}"><div class="t">${esc(it.text)}</div><div class="row2">${ctl}</div><div class="m" data-m></div></div>`;
  }).join('');
  const head = f.text ? `<p><b>${esc(f.title || '')}</b><br>${esc(f.text)}</p>` : `<p>${esc(f.line)}${f.baht >= 1 && !f.hideBaht ? ` <span class="at">${esc(baht(f.baht))}</span>` : ''}</p>`;
  return `<div class="find" data-id="${esc(f.id)}"><span class="tagc">${esc(f.check)}</span>${head}${how}${chips}${typed}${items}<div class="acts">${go}${links}<button type="button" data-ignore>Ignore</button></div><div class="fmsg" data-msg></div></div>`;
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
  const im = e.target.closest('[data-itm]');
  if (im) {
    const box = im.closest('.itm'); const card = im.closest('.find'); const f = FINDINGS.find((x) => x.id === card.dataset.id); const it = f.items[Number(box.dataset.n)];
    const m = box.querySelector('[data-m]'); const inp = box.querySelector('[data-iv]'); const val = inp ? inp.value.trim() : '';
    if (inp && !val) { m.textContent = it.kind === 'date' ? 'Type the date first.' : 'Type the shop first.'; return; }
    if (it.kind === 'delete' && !confirm(`Delete this line? ${it.text}`)) return;
    im.disabled = true; m.textContent = 'Saving…';
    try {
      if (it.kind === 'delete') await call('/api/receipts/item/delete', { ref: it.ref });
      else await call('/api/receipts/item/edit', { ref: it.ref, date: it.kind === 'date' ? val : it.row.date, item: it.row.item, qty: it.row.qty, price: it.row.price, shop: it.kind === 'shop' ? val : it.row.shop });
      draw(await call('/api/audit/run', {})); $('status').className = 'status'; $('status').textContent = it.kind === 'delete' ? 'Deleted that receipt line.' : 'Saved that receipt line.';
    } catch (err) { m.textContent = err.message; im.disabled = false; }
    return;
  }
  const gp = e.target.closest('[data-gap]');
  if (gp) {
    const card = gp.closest('.find'); const f = FINDINGS.find((x) => x.id === card.dataset.id); const msg = card.querySelector('[data-msg]');
    card.querySelectorAll('[data-gap]').forEach((b) => { b.disabled = true; }); msg.textContent = 'Saving…';
    try { const out = await call('/api/audit/gap', { at: f.action.at, item: f.action.item, reason: gp.dataset.gap }); draw(out.audit); $('status').className = 'status'; $('status').textContent = out.message; }
    catch (err) { msg.textContent = err.message; card.querySelectorAll('[data-gap]').forEach((b) => { b.disabled = false; }); }
    return;
  }
  const cd = e.target.closest('[data-closeday]');
  if (cd) {
    const card = cd.closest('.find'); const f = FINDINGS.find((x) => x.id === card.dataset.id); const why = card.querySelector('[data-val]').value.trim(); const msg = card.querySelector('[data-msg]');
    cd.disabled = true; msg.textContent = 'Saving…';
    try {
      for (const d of f.action.days) await call('/api/cook/note', { text: `close ${d.slice(0, 5)}${/\d{4}$/.test(d) ? '/' + d.slice(6) : ''} ${why}`.trim() });
      draw(await call('/api/audit/run', {})); $('status').className = 'status'; $('status').textContent = `Marked closed: ${f.action.days.map((d) => d.slice(0, 5)).join(', ')}.`;
    } catch (err) { msg.textContent = err.message; cd.disabled = false; }
    return;
  }
  const dk = e.target.closest('[data-drink]');
  if (dk) {
    const card = dk.closest('.find'); const f = FINDINGS.find((x) => x.id === card.dataset.id); const msg = card.querySelector('[data-msg]'); dk.disabled = true; msg.textContent = 'Saving…';
    try { const out = await call('/api/audit/drinkmap', { sale: f.action.sale, stock: card.querySelector('[data-val]').value }); draw(out.audit); $('status').className = 'status'; $('status').textContent = `Saved: ${f.action.sale} counts against that drink from now.`; }
    catch (err) { msg.textContent = err.message; dk.disabled = false; }
    return;
  }
  const mt = e.target.closest('[data-meat]');
  if (mt) {
    const msg = mt.closest('.find').querySelector('[data-msg]'); mt.disabled = true; msg.textContent = 'Taking the meat off the Stock card…';
    try { await call('/api/stock/meat-catch-up/apply', {}); draw(await call('/api/audit/run', {})); $('status').className = 'status'; $('status').textContent = 'Meat caught up.'; }
    catch (err) { msg.textContent = err.message; mt.disabled = false; }
    return;
  }
  const fx = e.target.closest('[data-fix]');
  if (fx) {
    const card = fx.closest('.find'); const f = FINDINGS.find((x) => x.id === card.dataset.id); const val = card.querySelector('[data-val]').value.trim(); const msg = card.querySelector('[data-msg]');
    if (!val) { msg.textContent = 'Type it in first.'; return; }
    fx.disabled = true; msg.textContent = 'Saving…';
    try {
      if (f.action.type === 'cost') draw(await call('/api/item-cost/save', { name: f.action.name, cost: val }).then((d) => d.audit));
      else if (f.action.type === 'customer') { const out = await call('/api/audit/customer', { keys: f.action.keys, name: val }); draw(out.audit); $('status').textContent = `Saved: customer ${out.name}.`; }
      else { const out = await call('/api/audit/split', { keys: f.action.keys, text: val }); draw(out.audit); $('status').textContent = [`Saved: ${out.items.join(', ')}.`, ...(out.notes || [])].join(' '); }
    } catch (err) { msg.textContent = err.message; fx.disabled = false; }
    return;
  }
  const b = e.target.closest('[data-ignore]'); if (!b) return;
  const id = b.closest('.find').dataset.id; b.disabled = true;
  try { draw(await call('/api/audit/ignore', { id })); } catch (err) { $('status').className = 'status err'; $('status').textContent = err.message; b.disabled = false; }
});
(async () => { try { draw(await call('/api/audit')); $('status').textContent = ''; } catch (err) { $('status').className = 'status err'; $('status').textContent = err.message; } })();
