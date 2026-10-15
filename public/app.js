const main = document.getElementById('main');
const tabBar = document.getElementById('tabBar');

const PANELS = { orders: renderOrders, receipts: renderReceipts, batchcook: renderBatchCook, stock: renderStock };

tabBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-button');
  if (!btn) return;
  document.querySelectorAll('.tab-button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  PANELS[btn.dataset.tab]();
});

// ---- Shared helpers ----

function el(html) {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstChild;
}

function renderResultCard(container, data, { itemKey = 'orderId', writtenLabel = 'rowsWritten' } = {}) {
  const flaggedCount = data.flagged || 0;
  const card = el(`
    <div class="result-card">
      <div class="result-headline">
        ${data.processed} processed
        ${flaggedCount > 0 ? `<span class="flag-count"> · ${flaggedCount} flagged</span>` : ''}
      </div>
    </div>
  `);
  (data.results || []).forEach((r) => {
    const idLabel = r[itemKey] || r.file || 'unknown';
    const writtenVal = r[writtenLabel] != null ? `${r[writtenLabel]} rows written` : '';
    const row = el(`
      <div class="order-row">
        <div class="order-row-top">
          <span class="order-id">${escapeHtml(idLabel)}</span>
          <span class="rows-written">${escapeHtml(writtenVal)}</span>
        </div>
      </div>
    `);
    if (r.error) {
      row.appendChild(el(`<div class="error-item">${escapeHtml(r.error)}</div>`));
    }
    if (r.flags && r.flags.length) {
      const ul = el('<ul class="flag-list"></ul>');
      r.flags.forEach((f) => ul.appendChild(el(`<li class="flag-item">${escapeHtml(f)}</li>`)));
      row.appendChild(ul);
    }
    card.appendChild(row);
  });
  container.appendChild(card);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---- Mode 1: Daily Orders ----

function renderOrders() {
  main.innerHTML = '';
  const section = el(`
    <section class="section">
      <div class="intro">
        <h1 class="intro-title">Daily Orders</h1>
        <p class="intro-body">Drop in every Grab screenshot for the day — detail and payment shots mixed together is fine. The app reads each order's Order ID, pairs the screens itself, and writes rows straight to the Claude Log.</p>
      </div>
      <label class="upload-box">
        <input type="file" id="orderFiles" accept="image/*" multiple style="display:none" />
        <span class="upload-icon">+</span>
        <span class="upload-label" id="orderFilesLabel">Select screenshots</span>
      </label>
      <button class="primary-button" id="orderSubmit" disabled>Select screenshots first</button>
      <div id="orderResult"></div>
    </section>
  `);
  main.appendChild(section);

  const input = section.querySelector('#orderFiles');
  const label = section.querySelector('#orderFilesLabel');
  const submitBtn = section.querySelector('#orderSubmit');
  const resultDiv = section.querySelector('#orderResult');

  input.addEventListener('change', () => {
    const n = input.files.length;
    label.textContent = n ? `${n} screenshot${n === 1 ? '' : 's'} selected` : 'Select screenshots';
    submitBtn.disabled = n === 0;
    submitBtn.textContent = n ? `Process ${n} screenshot${n === 1 ? '' : 's'}` : 'Select screenshots first';
    resultDiv.innerHTML = '';
  });

  submitBtn.addEventListener('click', async () => {
    if (!input.files.length) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing batch…';
    resultDiv.innerHTML = '';
    try {
      const formData = new FormData();
      Array.from(input.files).forEach((f) => formData.append('screenshots', f));
      const res = await fetch('/api/orders/batch', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      renderResultCard(resultDiv, data, { itemKey: 'orderId', writtenLabel: 'rowsWritten' });
    } catch (err) {
      resultDiv.appendChild(el(`<div class="result-card"><div class="error-item">${escapeHtml(err.message)}</div></div>`));
    } finally {
      submitBtn.disabled = false;
      const n = input.files.length;
      submitBtn.textContent = `Process ${n} screenshot${n === 1 ? '' : 's'}`;
    }
  });
}

// ---- Mode 2: Weekly Receipts ----

function renderReceipts() {
  main.innerHTML = '';
  const section = el(`
    <section class="section">
      <div class="intro">
        <h1 class="intro-title">Weekly Receipts</h1>
        <p class="intro-body">Drop in this week's shopping receipt photos. Items get logged into a new Expense Log tab — kept separate from your live Price Log, so nothing here can touch the real file. Review it, then copy across whenever you're ready.</p>
      </div>
      <label class="upload-box">
        <input type="file" id="receiptFiles" accept="image/*" multiple style="display:none" />
        <span class="upload-icon">+</span>
        <span class="upload-label" id="receiptFilesLabel">Select receipt photos</span>
      </label>
      <button class="primary-button" id="receiptSubmit" disabled>Select receipts first</button>
      <div id="receiptResult"></div>
    </section>
  `);
  main.appendChild(section);

  const input = section.querySelector('#receiptFiles');
  const label = section.querySelector('#receiptFilesLabel');
  const submitBtn = section.querySelector('#receiptSubmit');
  const resultDiv = section.querySelector('#receiptResult');

  input.addEventListener('change', () => {
    const n = input.files.length;
    label.textContent = n ? `${n} receipt${n === 1 ? '' : 's'} selected` : 'Select receipt photos';
    submitBtn.disabled = n === 0;
    submitBtn.textContent = n ? `Process ${n} receipt${n === 1 ? '' : 's'}` : 'Select receipts first';
    resultDiv.innerHTML = '';
  });

  submitBtn.addEventListener('click', async () => {
    if (!input.files.length) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Reading receipts…';
    resultDiv.innerHTML = '';
    try {
      const formData = new FormData();
      Array.from(input.files).forEach((f) => formData.append('receipts', f));
      const res = await fetch('/api/receipts/batch', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      renderResultCard(resultDiv, data, { itemKey: 'file', writtenLabel: 'itemsLogged' });
    } catch (err) {
      resultDiv.appendChild(el(`<div class="result-card"><div class="error-item">${escapeHtml(err.message)}</div></div>`));
    } finally {
      submitBtn.disabled = false;
      const n = input.files.length;
      submitBtn.textContent = `Process ${n} receipt${n === 1 ? '' : 's'}`;
    }
  });
}

// ---- Mode 3: Batch Cook (editable, same costing and Cook Log as the LINE group) ----

const baht = (n) => '฿' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayBangkokDMY = () => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  return p; // DD/MM/YYYY
};

async function renderBatchCook() {
  main.innerHTML = '<div class="loading">Loading dishes…</div>';

  let dishes = [];
  try {
    const res = await fetch('/api/cook/dishes');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    dishes = data.dishes || [];
  } catch (err) {
    main.innerHTML = `<div class="result-card"><div class="error-item">Could not load dishes: ${escapeHtml(err.message)}</div></div>`;
    return;
  }

  main.innerHTML = '';
  const section = el(`
    <section class="section">
      <div class="intro">
        <h1 class="intro-title">Batch Cook</h1>
        <p class="intro-body">Pick the dish and date. Ingredients fill in from the recipe in Merlin's numbers. Change any quantity that was different today, and leave the rest. Prices are the latest purchase on or before the cook date. This does the same job as a cook note in the LINE group.</p>
      </div>
      <label class="label">Dish</label>
      <select class="select" id="dishSelect">${dishes.map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join('')}</select>
      <label class="label">Date cooked (DD/MM/YYYY)</label>
      <input class="input" id="cookDate" value="${todayBangkokDMY()}" />
      <div id="templateArea"></div>
    </section>
  `);
  main.appendChild(section);

  const dishSelect = section.querySelector('#dishSelect');
  const dateInput = section.querySelector('#cookDate');
  const area = section.querySelector('#templateArea');

  async function load() {
    area.innerHTML = '<div class="loading">Loading recipe…</div>';
    try {
      const res = await fetch(`/api/cook/recipe?dish=${encodeURIComponent(dishSelect.value)}&date=${encodeURIComponent(dateInput.value)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      renderCookForm(area, data, dateInput);
    } catch (err) {
      area.innerHTML = `<div class="result-card"><div class="error-item">${escapeHtml(err.message)}</div></div>`;
    }
  }
  dishSelect.addEventListener('change', load);
  dateInput.addEventListener('change', load);
  if (dishes.length) load();
  else area.innerHTML = '<div class="empty-state">No dishes found.</div>';
}

function renderCookForm(container, recipe, dateInput) {
  // Each row: { type, name, unit, unitCost, priceDate, original, input }
  const rows = [];
  const row = (l, type) => ({ type, name: l.name, unit: l.unit || '', unitCost: l.unitCost, priceDate: l.priceDate, note: l.note, original: l.qty, extra: false });
  recipe.ingredients.forEach((l) => rows.push(row(l, 'Ingredient')));
  recipe.packaging.forEach((l) => rows.push(row(l, 'Packaging')));
  recipe.utility.forEach((l) => rows.push(row(l, 'Utility')));

  container.innerHTML = `
    <div class="subheading">Ingredients</div>
    <div class="recipe-table" id="ingRows"></div>
    <datalist id="catalogueList">${Object.keys(recipe.catalogue).map((n) => `<option value="${escapeHtml(n)}"></option>`).join('')}</datalist>
    <div class="size-row">
      <input class="input" id="extraName" list="catalogueList" placeholder="Add an ingredient not in the recipe" />
      <input class="size-input" id="extraQty" type="number" placeholder="g" />
      <button class="stock-count-button" id="extraAdd" type="button">Add</button>
    </div>
    <div class="subheading">Packaging and utilities</div>
    <div class="recipe-table" id="otherRows"></div>
    <label class="label">Servings yielded</label>
    <input class="input" type="number" id="yieldInput" placeholder="${recipe.sized ? 'fills from the packed counts below' : 'e.g. 21'}" />
    ${recipe.sized ? `
      <div class="subheading">Pack-out (Regular and Large)</div>
      <div class="size-row"><span class="size-name">Regular: weight (g)</span><input class="size-input" type="number" id="regWeight" /></div>
      <div class="size-row"><span class="size-name">Regular: count packed</span><input class="size-input" type="number" id="regCount" /></div>
      <div class="size-row"><span class="size-name">Large: weight (g)</span><input class="size-input" type="number" id="lgWeight" /></div>
      <div class="size-row"><span class="size-name">Large: count packed</span><input class="size-input" type="number" id="lgCount" /></div>
      <label class="label">Total cooked weight (g, optional)</label>
      <input class="input" type="number" id="cookedWeight" placeholder="blank = total of what was packed" />` : ''}
    <div class="cost-preview"><span>Ingredients</span><strong id="tIng"></strong></div>
    <div class="cost-preview"><span>Packaging</span><strong id="tPkg"></strong></div>
    <div class="cost-preview"><span>Utilities</span><strong id="tUtl"></strong></div>
    <div class="cost-preview"><span>Batch cost</span><strong id="tTotal"></strong></div>
    <div class="cost-preview"><span>Per portion</span><strong id="tPer">add servings yielded</strong></div>
    <div id="tSizes"></div>
    <button class="primary-button" id="logBatch">Log this batch</button>
    <div id="batchResult"></div>
  `;

  const $ = (id) => container.querySelector('#' + id);
  const ingBox = $('ingRows');
  const otherBox = $('otherRows');
  const yieldInput = $('yieldInput');

  function drawRows() {
    ingBox.innerHTML = '';
    otherBox.innerHTML = '';
    rows.forEach((r, idx) => {
      const unitLabel = r.type === 'Ingredient' ? (r.unit || 'g') : r.unit;
      const priceTxt = r.unitCost != null ? `${baht(r.unitCost)}/${escapeHtml(r.unit || 'unit')}${r.priceDate ? ' · ' + r.priceDate : ''}${r.note ? ' · ' + escapeHtml(r.note) : ''}` : 'no price';
      const node = el(`
        <div class="recipe-row" data-idx="${idx}">
          <span class="recipe-name">${escapeHtml(r.name)}${r.extra ? ' <em>(added)</em>' : ''}</span>
          <input class="size-input qty" type="number" step="any" value="${r.qty !== undefined ? r.qty : r.original}"${r.type === 'Utility' ? ' disabled title="Set by the recipe tab and the servings yielded"' : ''} />
          <span class="recipe-qty">${escapeHtml(unitLabel)}</span>
          <span class="recipe-price">${priceTxt}</span>
          <span class="recipe-qty line-cost"></span>
        </div>`);
      const inp = node.querySelector('.qty');
      inp.addEventListener('input', () => { r.qty = inp.value === '' ? '' : Number(inp.value); r.edited = true; refresh(); });
      (r.type === 'Ingredient' ? ingBox : otherBox).appendChild(node);
    });
    refresh();
  }

  function yieldN() {
    const y = Number(yieldInput.value);
    if (y > 0) return y;
    if (recipe.sized) return sizeList().reduce((a, z) => a + z.count, 0) || 0;
    return 0;
  }
  function sizeList() {
    if (!recipe.sized) return [];
    const out = [];
    const reg = { name: 'Regular', weight: Number($('regWeight').value), count: Number($('regCount').value) };
    const lg = { name: 'Large', weight: Number($('lgWeight').value), count: Number($('lgCount').value) };
    [reg, lg].forEach((z) => { if (z.weight > 0 && z.count > 0) out.push(z); });
    return out;
  }

  // Packaging and reheating follow the yield until you type your own number
  function qtyOf(r) {
    if (r.edited) return Number(r.qty) || 0;
    if (r.type === 'Packaging' && !recipe.sized && yieldN() > 0) return yieldN();
    if (r.type === 'Utility' && /reheat/i.test(r.name) && yieldN() > 0) return yieldN();
    return r.qty !== undefined ? Number(r.qty) : r.original;
  }

  function refresh() {
    let ing = 0, pkg = 0, utl = 0;
    rows.forEach((r, idx) => {
      const q = qtyOf(r);
      const cost = q * (r.unitCost || 0);
      if (r.type === 'Ingredient') ing += cost; else if (r.type === 'Packaging') pkg += cost; else utl += cost;
      const node = container.querySelector(`.recipe-row[data-idx="${idx}"]`);
      if (!node) return;
      node.querySelector('.line-cost').textContent = baht(cost);
      node.classList.toggle('changed', r.edited && q !== r.original);
      const inp = node.querySelector('.qty');
      if (!r.edited && document.activeElement !== inp) inp.value = q;
    });
    const total = ing + pkg + utl;
    $('tIng').textContent = baht(ing); $('tPkg').textContent = baht(pkg); $('tUtl').textContent = baht(utl); $('tTotal').textContent = baht(total);
    const y = yieldN();
    $('tPer').textContent = y > 0 ? baht(total / y) : 'add servings yielded';
    const sz = sizeList();
    if (recipe.sized) {
      const packed = sz.reduce((a, z) => a + z.count * z.weight, 0);
      const cooked = Number($('cookedWeight').value) > 0 ? Number($('cookedWeight').value) : packed;
      $('tSizes').innerHTML = cooked > 0 && sz.length
        ? `<div class="cost-preview"><span>Cost per gram</span><strong>฿${(total / cooked).toFixed(4)}</strong></div>` + sz.map((z) => `<div class="cost-preview"><span>${z.name} ${z.weight}g</span><strong>${baht(z.weight * total / cooked)}</strong></div>`).join('')
        : '';
    }
  }

  yieldInput.addEventListener('input', refresh);
  if (recipe.sized) ['regWeight', 'regCount', 'lgWeight', 'lgCount', 'cookedWeight'].forEach((id) => $(id).addEventListener('input', refresh));

  $('extraAdd').addEventListener('click', () => {
    const name = $('extraName').value.trim();
    const qty = Number($('extraQty').value);
    const res = $('batchResult');
    if (!name || !(qty > 0)) { res.innerHTML = '<div class="result-card"><div class="error-item">Type an ingredient name and a quantity in grams to add it.</div></div>'; return; }
    const known = recipe.catalogue[name];
    if (!known) { res.innerHTML = `<div class="result-card"><div class="error-item">"${escapeHtml(name)}" isn't in the Price Tracker, so it can't be costed. Pick one from the list.</div></div>`; return; }
    res.innerHTML = '';
    rows.splice(recipe.ingredients.length, 0, { type: 'Ingredient', name, unit: 'g', unitCost: known.unitCost, priceDate: known.priceDate, note: '', original: 0, qty, edited: true, extra: true });
    recipe.ingredients.push({});
    $('extraName').value = ''; $('extraQty').value = '';
    drawRows();
  });

  $('logBatch').addEventListener('click', async () => {
    const res = $('batchResult');
    const lines = rows.filter((r) => r.type === 'Ingredient' && r.edited && (r.extra || Number(r.qty) !== r.original)).map((r) => ({ name: r.name, qty: r.qty }));
    const packaging = rows.filter((r) => r.type === 'Packaging' && r.edited).map((r) => ({ name: r.name, qty: qtyOf(r) }));
    const body = {
      dish: recipe.tab, date: dateInput.value,
      yield: Number(yieldInput.value) || undefined,
      lines, packaging, sizes: sizeList(),
      cookedWeight: recipe.sized ? Number($('cookedWeight').value) || undefined : undefined,
    };
    if (!yieldN()) { res.innerHTML = '<div class="result-card"><div class="error-item">Add the servings yielded first. Nothing was logged.</div></div>'; return; }
    res.innerHTML = '<div class="loading">Logging…</div>';
    $('logBatch').disabled = true;
    try {
      const r = await fetch('/api/cook/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Request failed');
      const bad = data.status !== 'logged';
      res.innerHTML = `<div class="result-card"><div class="${bad ? 'error-item' : 'result-headline'}" style="white-space:pre-wrap">${escapeHtml(data.text)}</div></div>`;
    } catch (err) {
      res.innerHTML = `<div class="result-card"><div class="error-item" style="white-space:pre-wrap">${escapeHtml(err.message)}</div></div>`;
    } finally {
      $('logBatch').disabled = false;
    }
  });

  drawRows();
}

// ---- Mode 4: Stock Counts ----

async function renderStock() {
  main.innerHTML = '<div class="loading">Loading stock…</div>';
  let stock = [];
  try {
    const res = await fetch('/api/stock');
    const data = await res.json();
    stock = data.stock || [];
  } catch (err) {
    main.innerHTML = `<div class="result-card"><div class="error-item">${escapeHtml(err.message)}</div></div>`;
    return;
  }

  main.innerHTML = '';
  const section = el(`
    <section class="section">
      <div class="intro">
        <h1 class="intro-title">Stock Counts</h1>
        <p class="intro-body">Packaging and dry goods — cups, bags, cans, utensils. Counts auto-deduct as Batch Cook and Daily Orders use them. Recount anytime; your number always wins from that point on.</p>
      </div>
      <div class="stock-list" id="stockList"></div>
      <button class="primary-button" id="addStockBtn" style="margin-top:8px">+ Add item</button>
    </section>
  `);
  main.appendChild(section);

  const list = section.querySelector('#stockList');
  if (!stock.length) {
    list.innerHTML = '<div class="empty-state">No stock items yet — add your first one below.</div>';
  }
  stock.forEach((item) => list.appendChild(renderStockRow(item)));

  section.querySelector('#addStockBtn').addEventListener('click', () => {
    const name = prompt('Item name:');
    if (!name) return;
    const unit = prompt('Unit (e.g. Set, can, pcs):', '') || '';
    const count = prompt('Starting count:', '0');
    if (count == null) return;
    saveStock(name, Number(count), unit).then(() => renderStock()).catch(() => {});
  });
}

// ISO timestamp -> "15/10/2026 22:26" in Bangkok time
function formatStamp(value) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return value ? String(value) : 'never';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

function renderStockRow(item) {
  const row = el(`
    <div class="stock-row">
      <div>
        <div class="stock-name">${escapeHtml(item.itemName)}</div>
        <div class="stock-meta">${escapeHtml(item.unit)} · last updated ${escapeHtml(formatStamp(item.lastUpdated))}${item.lastUpdatedBy ? ' · ' + escapeHtml(item.lastUpdatedBy) : ''}</div>
      </div>
      <button class="stock-count-button">${item.currentCount}</button>
    </div>
  `);
  row.querySelector('.stock-count-button').addEventListener('click', () => {
    const editGroup = el(`
      <div class="stock-edit-group">
        <input class="stock-edit-input" type="number" value="${item.currentCount}" />
        <button class="small-button">Save</button>
      </div>
    `);
    const btn = row.querySelector('.stock-count-button');
    row.replaceChild(editGroup, btn);
    const input = editGroup.querySelector('input');
    input.focus();
    editGroup.querySelector('button').addEventListener('click', async () => {
      try { await saveStock(item.itemName, Number(input.value), item.unit); renderStock(); } catch (e) { /* already shown */ }
    });
  });
  return row;
}

async function saveStock(itemName, newCount, unit) {
  const res = await fetch('/api/stock/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemName, newCount, unit }),
  });
  if (!res.ok) {
    let msg = 'Request failed';
    try { msg = (await res.json()).error || msg; } catch (e) { /* keep default */ }
    alert(`Stock was NOT updated: ${msg}`);
    throw new Error(msg);
  }
}

// ---- Init ----
renderOrders();
