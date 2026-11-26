// The recipe (how to) for each batch dish, from the Recipe: Mein Hans Edition doc. No prices or costs here:
// those already show under "Ingredients used" on the Batch Cook page.
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let DOC = null;
let PASTA = null; // live pasta cost cards from /api/pasta

// Batch Cook dish names that differ a little from the doc's.
const key = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(beef|comfort|the)\b/g, '').replace(/[^a-z0-9]+/g, '');

const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/\*\*/g, '');
function body(lines) {
  let html = ''; let list = '';
  const close = () => { if (list) { html += `</${list}>`; list = ''; } };
  for (const raw of lines) {
    const l = raw.replace(/\\/g, '');
    const bullet = /^\s*[*-]\s+(.*)$/.exec(l);
    const step = /^\s*(\d+)\.\s*(.*)$/.exec(l);
    if (bullet) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(bullet[1])}</li>`; }
    else if (step) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(step[2])}</li>`; }
    else { close(); const t = l.trim(); html += /^\**\s*[IV]+\./.test(t) ? `<h3>${esc(t.replace(/\*/g, ''))}</h3>` : `<p>${inline(t)}</p>`; }
  }
  close(); return html;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// ISO timestamp -> "07/11/2026 11:40" in Bangkok time
function stamp(iso) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const b = new Date(d.getTime() + 7 * 3600e3); const p = (n) => String(n).padStart(2, '0');
  return `${p(b.getUTCDate())}/${p(b.getUTCMonth() + 1)}/${b.getUTCFullYear()} ${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`;
}
let CUR = 0;
// Download as a plain text file: one recipe, or every recipe (grouped by category).
const plain = (d) => `${d.title}\n${d.category}${d.saved ? ' · last edited ' + stamp(d.saved) : ''}\n\n${d.lines.map((l) => l.replace(/\\/g, '').replace(/\*\*/g, '')).join('\n')}\n`;
function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const fileSafe = (n) => String(n).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
// Same key the server files the version history under.
const skey = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

function drawChips() {
  const cats = DOC.categories || [];
  const groups = cats.map((c) => {
    const here = DOC.dishes.map((x, n) => [x, n]).filter(([x]) => x.category === c);
    return here.length ? `<optgroup label="${esc(c)}">${here.map(([x, n]) => `<option value="${n}"${n === CUR ? ' selected' : ''}>${esc(x.dish)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  $('chips').innerHTML = `<label class="fld" style="margin:0 0 6px">Recipe<select id="recipePick" style="width:100%;box-sizing:border-box;font:inherit;padding:10px;border-radius:10px">${groups}</select></label><button data-new="1" class="newbtn">+ New recipe</button> <button data-newpasta="1" class="newbtn">+ New pasta</button>`;
  $('recipePick').addEventListener('change', (e) => show(Number(e.target.value)));
}

const baht = (n) => `฿${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyTxt = (n) => String(Math.round(Number(n) * 100) / 100);
const dmy = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
const pastaOf = (dish) => PASTA && /^pasta\s*-/i.test(dish) ? PASTA.cards.find((c) => skey(c.card.name) === skey(String(dish).replace(/^pasta\s*-\s*/i, ''))) : null;

// Live cost card for a cooked to order pasta: the same lines as the Pasta tabs in Merlin's numbers, priced from today's price book.
function showPasta(d, pc) {
  const c = pc.card; const k = pc.cost;
  const rows = k.lines.map((l) => `<tr><td>${esc(l.label)}${l.guess ? ' <span class="tag guess">to confirm</span>' : ''}${l.legacy ? ' <span class="tag guess">set minutes</span>' : ''}${l.missing ? ' <span class="tag bad">no price yet</span>' : ''}<small>${l.source && l.priceDate ? `price from ${esc(l.source)}, ${esc(dmy(l.priceDate))}${l.stale ? ', old' : ''}${l.jump ? ', jumped' : ''}` : ''}</small></td><td class="r" data-q="${esc(l.field)}">${esc(qtyTxt(l.qty))} ${esc(l.unit)} <button class="linkbtn" data-line="${esc(l.field)}">Edit</button></td><td class="r">${baht(l.cost)}</td></tr>`).join('');
  const warn = [...(k.missing.length ? [`No price found for ${k.missing.join(', ')}. The cost is too low until a receipt or the Price Log has one.`] : []), ...(k.guesses.length ? [`${k.guesses.join(', ')} still to confirm. Edit and save them once you have measured.`] : [])];
  $('recipe').innerHTML = `<h2 style="margin:6px 0 2px">Pasta - ${esc(c.name)} (${baht(c.sell).replace('.00', '')}, cooked to order)</h2>
    <p class="upd">${pc.saved ? `Last edited ${esc(stamp(pc.saved))}${pc.versions > 1 ? ` (${pc.versions} saves)` : ''}` : 'Copied from the Merlin\'s numbers tab'} · prices update by themselves · <button class="linkbtn" id="pcEdit">Edit costs</button></p>
    ${warn.length ? `<div class="pwarn">${warn.map((w) => `<p>${esc(w)}</p>`).join('')}</div>` : ''}
    <div class="how"><h3>Cost per portion</h3><table class="ptab">${rows}<tr class="tot"><td>Total cost</td><td></td><td class="r">${baht(k.total)}</td></tr></table>
    <h3>Margin</h3><ul><li><b>Selling price:</b> ${baht(c.sell)}</li><li><b>Profit per portion:</b> ${baht(k.profit)}</li><li><b>Margin:</b> ${k.marginPct === null ? '' : Math.round(k.marginPct * 100) + '%'} of the price</li><li><b>Food cost:</b> ${k.foodPct === null ? '' : Math.round(k.foodPct * 100) + '%'} of the price</li></ul>
    <h3>How we cook it</h3><ul><li>${esc(qtyTxt(c.dryG))}g dry pasta cooks up to a <span data-q="cookedG">${esc(qtyTxt(c.cookedG))}g</span> portion${k.cookedGuess ? ' <span class="tag guess">to confirm</span>' : ''} <button class="linkbtn" data-line="cookedG">Edit</button></li><li>One ${esc(qtyTxt(c.boxG))}g box makes ${k.portionsPerBox === null ? '' : (Math.round(k.portionsPerBox * 10) / 10)} portions</li></ul></div>`;
  $('pcEdit').addEventListener('click', () => pastaForm(pc));
  // Edit one number and save just that one, like the Batch Cook costs. Saving confirms that number.
  $('recipe').querySelectorAll('[data-line]').forEach((b) => b.addEventListener('click', () => {
    const f = b.dataset.line; const cell = $('recipe').querySelector(`[data-q="${f}"]`);
    cell.innerHTML = `<input type="number" inputmode="decimal" step="any" min="0" value="${esc(c[f])}" style="width:84px;font:inherit;padding:6px;border:1px solid var(--line);border-radius:8px"> <button class="linkbtn" data-ok>Save</button> <button class="linkbtn" data-no>Cancel</button><span class="upd" data-m></span>`;
    cell.querySelector('[data-no]').addEventListener('click', () => showPasta(d, pc));
    cell.querySelector('[data-ok]').addEventListener('click', async () => {
      const m = cell.querySelector('[data-m]'); m.textContent = ' Saving…';
      try {
        const res = await fetch('/api/pasta/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...c, [f]: cell.querySelector('input').value, confirm: [f] }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'Not saved');
        PASTA = out; show(CUR);
      } catch (err) { m.textContent = ` Not saved: ${err.message}`; }
    });
  }));
}

const FIELD = (id, label, v, step = 'any') => `<label class="fld">${label}<input id="${id}" type="number" inputmode="decimal" step="${step}" min="0" value="${esc(v)}" /></label>`;
function pastaForm(pc) {
  const c = pc ? pc.card : { name: '', sell: 45, boxG: 500, dryG: 80, cookedG: 165, oilG: 1, butterG: 1, cookMin: 7, reheat: 0, reheatMin: 0, pack: 'Packaging Box (carb600ml)', packQty: 1, priceNames: [] };
  $('recipe').innerHTML = `<h2 style="margin:6px 0 6px">${pc ? 'Edit costs: Pasta - ' + esc(c.name) : 'New pasta'}</h2>
    <p class="upd">Quantities only. Prices come from your receipts and the Price Log, so a new butter, oil, box or pasta price changes the cost by itself. Every save is kept.</p>
    ${pc ? '' : '<label class="fld">Pasta name<input id="pcName" placeholder="for example Penne" /></label>'}
    ${FIELD('pcSell', 'Selling price (฿)', c.sell)}${FIELD('pcBox', 'Box or bag size (g)', c.boxG)}${FIELD('pcDry', 'Dry pasta per portion (g)', c.dryG)}${FIELD('pcCooked', 'Cooked portion (g)', c.cookedG)}
    ${FIELD('pcOil', 'Oil per portion (g)', c.oilG)}${FIELD('pcButter', 'Butter per portion (g)', c.butterG)}${FIELD('pcMin', 'Cooking time (minutes)', c.cookMin)}${FIELD('pcReheat', 'Reheating time (minutes, 0 if cooked fresh)', c.reheatMin === null || c.reheatMin === undefined ? '' : c.reheatMin)}
    <label class="fld">Packaging<input id="pcPack" value="${esc(c.pack)}" /></label>${FIELD('pcPackQty', 'Packaging count', c.packQty)}
    <label class="fld">Where the pasta price comes from (names in the Price Log or receipts, separated by commas, newest price wins)<input id="pcNames" value="${esc((c.priceNames || []).join(', '))}" /></label>
    <div class="btnrow"><button class="savebtn" id="pcSave">Save</button><button class="linkbtn" id="pcCancel">Cancel</button><span id="pcMsg" class="upd"></span></div>`;
  $('pcCancel').addEventListener('click', () => show(CUR));
  $('pcSave').addEventListener('click', async () => {
    const v = (id) => $(id).value;
    const name = pc ? c.name : v('pcName').trim();
    if (!name) { $('pcMsg').textContent = 'Give the pasta a name first.'; return; }
    $('pcSave').disabled = true; $('pcMsg').textContent = 'Saving…';
    try {
      const res = await fetch('/api/pasta/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, sell: v('pcSell'), boxG: v('pcBox'), dryG: v('pcDry'), cookedG: v('pcCooked'), oilG: v('pcOil'), butterG: v('pcButter'), cookMin: v('pcMin'), reheatMin: v('pcReheat'), pack: v('pcPack'), packQty: v('pcPackQty'), priceNames: v('pcNames'), unconfirmed: pc ? c.unconfirmed : [] }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Not saved');
      PASTA = out;
      const rr = await fetch('/api/recipes'); if (rr.ok) DOC = await rr.json();
      const at = DOC.dishes.findIndex((x) => key(x.dish) === key(`Pasta - ${name}`));
      show(at >= 0 ? at : CUR);
    } catch (err) { $('pcMsg').textContent = `Not saved: ${err.message}`; $('pcSave').disabled = false; }
  });
}

function show(i) {
  CUR = i;
  const d = DOC.dishes[i];
  drawChips();
  history.replaceState(null, '', `#${encodeURIComponent(d.dish)}`);
  const pc = pastaOf(d.dish);
  if (pc) return showPasta(d, pc);
  const edited = d.saved ? `Last edited ${esc(stamp(d.saved))}${d.versions > 1 ? ` (${d.versions} saves)` : ''}` : `Original recipe doc, updated ${esc(d.updated)}. Not edited here yet`;
  $('recipe').innerHTML = `<h2 style="margin:6px 0 2px">${esc(d.title)}</h2><p class="upd">${edited} · <button class="linkbtn" id="editBtn">Edit this recipe</button></p><div class="how">${body(d.lines)}</div><div id="editor"></div>`;
  $('editBtn').addEventListener('click', () => openEditor(d, false));
  const dl = document.createElement('button'); dl.className = 'linkbtn'; dl.textContent = 'Download this recipe'; dl.style.marginLeft = '10px';
  $('editBtn').after(dl); dl.addEventListener('click', () => download(`${fileSafe(d.dish)}.txt`, plain(d)));
}

function openEditor(d, isNew) {
  const hist = (DOC.history && DOC.history[skey(d.dish)]) || [];
  $('recipe').innerHTML = `<h2 style="margin:6px 0 6px">${isNew ? 'New recipe' : 'Edit ' + esc(d.dish)}</h2>
    <p class="upd">Change anything, down to a single letter. Lines starting with * are bullets, lines starting with 1. are steps, **double stars** are bold, and a line like **II. Method** is a heading. Every save is kept, so nothing is lost.</p>
    ${isNew ? `<label class="fld">Dish name (use the same name as in Kitchen Production)<input id="rName" value="" /></label>` : ''}
    <label class="fld">Category<select id="rCat">${(DOC.categories || []).map((c) => `<option ${c === d.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    <label class="fld">Title<input id="rTitle" value="${esc(d.title)}" /></label>
    <label class="fld">Recipe<textarea id="rText" spellcheck="true" style="min-height:340px">${esc(d.lines.join('\n'))}</textarea></label>
    <div class="btnrow"><button class="savebtn" id="rSave">Save recipe</button><button class="linkbtn" id="rCancel">Cancel</button><span id="rMsg" class="upd"></span></div>
    ${hist.length ? `<h3 style="font-size:15px;margin:18px 0 6px">Earlier versions</h3>${hist.map((v, n) => `<div class="ver"><span>${esc(stamp(v.saved))}${n === 0 ? ' (current)' : ''}</span><button class="linkbtn" data-ver="${n}">Load into the editor</button></div>`).join('')}` : ''}`;
  $('rCancel').addEventListener('click', () => (isNew ? show(CUR) : show(DOC.dishes.indexOf(d))));
  document.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => { const v = hist[Number(b.dataset.ver)]; $('rTitle').value = v.title; $('rText').value = v.text; $('rMsg').textContent = 'Loaded. Press Save recipe to keep it.'; }));
  $('rSave').addEventListener('click', async () => {
    const name = isNew ? $('rName').value.trim() : d.dish;
    if (!name) { $('rMsg').textContent = 'Give the recipe a name first.'; return; }
    $('rSave').disabled = true; $('rMsg').textContent = 'Saving…';
    try {
      const res = await fetch('/api/recipes/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dish: name, category: $('rCat').value, title: $('rTitle').value, text: $('rText').value }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Not saved');
      DOC = out; const at = DOC.dishes.findIndex((x) => key(x.dish) === key(name));
      show(at >= 0 ? at : 0);
    } catch (err) { $('rMsg').textContent = `Not saved: ${err.message}`; $('rSave').disabled = false; }
  });
}

(async function init() {
  try {
    const res = await fetch('/api/recipes');
    DOC = await res.json();
    if (!res.ok) throw new Error(DOC.error || 'Request failed');
    try { const pr = await fetch('/api/pasta'); if (pr.ok) PASTA = await pr.json(); } catch (err) { /* the old recipe text shows instead */ }
    $('chips').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.newpasta) return pastaForm(null);
      if (b.dataset.new) return openEditor({ dish: '', title: '', category: 'Stews', lines: ['**I. Ingredients**', '', '**II. Method**', ''] }, true);
      if (b.dataset.n !== undefined) show(Number(b.dataset.n));
    });
    const all = document.createElement('button'); all.className = 'linkbtn'; all.textContent = 'Download all recipes'; all.style.margin = '6px 0';
    $('status').after(all);
    const sync = document.createElement('button'); sync.className = 'linkbtn'; sync.textContent = 'Sync from the recipe doc'; sync.style.margin = '6px 0 6px 14px';
    const syncMsg = document.createElement('div'); syncMsg.className = 'status'; syncMsg.style.whiteSpace = 'pre-line';
    all.after(sync); sync.after(syncMsg);
    sync.addEventListener('click', async () => {
      sync.disabled = true; syncMsg.className = 'status'; syncMsg.textContent = 'Reading the doc…';
      try {
        const res = await fetch('/api/recipes/sync-doc', { method: 'POST' });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'Sync failed');
        const lines = out.results.filter((r) => !/^unchanged/.test(r.result)).map((r) => `${r.dish || r.title}: ${r.result}${r.why ? '. ' + r.why : ''}`);
        syncMsg.textContent = `Synced ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}. ${out.updated} updated, ${out.added} new, ${out.unchanged} already the same${out.kept ? `, ${out.kept} kept as you edited it` : ''}${out.errors ? `, ${out.errors} could not be read` : ''}.${lines.length ? '\n' + lines.join('\n') : ''}`;
        if (out.errors || out.kept) syncMsg.className = 'status err';
        const rr = await fetch('/api/recipes'); if (rr.ok) { DOC = await rr.json(); show(Math.min(CUR, DOC.dishes.length - 1)); }
      } catch (err) { syncMsg.className = 'status err'; syncMsg.textContent = `Not synced: ${err.message}`; }
      sync.disabled = false;
    });
    all.addEventListener('click', () => download('merlins-dish-recipes.txt', (DOC.categories || []).flatMap((c) => DOC.dishes.filter((x) => x.category === c)).map(plain).join('\n----------------------------------------\n\n')));
    $('status').textContent = `${DOC.edition}. ${DOC.note}${DOC.warning ? ' ' + DOC.warning : ''}`;
    const want = key(decodeURIComponent((location.hash || '').slice(1)));
    const at = DOC.dishes.findIndex((x) => key(x.dish) === want);
    show(at >= 0 ? at : 0);
  } catch (err) { $('status').className = 'status err'; $('status').textContent = `Could not load the recipes: ${err.message}`; }
})();
