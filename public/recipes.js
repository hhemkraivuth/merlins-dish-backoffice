const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baht = (n) => `฿${Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n) => Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 });
let current = '';

function lines(title, arr) {
  if (!arr.length) return '';
  const total = arr.reduce((s, l) => s + (l.qty || 0) * (l.unitCost || 0), 0);
  return `<h2 class="sec">${title}</h2><div class="tablewrap"><table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Cost</th></tr></thead><tbody>${arr.map((l) => `<tr>
    <td>${esc(l.name)}${l.note ? `<small>${esc(l.note)}</small>` : ''}</td><td class="r">${num(l.qty)} ${esc(l.unit)}</td>
    <td class="r">${l.unitCost != null ? `${baht(l.unitCost)}/${esc(l.unit || 'unit')}` : ''}${l.priceDate ? `<small>${esc(l.priceDate)}</small>` : ''}</td>
    <td class="r">${baht((l.qty || 0) * (l.unitCost || 0))}</td></tr>`).join('')}<tr><td colspan="3"><b>Total ${title.toLowerCase()}</b></td><td class="r"><b>${baht(total)}</b></td></tr></tbody></table></div>`;
}

async function show(dish) {
  current = dish; location.hash = encodeURIComponent(dish);
  [...$('chips').children].forEach((b) => b.classList.toggle('on', b.dataset.d === dish));
  $('status').className = 'status'; $('status').textContent = 'Loading the recipe…'; $('recipe').innerHTML = '';
  try {
    const res = await fetch(`/api/cook/recipe?dish=${encodeURIComponent(dish)}`);
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(r.error || `Request failed (${res.status})`);
    if (current !== dish) return;
    const sum = (a) => a.reduce((s, l) => s + (l.qty || 0) * (l.unitCost || 0), 0);
    const total = sum(r.ingredients) + sum(r.packaging) + sum(r.utility);
    const w = r.portionWeights || {};
    $('status').textContent = `Prices are the latest purchase on ${r.date}. The recipe itself comes from Merlin's numbers.`;
    $('recipe').innerHTML = `<h2 style="margin:6px 0">${esc(r.dish)}</h2><div class="facts">
      ${r.usualYield ? `<div><span>Usual yield</span><b>${r.usualYield}</b></div>` : ''}
      ${r.sellingPrice ? `<div><span>Selling price</span><b>${baht(r.sellingPrice)}</b></div>` : ''}
      ${w.Regular ? `<div><span>Regular portion</span><b>${w.Regular} g</b></div>` : ''}${w.Large ? `<div><span>Large portion</span><b>${w.Large} g</b></div>` : ''}
      <div><span>Batch cost at today's prices</span><b>${baht(total)}</b></div>
      ${r.usualYield ? `<div><span>Per portion</span><b>${baht(total / r.usualYield)}</b></div>` : ''}</div>`
      + lines('Ingredients', r.ingredients) + lines('Packaging', r.packaging) + lines('Utility', r.utility);
  } catch (err) { $('status').className = 'status err'; $('status').textContent = err.message; }
}

(async function init() {
  try {
    const res = await fetch('/api/cook/dishes');
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Request failed');
    $('chips').innerHTML = d.dishes.map((x) => `<button data-d="${esc(x.name)}">${esc(x.name)}</button>`).join('');
    $('chips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.d); });
    const want = decodeURIComponent((location.hash || '').slice(1));
    const first = d.dishes.find((x) => x.name === want) || d.dishes[0];
    if (first) show(first.name);
  } catch (err) { $('status').className = 'status err'; $('status').textContent = `Could not load dishes: ${err.message}`; }
})();
