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

function show(i) {
  const d = DOC.dishes[i];
  [...$('chips').children].forEach((b, n) => b.classList.toggle('on', n === i));
  history.replaceState(null, '', `#${encodeURIComponent(d.dish)}`);
  $('recipe').innerHTML = `<h2 style="margin:6px 0 2px">${esc(d.title)}</h2><p class="upd">Updated ${esc(d.updated)}</p><div class="how">${body(d.lines)}</div>`;
}

(async function init() {
  try {
    const res = await fetch('/api/recipes');
    DOC = await res.json();
    if (!res.ok) throw new Error(DOC.error || 'Request failed');
    $('chips').innerHTML = DOC.dishes.map((x, n) => `<button data-n="${n}">${esc(x.dish)}</button>`).join('');
    $('chips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(Number(b.dataset.n)); });
    $('status').textContent = `${DOC.edition}. ${DOC.note}`;
    const want = key(decodeURIComponent((location.hash || '').slice(1)));
    const at = DOC.dishes.findIndex((x) => key(x.dish) === want);
    show(at >= 0 ? at : 0);
  } catch (err) { $('status').className = 'status err'; $('status').textContent = `Could not load the recipes: ${err.message}`; }
})();
