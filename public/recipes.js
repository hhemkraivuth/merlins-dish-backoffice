// The recipe (how to) for each batch dish, from the Recipe: Mein Hans Edition doc. No prices or costs here:
// those already show under "Ingredients used" on the Batch Cook page.
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let DOC = null;

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
  $('chips').innerHTML = cats.map((c) => {
    const here = DOC.dishes.map((x, n) => [x, n]).filter(([x]) => x.category === c);
    if (!here.length) return '';
    return `<div style="width:100%"><div class="catlabel">${esc(c)}</div><div class="chiprow">${here.map(([x, n]) => `<button data-n="${n}" class="${n === CUR ? 'on' : ''}">${esc(x.dish)}</button>`).join('')}</div></div>`;
  }).join('') + '<div style="width:100%"><button data-new="1" class="newbtn">+ New recipe</button></div>';
}

function show(i) {
  CUR = i;
  const d = DOC.dishes[i];
  drawChips();
  history.replaceState(null, '', `#${encodeURIComponent(d.dish)}`);
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
    $('chips').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.new) return openEditor({ dish: '', title: '', category: 'Stews', lines: ['**I. Ingredients**', '', '**II. Method**', ''] }, true);
      if (b.dataset.n !== undefined) show(Number(b.dataset.n));
    });
    const all = document.createElement('button'); all.className = 'linkbtn'; all.textContent = 'Download all recipes'; all.style.margin = '6px 0';
    $('status').after(all);
    all.addEventListener('click', () => download('merlins-dish-recipes.txt', (DOC.categories || []).flatMap((c) => DOC.dishes.filter((x) => x.category === c)).map(plain).join('\n----------------------------------------\n\n')));
    $('status').textContent = `${DOC.edition}. ${DOC.note}${DOC.warning ? ' ' + DOC.warning : ''}`;
    const want = key(decodeURIComponent((location.hash || '').slice(1)));
    const at = DOC.dishes.findIndex((x) => key(x.dish) === want);
    show(at >= 0 ? at : 0);
  } catch (err) { $('status').className = 'status err'; $('status').textContent = `Could not load the recipes: ${err.message}`; }
})();
