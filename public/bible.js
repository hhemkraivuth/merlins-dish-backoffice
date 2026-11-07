// Menu bible: every item's names and descriptions in one place. Pick an item, edit any field, save, add, delete, download.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const FIELDS = [
    ['th', 'Thai description (order app)'], ['en', 'English description (order app)'],
    ['grabName', 'Grab name'], ['grabDesc', 'Grab description (Thai)'], ['translation', 'Grab description, English translation'],
  ];
  let DOC = null; let CUR = '';
  const root = $('bible'); if (!root) return;
  const stamp = (iso) => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; const b = new Date(d.getTime() + 7 * 3600e3); const p = (n) => String(n).padStart(2, '0'); return `${p(b.getUTCDate())}/${p(b.getUTCMonth() + 1)}/${b.getUTCFullYear()} ${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`; };
  const toast = (m, bad) => { const s = $('bibleMsg'); if (s) { s.textContent = m; s.style.color = bad ? '#b3261e' : '#1f6a34'; } };

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
    return out;
  }
  function plain(it) {
    return [it.name, it.category, ...FIELDS.filter(([k]) => it[k]).map(([k, l]) => `${l}:\n${it[k]}`)].join('\n') + '\n';
  }
  function download(name, text) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const fileSafe = (n) => String(n).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'item';

  function draw(isNew) {
    const items = DOC.items;
    const it = isNew ? { name: '', category: DOC.categories[0] || 'Other', th: '', en: '', grabName: '', grabDesc: '', translation: '', saved: '', versions: 0 } : (items.find((x) => x.name === CUR) || items[0]);
    if (!isNew && it) CUR = it.name;
    const opts = DOC.categories.map((c) => { const here = items.filter((x) => x.category === c); return here.length ? `<optgroup label="${esc(c)}">${here.map((x) => `<option value="${esc(x.name)}"${!isNew && x.name === CUR ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>` : ''; }).join('');
    root.innerHTML = `<div class="ix"><h3>Menu bible</h3>
      <p class="sub">Every item's name and description in one place: the Thai and English text for the order app, and the Grab name, description and translation. Pick an item, change anything down to a letter, then save. Every save keeps the date. ${DOC.warning ? esc(DOC.warning) : ''}</p>
      <label class="fld">Item<select id="bPick" style="width:100%;box-sizing:border-box;font:inherit;padding:10px;border-radius:10px">${opts}</select></label>
      <div class="row" style="margin:6px 0"><button class="small-button" id="bNew">+ Add an item</button><button class="small-button" id="bAll">Download everything</button>${isNew || !it ? '' : '<button class="small-button" id="bOne">Download this item</button>'}</div>
      <div id="bForm" style="background:#f7f5ef;border-radius:10px;padding:10px;margin:6px 0">
        <h4 style="margin:0 0 6px">${isNew ? 'New item' : esc(it ? it.name : '')}</h4>
        ${isNew ? '<label class="fld">Name<input id="bName" style="width:100%;box-sizing:border-box" /></label>' : ''}
        <label class="fld">Category<select id="bCat">${DOC.categories.map((c) => `<option${c === it.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        ${FIELDS.map(([k, l]) => `<label class="fld" style="display:block;margin-top:6px">${esc(l)}<textarea data-f="${k}" rows="3" spellcheck="true" style="width:100%;box-sizing:border-box">${esc(it[k])}</textarea></label>`).join('')}
        <p class="sub" style="margin:6px 0">${it.saved ? `Last edited ${esc(stamp(it.saved))}${it.versions > 1 ? ` (${it.versions} saves)` : ''}` : isNew ? '' : 'Starting text from the Menu Names doc. Not edited here yet.'}</p>
        <div class="row"><button class="primary-button" id="bSave">Save</button>${isNew ? '<button class="small-button" id="bCancel">Cancel</button>' : '<button class="small-button" id="bDel">Delete this item</button>'}<span id="bibleMsg" class="sub"></span></div>
      </div></div>`;
    $('bPick').addEventListener('change', (e) => { CUR = e.target.value; draw(false); });
    $('bNew').addEventListener('click', () => draw(true));
    $('bAll').addEventListener('click', () => download('merlins-dish-menu-bible.txt', DOC.categories.flatMap((c) => items.filter((x) => x.category === c)).map(plain).join('\n----------------------------------------\n\n')));
    if ($('bOne')) $('bOne').addEventListener('click', () => download(`${fileSafe(it.name)}.txt`, plain(it)));
    if ($('bCancel')) $('bCancel').addEventListener('click', () => draw(false));
    const collect = () => { const f = {}; root.querySelectorAll('[data-f]').forEach((t) => { f[t.dataset.f] = t.value; }); return f; };
    $('bSave').addEventListener('click', async () => {
      const name = isNew ? $('bName').value.trim() : it.name;
      if (!name) return toast('Give the item a name first.', true);
      $('bSave').disabled = true; toast('Saving…');
      try { DOC = await post('/api/menu-bible/save', { name, category: $('bCat').value, fields: collect() }); CUR = name; draw(false); toast('Saved.'); } catch (err) { toast(`Not saved: ${err.message}`, true); $('bSave').disabled = false; }
    });
    if ($('bDel')) $('bDel').addEventListener('click', async () => {
      if (!confirm(`Delete ${it.name} from the menu bible? It disappears from this list. It does not change the order app menu.`)) return;
      try { DOC = await post('/api/menu-bible/delete', { name: it.name }); CUR = ''; draw(false); toast('Deleted.'); } catch (err) { toast(`Not deleted: ${err.message}`, true); }
    });
  }
  (async function init() {
    try { const res = await fetch('/api/menu-bible'); DOC = await res.json(); if (!res.ok) throw new Error(DOC.error || 'Request failed'); draw(false); }
    catch (err) { root.innerHTML = `<div class="ix"><h3>Menu bible</h3><p class="sub" style="color:#b3261e">Could not load: ${esc(err.message)}</p></div>`; }
  })();
})();
