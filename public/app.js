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

// ---- Mode 3: Batch Cook ----

async function renderBatchCook() {
  main.innerHTML = '<div class="loading">Loading dishes…</div>';

  let dishes = [];
  try {
    const res = await fetch('/api/batch-cook/dishes');
    const data = await res.json();
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
        <p class="intro-body">Log a cook event: confirm the recipe, enter the measured cooked weight, and how many of each size you packed. This becomes the active lot — orders just tick down these counts, no live weighing needed.</p>
      </div>
      <label class="label">Dish</label>
      <select class="select" id="dishSelect">
        ${dishes.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
      </select>
      <div id="templateArea"></div>
    </section>
  `);
  main.appendChild(section);

  const dishSelect = section.querySelector('#dishSelect');
  const templateArea = section.querySelector('#templateArea');

  async function loadTemplate() {
    const dish = dishSelect.value;
    templateArea.innerHTML = '<div class="loading">Loading recipe…</div>';
    try {
      const res = await fetch(`/api/batch-cook/template/${encodeURIComponent(dish)}`);
      const template = await res.json();
      renderBatchCookForm(templateArea, dish, template);
    } catch (err) {
      templateArea.innerHTML = `<div class="result-card"><div class="error-item">${escapeHtml(err.message)}</div></div>`;
    }
  }

  dishSelect.addEventListener('change', loadTemplate);
  if (dishes.length) loadTemplate();
  else templateArea.innerHTML = '<div class="empty-state">No recipe templates found yet — add one to the Recipe Templates tab first.</div>';
}

function renderBatchCookForm(container, dish, template) {
  const ingredientRows = template.ingredients
    .map((i) => `<div class="recipe-row"><span class="recipe-name">${escapeHtml(i.name)}</span><span class="recipe-qty">${i.qty}${escapeHtml(i.unit)}</span><span class="recipe-price">฿${Number(i.unitPrice).toFixed(3)}/${escapeHtml(i.unit)}</span></div>`)
    .join('');
  const otherLines = [...template.packaging, ...template.utility];
  const otherRows = otherLines
    .map((l) => `<div class="recipe-row"><span class="recipe-name">${escapeHtml(l.name)}</span><span class="recipe-qty">${l.qty}${escapeHtml(l.unit)}</span><span class="recipe-price">฿${Number(l.unitPrice).toFixed(3)}</span></div>`)
    .join('');

  const ingredientCost = template.ingredients.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const otherCost = otherLines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const totalCost = ingredientCost + otherCost;

  container.innerHTML = `
    <div class="subheading">Ingredients (from saved recipe)</div>
    <div class="recipe-table">${ingredientRows || '<div class="empty-state">No ingredients saved for this dish yet.</div>'}</div>

    <div class="subheading">Packaging &amp; utility</div>
    <div class="recipe-table">${otherRows || '<div class="empty-state">None saved.</div>'}</div>

    <label class="label">Total cooked weight (measured, g)</label>
    <input class="input" type="number" id="totalWeight" placeholder="e.g. 2784" />

    <div class="subheading">Pack-out — how many of each size</div>
    <div id="sizeRows">
      <div class="size-row">
        <span class="size-name">Regular — weight (g)</span>
        <input class="size-input" type="number" id="regWeight" placeholder="g" style="width:70px" />
      </div>
      <div class="size-row">
        <span class="size-name">Regular — count packed</span>
        <input class="size-input" type="number" id="regCount" placeholder="0" />
      </div>
      <div class="size-row">
        <span class="size-name">Large — weight (g) <em style="font-weight:400;color:var(--muted)">(leave blank if no Large size)</em></span>
        <input class="size-input" type="number" id="lgWeight" placeholder="g" style="width:70px" />
      </div>
      <div class="size-row">
        <span class="size-name">Large — count packed</span>
        <input class="size-input" type="number" id="lgCount" placeholder="0" />
      </div>
    </div>

    <div class="cost-preview"><span>Total batch cost (from recipe)</span><strong>฿${totalCost.toFixed(2)}</strong></div>
    <div class="cost-preview" id="costPerGramPreview"><span>Cost per gram</span><strong>—</strong></div>

    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);margin-top:4px">
      <input type="checkbox" id="updateTemplate" /> Update saved recipe with any changes made here
    </label>

    <button class="primary-button" id="batchSubmit">Confirm batch &amp; create lot</button>
    <div id="batchResult"></div>
  `;

  const totalWeightInput = container.querySelector('#totalWeight');
  const costPreview = container.querySelector('#costPerGramPreview strong');
  totalWeightInput.addEventListener('input', () => {
    const w = Number(totalWeightInput.value);
    costPreview.textContent = w > 0 ? `฿${(totalCost / w).toFixed(4)}` : '—';
  });

  container.querySelector('#batchSubmit').addEventListener('click', async () => {
    const totalBatchWeight = Number(totalWeightInput.value);
    const regWeight = Number(container.querySelector('#regWeight').value);
    const regCount = Number(container.querySelector('#regCount').value);
    const lgWeight = Number(container.querySelector('#lgWeight').value);
    const lgCount = Number(container.querySelector('#lgCount').value);
    const updateTemplate = container.querySelector('#updateTemplate').checked;
    const resultDiv = container.querySelector('#batchResult');

    if (!totalBatchWeight || !regWeight || !regCount) {
      resultDiv.innerHTML = '<div class="result-card"><div class="error-item">Total weight, Regular weight, and Regular count are required.</div></div>';
      return;
    }

    const portionSizes = [{ sizeName: 'Regular', portionWeight: regWeight, countPacked: regCount }];
    if (lgWeight && lgCount) portionSizes.push({ sizeName: 'Large', portionWeight: lgWeight, countPacked: lgCount });

    resultDiv.innerHTML = '<div class="loading">Creating lot…</div>';
    try {
      const res = await fetch('/api/batch-cook/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dish, totalBatchWeight,
          ingredients: template.ingredients,
          packaging: template.packaging,
          utility: template.utility,
          portionSizes, updateTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      resultDiv.innerHTML = `
        <div class="result-card">
          <div class="result-headline">Lot created — ${escapeHtml(data.batchId)}</div>
          <div class="order-row-top"><span>Total cost</span><span>฿${Number(data.totalBatchCost).toFixed(2)}</span></div>
          <div class="order-row-top"><span>Cost per gram</span><span>฿${Number(data.costPerGram).toFixed(4)}</span></div>
        </div>`;
      if (data.stockFlags && data.stockFlags.length) {
        const ul = el('<ul class="flag-list"></ul>');
        data.stockFlags.forEach((f) => ul.appendChild(el(`<li class="flag-item">${escapeHtml(f)}</li>`)));
        resultDiv.querySelector('.result-card').appendChild(ul);
      }
    } catch (err) {
      resultDiv.innerHTML = `<div class="result-card"><div class="error-item">${escapeHtml(err.message)}</div></div>`;
    }
  });
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
    saveStock(name, Number(count), unit).then(() => renderStock());
  });
}

function renderStockRow(item) {
  const row = el(`
    <div class="stock-row">
      <div>
        <div class="stock-name">${escapeHtml(item.itemName)}</div>
        <div class="stock-meta">${escapeHtml(item.unit)} · last updated ${escapeHtml((item.lastUpdatedBy || '').toLowerCase())}</div>
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
      await saveStock(item.itemName, Number(input.value), item.unit);
      renderStock();
    });
  });
  return row;
}

async function saveStock(itemName, newCount, unit) {
  await fetch('/api/stock/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemName, newCount, unit }),
  });
}

// ---- Init ----
renderOrders();
