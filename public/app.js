const main = document.getElementById('main');
const tabBar = document.getElementById('tabBar');

const PANELS = { receipts: renderReceipts, batchcook: renderBatchCook, stock: renderStock };

tabBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-button');
  if (!btn || !btn.dataset.tab) return;   // Numbers and Commands are plain links
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

// ---- Summary cards above the Weekly Receipts and Batch Cook boxes (this week and this month) ----

const money = (n) => '฿' + Math.round(Number(n || 0)).toLocaleString('en-AU');
const money2 = (n) => '฿' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function spendCard(p) {
  const parts = [['Ingredients', p.ingredients], ['Overheads', p.overheads], ['Meta ads', p.ads]].map(([n, v]) => `<div class="sum-row"><span>${n}</span><span>${money(v)}</span></div>`).join('');
  const shops = p.byShop.length
    ? `<details class="sum-more"><summary>Where it went</summary>${p.byShop.map((x) => `<div class="sum-row"><span>${escapeHtml(x.shop)}</span><span>${money(x.amount)}</span></div>`).join('')}</details>`
    : '';
  return `<div class="sum-card"><div class="sum-label">${escapeHtml(p.label)}</div><div class="sum-range">${escapeHtml(p.range)}</div>
    <div class="sum-big">${money(p.total)}</div><div class="sum-lines">${parts}</div>${p.total ? shops : '<div class="sum-sub">Nothing logged yet.</div>'}</div>`;
}

function cookingCard(p) {
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  const dishes = p.byDish.length
    ? `<details class="sum-more"><summary>By dish</summary>${p.byDish.map((d) => `<div class="sum-row"><span>${escapeHtml(d.dish)}<small>${plural(d.batches, 'batch', 'batches')}${d.perPortion === null ? '' : `, ${money(d.perPortion)} a portion`}</small></span><span>${plural(d.portions, 'portion', 'portions')}</span></div>`).join('')}</details>`
    : '';
  const low = p.lowYield.length ? `<div class="sum-warn">Low yield: ${p.lowYield.map((b) => `${escapeHtml(b.dish)} ${b.portions} on ${escapeHtml(b.date)}`).join(', ')}. Check the margin.</div>` : '';
  return `<div class="sum-card"><div class="sum-label">${escapeHtml(p.label)}</div><div class="sum-range">${escapeHtml(p.range)}</div>
    <div class="sum-big">${plural(p.batches, 'batch', 'batches')}</div>
    <div class="sum-lines"><div class="sum-row"><span>Portions</span><span>${p.portions}</span></div><div class="sum-row"><span>Cost</span><span>${money(p.cost)}</span></div>${p.perPortion === null ? '' : `<div class="sum-row"><span>Per portion</span><span>${money(p.perPortion)}</span></div>`}</div>
    ${low}${p.batches ? dishes : '<div class="sum-sub">Nothing cooked yet.</div>'}</div>`;
}

// Puts a summary into `box`. Returns a function that reloads it (call after logging something).
function summaryLoader(box, url, cardOf) {
  const run = async () => {
    try {
      const res = await fetch(url);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
      box.innerHTML = d.periods.map(cardOf).join('');
    } catch (err) {
      box.innerHTML = `<div class="sum-card"><div class="sum-sub">Summary not available: ${escapeHtml(err.message)}</div></div>`;
    }
  };
  box.innerHTML = '<div class="sum-card"><div class="sum-sub">Loading summary…</div></div>';
  run();
  return run;
}


// ---- Monthly logs (Weekly Receipts and Batch Cook): pick a month, see every line, download as CSV ----

const dmyShort = (d) => String(d || '').slice(0, 5); // 04/11/2026 -> 04/11
const num2 = (n) => Number(n || 0).toLocaleString('en-AU', { maximumFractionDigits: 2 });

// box: element to fill. api: '/api/receipts/log' (the .csv link is api + '.csv'). draw(log) returns the table html.
// links: [{ label, query }] extra query text added to the CSV link, for example format=pricelog.
function monthlyLog(box, { title, api, links, totalsOf, draw }) {
  box.innerHTML = `<h2 class="log-title">${escapeHtml(title)}</h2><div class="log-body"><div class="loading">Loading…</div></div>`;
  const body = box.querySelector('.log-body');
  async function load(month) {
    body.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const res = await fetch(`${api}${month ? `?month=${encodeURIComponent(month)}` : ''}`);
      const log = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(log.error || `Request failed (${res.status})`);
      const opts = [...log.months.map((m) => `<option value="${m.key}"${m.key === log.month ? ' selected' : ''}>${escapeHtml(m.label)}</option>`), `<option value="all"${log.month === 'all' ? ' selected' : ''}>All months</option>`].join('');
      const csv = links.map((l) => `<a class="log-link" href="${api}.csv?month=${encodeURIComponent(log.month)}${l.query ? '&' + l.query : ''}">${escapeHtml(l.label)}</a>`).join('');
      body.innerHTML = `<div class="log-bar"><select class="select log-month">${opts}</select><div class="log-links">${csv}</div></div>
        <div class="log-totals">${totalsOf(log)}</div>${log.rows.length ? draw(log) : '<div class="empty-state">Nothing logged in this month yet.</div>'}`;
      body.querySelector('.log-month').addEventListener('change', (e) => load(e.target.value));
    } catch (err) {
      body.innerHTML = `<div class="sum-card"><div class="sum-sub">Log not available: ${escapeHtml(err.message)}</div></div>`;
    }
  }
  load('');
  return () => load(body.querySelector('.log-month') ? body.querySelector('.log-month').value : '');
}

function receiptLogTotals(log) {
  const t = log.totals;
  const bit = (n, v) => `<div><span>${n}</span><strong>${money(v)}</strong></div>`;
  return `${bit('Total', t.all)}${bit('Ingredients', t.ingredients)}${bit('Overheads', t.overheads)}${t.ads ? bit('Meta ads', t.ads) : ''}`;
}
function receiptLogTable(log) {
  const shops = log.byShop.length ? `<details class="sum-more"><summary>Spend by shop</summary>${log.byShop.map((x) => `<div class="sum-row"><span>${escapeHtml(x.shop)}</span><span>${money(x.amount)}</span></div>`).join('')}</details>` : '';
  const rows = log.rows.map((r) => `<tr><td>${escapeHtml(dmyShort(r.date))}</td><td>${escapeHtml(r.item)}${r.type !== 'Ingredient' ? `<small>${escapeHtml(r.type)}${r.category && r.type === 'Overhead' ? ', ' + escapeHtml(r.category) : ''}</small>` : ''}</td><td>${escapeHtml(r.qty)}</td><td class="r">${num2(r.price)}</td><td>${escapeHtml(r.shop)}</td></tr>`).join('');
  return `${shops}<div class="log-scroll"><table class="log-table"><thead><tr><th>Date</th><th>Item</th><th>How many</th><th class="r">฿</th><th>Where</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function cookLogTotals(log) {
  const t = log.totals;
  const bit = (n, v) => `<div><span>${n}</span><strong>${v}</strong></div>`;
  return `${bit('Batches', t.batches)}${bit('Portions', t.portions)}${bit('Cost', money(t.cost))}${t.perPortion === null ? '' : bit('Per portion', money(t.perPortion))}`;
}
function cookLogTable(log) {
  const dishes = log.byDish.length ? `<details class="sum-more"><summary>By dish</summary>${log.byDish.map((d) => `<div class="sum-row"><span>${escapeHtml(d.dish)}<small>${d.batches} ${d.batches === 1 ? 'batch' : 'batches'}${d.perPortion === null ? '' : `, ${money(d.perPortion)} a portion`}</small></span><span>${d.portions} portions</span></div>`).join('')}</details>` : '';
  const rows = log.rows.map((r) => `<tr${r.lowYield ? ' class="warn"' : ''}><td>${escapeHtml(dmyShort(r.date))}</td><td>${escapeHtml(r.dish)}${r.sizes ? `<small>${escapeHtml(r.sizes)}</small>` : ''}${r.lowYield ? '<small>Low yield, check the margin</small>' : ''}</td><td class="r">${r.portions}</td><td class="r">${num2(r.total)}</td><td class="r">${r.perPortion === null ? '' : num2(r.perPortion)}</td></tr>`).join('');
  return `${dishes}<div class="log-scroll"><table class="log-table"><thead><tr><th>Date</th><th>Dish</th><th class="r">Portions</th><th class="r">Cost ฿</th><th class="r">Per portion ฿</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---- Mode 2: Weekly Receipts (typed) ----

function renderReceipts() {
  main.innerHTML = '';
  const section = el(`
    <section class="section">
      <div class="intro">
        <h1 class="intro-title">Purchasing Receipts</h1>
        <p class="intro-body">Type your shopping with a date, then one line per item with the quantity and price. Items go into the Expense Log, kept separate from your live Price Log. A batch cooked on or after that date uses the price.</p>
      </div>
      <div class="sum-grid" id="spendSummary"></div>
      <div class="shop-box" id="shopBox"><h2>Shopping plan</h2><div id="shopPlan"></div></div>
      <textarea id="receiptText" rows="8" placeholder="18/10&#10;minced pork 1000g 110thb&#10;onion 2kg 90thb" style="width:100%;box-sizing:border-box;padding:12px;font:inherit;border-radius:8px;border:1px solid #ccc"></textarea>
      <button class="primary-button" id="receiptSubmit" disabled>Type a receipt first</button>
      <div id="receiptResult"></div>
      <div class="log-box" id="receiptLog"></div>
    </section>
  `);
  main.appendChild(section);

  const input = section.querySelector('#receiptText');
  const submitBtn = section.querySelector('#receiptSubmit');
  const resultDiv = section.querySelector('#receiptResult');
  if (window.ShoppingPlan) window.ShoppingPlan.load(section.querySelector('#shopPlan'), {});
  const reloadSpend0 = summaryLoader(section.querySelector('#spendSummary'), '/api/summary/spend', spendCard);
  const reloadLog = monthlyLog(section.querySelector('#receiptLog'), {
    title: 'What I bought, by month', api: '/api/receipts/log', totalsOf: receiptLogTotals, draw: receiptLogTable,
    links: [{ label: 'Download CSV', query: '' }, { label: 'Price Log format', query: 'format=pricelog' }],
  });
  const reloadSpend = () => { reloadSpend0(); reloadLog(); };

  input.addEventListener('input', () => {
    const has = input.value.trim().length > 0;
    submitBtn.disabled = !has;
    submitBtn.textContent = has ? 'Log receipt' : 'Type a receipt first';
  });

  submitBtn.addEventListener('click', async () => {
    if (!input.value.trim()) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging…';
    resultDiv.innerHTML = '';
    try {
      const res = await fetch('/api/receipts/typed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: input.value }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      const html = data.replies.map((r) => `<div class="result-card"><pre style="white-space:pre-wrap;font:inherit;margin:0">${escapeHtml(r)}</pre></div>`).join('');
      resultDiv.appendChild(el(`<div>${html}</div>`));
      input.value = '';
      reloadSpend();
    } catch (err) {
      resultDiv.appendChild(el(`<div class="result-card"><div class="error-item">${escapeHtml(err.message)}</div></div>`));
    } finally {
      submitBtn.disabled = !input.value.trim();
      submitBtn.textContent = input.value.trim() ? 'Log receipt' : 'Type a receipt first';
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
        <h1 class="intro-title">Kitchen Production</h1>
        <a class="primary-button" href="recipes.html" style="display:inline-block;width:auto;text-decoration:none;margin:0 0 10px;padding:8px 16px">View recipes</a>
        <p class="intro-body">Two ways to log. One: log it all at once, when you already know the portions. Two: save the ingredients when you cook, then add the portions after you have packed them (they wait in the box below). Pick the dish and date. Ingredients fill in from the recipe in Merlin's numbers. Change any quantity that was different today, and leave the rest. Prices are the latest purchase on or before the cook date. This does the same job as a cook note in the LINE group.</p>
      </div>
      <div class="sum-grid" id="cookSummary"></div>
      <div id="openBatches"></div>
      <label class="label">Paste a cook note or any command</label>
      <textarea id="noteText" rows="10" placeholder="7/10&#10;Bolo&#10;Meat 1000&#10;O 446&#10;G 60&#10;yield 21" style="width:100%;box-sizing:border-box;padding:12px;font:inherit;border-radius:8px;border:1px solid #ccc"></textarea>
      <button class="primary-button" id="noteSubmit" disabled>Paste a note first</button>
      <div id="noteResult"></div>
      <p class="intro-body" style="margin-top:18px">Or fill in one batch by hand:</p>
      <label class="label">Dish</label>
      <a href="recipes.html" id="recipeLink" style="float:right;font-size:14px;color:var(--accent)">View this recipe</a>
      <select class="select" id="dishSelect">${dishes.map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join('')}</select>
      <label class="label">Date cooked (DD/MM/YYYY)</label>
      <input class="input" id="cookDate" value="${todayBangkokDMY()}" />
      <div id="templateArea"></div>
      <div class="log-box" id="cookLog"></div>
    </section>
  `);
  main.appendChild(section);

  const noteInput = section.querySelector('#noteText');
  const noteBtn = section.querySelector('#noteSubmit');
  const noteResult = section.querySelector('#noteResult');
  const reloadCooking0 = summaryLoader(section.querySelector('#cookSummary'), '/api/summary/cooking', cookingCard);
  const reloadCookLog = monthlyLog(section.querySelector('#cookLog'), {
    title: 'What I cooked, by month', api: '/api/cook/log', totalsOf: cookLogTotals, draw: cookLogTable,
    links: [{ label: 'Download CSV', query: '' }, { label: 'Download every ingredient line', query: 'detail=1' }],
  });
  const openBox = section.querySelector('#openBatches');
  async function loadOpen() {
    try {
      const res = await fetch('/api/cook/open');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      drawOpen(openBox, data.open || [], loadOpen, reloadCooking);
    } catch (err) { openBox.innerHTML = `<div class="result-card"><div class="error-item">${escapeHtml(err.message)}</div></div>`; }
  }
  const reloadCooking = () => { reloadCooking0(); reloadCookLog(); loadOpen(); };
  loadOpen();
  const noteLabel = () => { const has = noteInput.value.trim().length > 0; noteBtn.disabled = !has; noteBtn.textContent = has ? 'Log cook note' : 'Paste a note first'; };
  noteInput.addEventListener('input', noteLabel);
  noteBtn.addEventListener('click', async () => {
    if (!noteInput.value.trim()) return;
    noteBtn.disabled = true;
    noteBtn.textContent = 'Logging…';
    noteResult.innerHTML = '';
    try {
      const res = await fetch('/api/cook/note', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: noteInput.value }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      const html = data.replies.map((r) => `<div class="result-card"><pre style="white-space:pre-wrap;font:inherit;margin:0">${escapeHtml(r)}</pre></div>`).join('');
      noteResult.appendChild(el(`<div>${html}</div>`));
      noteInput.value = '';
      reloadCooking();
    } catch (err) {
      noteResult.appendChild(el(`<div class="result-card"><pre class="error-item" style="white-space:pre-wrap;font:inherit;margin:0">${escapeHtml(err.message)}</pre></div>`));
    } finally {
      noteLabel();
    }
  });

  const dishSelect = section.querySelector('#dishSelect');
  const dateInput = section.querySelector('#cookDate');
  const area = section.querySelector('#templateArea');

  async function load() {
    area.innerHTML = '<div class="loading">Loading recipe…</div>';
    try {
      const res = await fetch(`/api/cook/recipe?dish=${encodeURIComponent(dishSelect.value)}&date=${encodeURIComponent(dateInput.value)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      renderCookForm(area, data, dateInput, reloadCooking);
    } catch (err) {
      area.innerHTML = `<div class="result-card"><div class="error-item">${escapeHtml(err.message)}</div></div>`;
    }
  }
  const recipeLink = section.querySelector('#recipeLink');
  const setLink = () => { recipeLink.href = `recipes.html#${encodeURIComponent(dishSelect.value)}`; };
  setLink();
  dishSelect.addEventListener('change', () => { setLink(); load(); });
  dateInput.addEventListener('change', load);
  if (dishes.length) load();
  else area.innerHTML = '<div class="empty-state">No dishes found.</div>';
}

// Batches cooked and saved, waiting for the portions to be counted.
function drawOpen(box, open, reload, onLogged) {
  if (!open.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="sum-card" style="margin:0 0 14px"><div class="sum-label">Waiting for portions</div><div id="openList"></div></div>';
  const list = box.querySelector('#openList');
  open.forEach((o) => {
    const node = el(`
      <div class="open-batch">
        <div><b>${escapeHtml(o.dish)}</b>, cooked ${escapeHtml(o.date)}</div>
        <small>${o.lines.length ? escapeHtml(o.lines.slice(0, 6).join(', ')) + (o.lines.length > 6 ? ', ...' : '') : 'recipe quantities'}</small>
        <div class="size-row">${o.sized
          ? `<span class="size-name">Regular</span><input class="size-input" type="number" data-size="Regular" /><span class="size-name">Large</span><input class="size-input" type="number" data-size="Large" />`
          : `<span class="size-name">Portions made</span><input class="size-input" type="number" data-yield />`}
          <button class="stock-count-button" type="button" data-act="log">Log portions</button>
          <button class="stock-count-button" type="button" data-act="drop" style="background:transparent;color:var(--flag);border:1px solid var(--line)">Drop</button>
        </div>
        <div class="open-result"></div>
      </div>`);
    const result = node.querySelector('.open-result');
    node.querySelector('[data-act="log"]').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const sizes = [...node.querySelectorAll('[data-size]')].map((i) => ({ name: i.dataset.size, count: Number(i.value) || 0 })).filter((z) => z.count > 0);
      const y = node.querySelector('[data-yield]');
      const body = { key: o.key, yield: y ? Number(y.value) || undefined : undefined, sizes };
      if (!body.yield && !sizes.length) { result.innerHTML = '<div class="error-item">Enter how many portions it made.</div>'; return; }
      btn.disabled = true; result.innerHTML = '<div class="loading">Logging…</div>';
      try {
        const r = await fetch('/api/cook/open/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Request failed');
        const bad = data.status !== 'logged';
        result.innerHTML = `<div class="${bad ? 'error-item' : 'result-headline'}" style="white-space:pre-wrap">${escapeHtml(data.text)}</div>`;
        if (!bad) setTimeout(onLogged, 2500);
      } catch (err) { result.innerHTML = `<div class="error-item" style="white-space:pre-wrap">${escapeHtml(err.message)}</div>`; btn.disabled = false; }
    });
    node.querySelector('[data-act="drop"]').addEventListener('click', async () => {
      if (!confirm(`Drop the ${o.dish} batch cooked on ${o.date}? Nothing will be logged.`)) return;
      try {
        const r = await fetch('/api/cook/open/drop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: o.key }) });
        const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Request failed');
        reload();
      } catch (err) { result.innerHTML = `<div class="error-item">${escapeHtml(err.message)}</div>`; }
    });
    list.appendChild(node);
  });
}

function renderCookForm(container, recipe, dateInput, onLogged) {
  // Each row: { type, name, unit, unitCost, priceDate, original, input }
  const rows = [];
  const row = (l, type) => ({ type, name: l.name, unit: l.unit || '', unitCost: l.unitCost, priceDate: l.priceDate, note: l.note, original: l.qty, extra: false });
  recipe.ingredients.forEach((l) => rows.push(row(l, 'Ingredient')));
  recipe.packaging.forEach((l) => rows.push(row(l, 'Packaging')));
  if (recipe.sized) rows.forEach((r) => { if (r.type === 'Packaging') { r.original = 0; r.qty = undefined; } });
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
      <div class="subheading">Pack-out (Regular in 16oz cups, Large in 26oz cups)</div>
      <div class="size-row"><span class="size-name">Regular: weight (g)</span><input class="size-input" type="number" id="regWeight" value="${(recipe.portionWeights && recipe.portionWeights.Regular) || ''}" /></div>
      <div class="size-row"><span class="size-name">Regular: count packed</span><input class="size-input" type="number" id="regCount" /></div>
      <div class="size-row"><span class="size-name">Large: weight (g)</span><input class="size-input" type="number" id="lgWeight" value="${(recipe.portionWeights && recipe.portionWeights.Large) || ''}" /></div>
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
    <button class="primary-button" id="saveOpen" type="button" style="background:var(--card);color:var(--accent);border:2px solid var(--accent);margin-top:8px">Save ingredients now, add portions later</button>
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
    if (r.type === 'Packaging' && recipe.sized) {
      // Regular is packed in a 16oz cup, Large in a 26oz cup
      const cupOf = { Regular: /16oz/i, Large: /26oz/i };
      return sizeList().filter((z) => cupOf[z.name].test(r.name)).reduce((a, z) => a + z.count, 0);
    }
    if (r.type === 'Packaging' && yieldN() > 0) return yieldN();
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
      const perG = total / (cooked || 1);
      $('tSizes').innerHTML = cooked > 0 && sz.length
        ? `<div class="cost-preview"><span>Cost per gram (whole batch)</span><strong>฿${perG.toFixed(4)}</strong></div>` + sz.map((z) => `<div class="cost-preview"><span>${z.name} ${z.weight}g</span><strong>${baht(z.weight * perG)}</strong></div>`).join('')
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
      if (!bad && onLogged) onLogged();
    } catch (err) {
      res.innerHTML = `<div class="result-card"><div class="error-item" style="white-space:pre-wrap">${escapeHtml(err.message)}</div></div>`;
    } finally {
      $('logBatch').disabled = false;
    }
  });

  $('saveOpen').addEventListener('click', async () => {
    const res = $('batchResult');
    // Every ingredient as it stands now is saved, so the batch is frozen as cooked even if the recipe changes before you count the portions.
    const lines = rows.filter((r) => r.type === 'Ingredient').map((r) => ({ name: r.name, qty: r.qty !== undefined ? r.qty : r.original })).filter((l) => Number(l.qty) >= 0);
    const packaging = rows.filter((r) => r.type === 'Packaging' && r.edited).map((r) => ({ name: r.name, qty: qtyOf(r) }));
    const body = { dish: recipe.tab, date: dateInput.value, lines, packaging, sizes: [], yield: undefined };
    res.innerHTML = '<div class="loading">Saving…</div>';
    $('saveOpen').disabled = true;
    try {
      const r = await fetch('/api/cook/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Request failed');
      const bad = data.status !== 'parked';
      res.innerHTML = `<div class="result-card"><div class="${bad ? 'error-item' : 'result-headline'}" style="white-space:pre-wrap">${escapeHtml(data.text)}</div></div>`;
      if (!bad && onLogged) onLogged();
    } catch (err) {
      res.innerHTML = `<div class="result-card"><div class="error-item" style="white-space:pre-wrap">${escapeHtml(err.message)}</div></div>`;
    } finally { $('saveOpen').disabled = false; }
  });

  drawRows();
}


// ---- Stock Counts ----
let STOCK_CATS = ['Meat', 'Drinks', 'Packaging', 'Ingredients', 'Other'];
const gramsText = (n, u = 'g') => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}${u === 'pcs' ? ' pcs' : 'g'}`;
const piecesInGrams = (qty, size) => (Number(size) > 0 && Number(qty) > 0 ? ` · about ${gramsText(Number(qty) * Number(size))}` : '');
const bagsText = (bags) => (bags || []).map((g) => Number(g).toLocaleString('en-US')).join(' + ');
const plainName = (n) => String(n || '').replace(/\s*\([^)]*\)\s*/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOCK_UNITS = ['can', 'bottle', 'tin', 'jar', 'pcs', 'pack', 'box', 'bag', 'roll', 'kg', 'g', 'L', 'ml'];
const PACK_UNITS = ['can', 'bottle', 'tin', 'jar', 'pack', 'box', 'bag'];
const SIZE_UNITS = ['ml', 'g', 'L', 'kg'];
const sizeUnitOptions = (sel) => SIZE_UNITS.map((u) => `<option value="${u}"${u === sel ? ' selected' : ''}>${u}</option>`).join('');
const sizeText = (it) => (it && it.size ? `${it.size}${it.sizeUnit}` : '');
const unitOptions = (sel) => [...new Set([...STOCK_UNITS, ...(sel ? [sel] : [])])].map((u) => `<option value="${escapeHtml(u)}"${u === sel ? ' selected' : ''}>${escapeHtml(u)}</option>`).join('');
const catOptions = (sel, placeholder = '') => (placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : '') + STOCK_CATS.map((c) => `<option value="${c}"${c === sel ? ' selected' : ''}>${c}</option>`).join('');
const catOf = (item) => item.category || item.guess || '';

async function stockPost(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    alert(`Not saved: ${data.error || 'Request failed'}`);
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

async function renderStock() {
  main.innerHTML = '<div class="loading">Loading stock…</div>';
  let stock = []; let ingredients = []; let blends = []; let swaps = [];
  try {
    const get = async (url) => { const r = await fetch(url); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Could not load ${url}`); return d; };
    // Once only: sets up the bagged meat items (Brisket, Chuck...) in the Meat category. Does nothing after the first time.
    await fetch('/api/stock/seed-meat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
    const [s, ing, bl] = await Promise.all([get('/api/stock'), get('/api/stock/ingredients').catch(() => ({ items: [] })), get('/api/blends').catch(() => ({ blends: [] }))]);
    stock = s.stock || []; blends = bl.blends || [];
    if (Array.isArray(s.categories) && s.categories.length) STOCK_CATS = s.categories;
    // Bagged meat is counted in grams as one item, so the receipts based row for the same meat is hidden.
    const bagged = new Set(stock.filter((x) => x.bags).map((x) => plainName(x.itemName)));
    ingredients = (ing.items || []).filter((i) => !bagged.has(plainName(i.name)));
    swaps = (await get('/api/ingredient-swaps').catch(() => ({ swaps: [] }))).swaps || [];
  } catch (err) {
    main.innerHTML = `<div class="result-card"><div class="error-item">${escapeHtml(err.message)}</div></div>`;
    return;
  }

  const rows = [
    ...stock.map((item) => ({ kind: 'counted', name: item.itemName, qty: item.currentCount, unit: item.unit, cat: catOf(item), saved: Boolean(item.category), item, red: item.red, days: item.daysLeft })),
    ...ingredients.map((i) => ({ kind: 'ingredient', name: i.name, qty: i.pack ? i.pack.packs : i.left, unit: i.pack ? i.pack.word : i.unit, cat: i.category || 'Ingredients', saved: true, item: i, red: i.red, days: i.daysLeft })),
  ];
  const isRed = (r) => Boolean(r.red);
  // Soonest to run out first: none left at the very top, then fewest days of cooking left, then fewest packs.
  const sortKey = (r) => (r.qty === 0 ? -1 : (r.days ?? 1e6) * 1000 + (r.qty ?? 0));
  const byQty = (a, b) => sortKey(a) - sortKey(b) || a.name.localeCompare(b.name);
  const red = rows.filter(isRed).sort(byQty);
  const rest = rows.filter((r) => !isRed(r));

  main.innerHTML = '';
  const section = el(`
    <section class="section">
      <div class="intro">
        <h1 class="intro-title">Stock Counts</h1>
        <p class="intro-body">Tap any row to edit its name, quantity, unit or category. Red means none left, or less than a week of cooking left at the recent rate of use (a 450g bottle of pepper is fine at 1). Red goes first on the shopping list.</p>
      </div>
      <div id="stockRed"></div>
      <div id="stockCats"></div>
      <div class="intro" style="margin-top:18px">
        <h1 class="intro-title" style="font-size:18px">Add stock <button class="small-button" id="addCategoryBtn" type="button" style="margin-left:8px;font-weight:600">Add category</button></h1>
        <p class="intro-body">Name, count, unit, category and brand, then Add. For a can, bottle, tin or jar, also type how much is in one (ml or g). The form stays open for the next item. A name that already exists updates its count.</p>
      </div>
      <form class="stock-row" id="addStockForm" style="display:grid;grid-template-columns:1fr 80px;gap:8px;align-items:center">
        <input class="stock-edit-input" id="addName" list="stockNames" placeholder="Item name" autocomplete="off" required style="width:auto" />
        <input class="stock-edit-input" id="addCount" type="number" inputmode="decimal" step="any" placeholder="Count" style="width:auto" />
        <select class="stock-edit-input" id="addUnit" style="width:auto">${unitOptions('can')}</select>
        <select class="stock-edit-input" id="addCat" style="width:auto">${catOptions('', 'Category (auto)')}</select>
        <div id="addBagRow" style="grid-column:1 / -1;display:none;grid-template-columns:1fr 110px;gap:8px"><input class="stock-edit-input" id="addBags" placeholder="Weight of each bag in grams, e.g. 1400, 180, 240" inputmode="decimal" style="width:auto" /><input class="stock-edit-input" id="addBatch" type="number" step="any" inputmode="decimal" placeholder="Batch g" style="width:auto" /></div>
        <input class="stock-edit-input" id="addBrand" placeholder="Brand (e.g. Coca-Cola, Mutti)" maxlength="60" style="grid-column:1 / -1;width:auto" />
        <div id="addSizeRow" style="grid-column:1 / -1;display:grid;grid-template-columns:1fr 80px;gap:8px"><input class="stock-edit-input" id="addSize" type="number" step="any" inputmode="decimal" placeholder="Size of one can, bottle or tin, e.g. 330" style="width:auto" /><select class="stock-edit-input" id="addSizeUnit" style="width:auto">${sizeUnitOptions('ml')}</select></div>
        <button class="primary-button" type="submit" style="grid-column:1 / -1">Add</button>
      </form>
      <datalist id="stockNames"></datalist>
      <div id="addMsg" class="stock-meta" style="margin:6px 2px"></div>
      <details style="margin-top:10px">
        <summary class="stock-meta" style="cursor:pointer">Add many at once</summary>
        <p class="stock-meta" style="margin:6px 0">One item per line: name, count, unit. Example: coke zero 11 can. The unit is optional (defaults to can). The category is worked out from the name, and anything unknown lands in "Needs a category".</p>
        <textarea id="bulkText" rows="6" placeholder="coke zero 11 can&#10;red wine Ti 3 bottle&#10;paper bags 40 pcs" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--line);border-radius:8px;font:inherit"></textarea>
        <button class="primary-button" id="bulkBtn" type="button" style="margin-top:8px">Add all</button>
      </details>
      <div class="intro" style="margin-top:26px">
        <h1 class="intro-title" style="font-size:18px">Replaced an ingredient</h1>
        <p class="intro-body">Use this only when the ingredient itself is a different product, like Polpa replaced by Pelati. The recipe is not touched, and batches from the start date use the new ingredient and its cost. A new brand of the same ingredient (another stout, another pasta) needs nothing here: tap the item in the list above and type the brand.</p>
      </div>
      <div id="swapList"></div>
      <form class="stock-row" id="swapForm" style="display:block">
        <input class="stock-edit-input" id="swapOld" list="stockNames" placeholder="Recipe says (e.g. Polpa)" autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:8px" />
        <input class="stock-edit-input" id="swapNew" list="stockNames" placeholder="Use this instead (e.g. Pelati)" autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:8px" />
        <label class="stock-meta" style="display:block;margin-bottom:8px">From this date <input class="stock-edit-input" id="swapFrom" type="date" style="width:auto" /></label>
        <button class="primary-button" type="submit">Save</button>
      </form>
      <div class="intro" style="margin-top:26px">
        <h1 class="intro-title" style="font-size:18px">Blends</h1>
        <p class="intro-body">When one recipe ingredient is a mix of two brands (for example red wine, half Ti and half Familia), set the parts here. A batch then takes each brand from its own stock in those parts and costs the real mix. The parts are a ratio: 3 tsp and 5 tsp is just 3 and 5.</p>
      </div>
      <div id="blendList"></div>
      <form class="stock-row" id="blendForm" style="display:block">
        <input class="stock-edit-input" id="blendName" placeholder="Blend name, as the recipe calls it (e.g. Red wine)" autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:8px" />
        <div id="blendParts"></div>
        <button class="small-button" id="blendMore" type="button" style="margin:6px 0">+ Another ingredient</button>
        <button class="primary-button" type="submit" style="display:block;width:100%">Save blend</button>
      </form>
    </section>
  `);
  main.appendChild(section);

  // ---- rows
  function drawRow(r, redRow) {
    const rowEl = el(`
      <div class="stock-row"${redRow ? ' style="background:#fdecea;border-color:#e8b4ae"' : ''}>
        <div>
          <div class="stock-name"${redRow ? ' style="color:#b3261e"' : ''}>${escapeHtml(r.name)}${r.item.brand ? ` <span class="stock-meta" style="font-weight:600">· ${escapeHtml(r.item.brand)}</span>` : ''}${redRow ? ` <span style="font-weight:700">· ${r.item.bags && r.qty > 0 ? 'BELOW ONE BATCH' : 'FILL ASAP'}</span>` : ''}</div>
          <div class="stock-meta">${r.kind === 'counted'
    ? (r.item.bags ? `${r.item.bags.length ? 'bags: ' + escapeHtml(bagsText(r.item.bags)) + (r.unit === 'pcs' ? ' pcs' : 'g') : 'no bags yet'}${r.unit === 'pcs' ? escapeHtml(piecesInGrams(r.qty, r.item.size)) : ''}${r.item.batch ? ' · one batch ' + escapeHtml(gramsText(r.item.batch, r.unit)) : ''}${r.item.batch && r.qty < r.item.batch ? ' · not enough together for one batch' : ''} · updated ${escapeHtml(formatStamp(r.item.lastUpdated))}` : `${escapeHtml(r.unit || '')}${sizeText(r.item) ? ` · ${escapeHtml(sizeText(r.item))} each, ${escapeHtml(String(Math.round(r.qty * r.item.size * 100) / 100))}${escapeHtml(r.item.sizeUnit)} in total` : ''}${redRow ? ` · ${escapeHtml(r.cat || 'no category')}` : ''}${r.days !== null && r.days !== undefined ? ` · about ${r.days} day${r.days === 1 ? '' : 's'} left` : ''} · updated ${escapeHtml(formatStamp(r.item.lastUpdated))}${!r.saved && r.cat ? ' · category guessed' : ''}`)
    : `${r.item.pack ? escapeHtml(r.item.left + r.item.unit) + ' · ' : 'tap to count in packs · '}${r.item.oldest ? 'oldest bought ' + escapeHtml(r.item.oldest) : 'used up'}${r.days !== null && r.days !== undefined ? ` · about ${r.days} day${r.days === 1 ? '' : 's'} left` : ''}${r.item.level ? ' · alert below ' + escapeHtml(r.item.level) : ''}`}</div>
        </div>
        <button class="stock-count-button"${redRow ? ' style="background:#b3261e;color:#fff;border-color:#b3261e"' : ''}>${escapeHtml(r.kind === 'ingredient' ? (r.item.pack ? r.item.pack.label : r.item.left + r.item.unit) : r.item.bags ? gramsText(r.qty, r.unit) : String(r.qty))}</button>
      </div>`);
    rowEl.style.cursor = 'pointer';
    rowEl.addEventListener('click', (e) => { if (e.target.closest('select,input')) return; if (r.kind === 'ingredient') openIngredientEdit(rowEl, r); else openEdit(rowEl, r); });
    return rowEl;
  }

  // Bagged meat: one item counted in grams, bags typed as a list (1400, 180, 240...). The count is always their total.
  function openBagEdit(rowEl, r) {
    const it = r.item;
    const form = el(`
      <form class="stock-row" style="display:grid;grid-template-columns:1fr 120px;gap:8px;align-items:center;border-color:var(--ink,#294bd4)">
        <input class="stock-edit-input" name="name" value="${escapeHtml(r.name)}" style="width:auto" required />
        <select class="stock-edit-input" name="cat" style="width:auto">${catOptions(r.cat)}</select>
        <select class="stock-edit-input" name="bunit" style="grid-column:1 / -1;width:auto"><option value="g"${r.unit === 'pcs' ? '' : ' selected'}>Bags are weighed in grams</option><option value="pcs"${r.unit === 'pcs' ? ' selected' : ''}>Bags are counted in pieces</option></select>
        <div class="stock-meta" id="bagHelp" style="grid-column:1 / -1"></div>
        <input class="stock-edit-input" name="bags" value="${escapeHtml((it.bags || []).join(', '))}" placeholder="Weight of each bag in grams, e.g. 1400, 180, 240" inputmode="decimal" style="grid-column:1 / -1;width:auto" />
        <label class="stock-meta" style="grid-column:1 / -1"><span id="batchLabel">One batch uses</span> <input class="stock-edit-input" name="batch" type="number" step="any" inputmode="decimal" value="${it.batch || ''}" placeholder="e.g. 1600" style="width:110px" /></label>
        <input class="stock-edit-input" name="brand" placeholder="Brand or supplier" value="${escapeHtml(it.brand || '')}" maxlength="60" style="grid-column:1 / -1;width:auto" />
        <div class="stock-meta" style="grid-column:1 / -1;display:flex;gap:6px;align-items:center;flex-wrap:wrap">Add bags: <input class="stock-edit-input" name="addW" type="number" step="any" inputmode="decimal" placeholder="g per bag" style="width:90px" /> × <input class="stock-edit-input" name="addN" type="number" step="1" inputmode="numeric" placeholder="how many bags" value="1" style="width:80px" /> <button class="small-button" type="button" data-addbags>Add</button></div>
        <label class="stock-meta" id="pieceRow" style="grid-column:1 / -1">One piece weighs (g), optional <input class="stock-edit-input" name="piece" type="number" step="any" inputmode="decimal" value="${it.unit === 'pcs' && it.size ? it.size : ''}" placeholder="e.g. 100" style="width:90px" /></label>
        <div class="stock-meta" id="bagTotal" style="grid-column:1 / -1"></div>
        <div style="grid-column:1 / -1;display:flex;gap:8px;flex-wrap:wrap"><button class="primary-button" type="submit" style="flex:1">Save</button><button class="small-button" type="button" data-combine>Combine for a batch</button><button class="small-button" type="button" data-cancel>Cancel</button></div>
      </form>`);
    rowEl.replaceWith(form);
    const f = form.elements;
    const parse = () => String(f.bags.value).replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d+(?:\.\d+)?)\s*(?:g|pcs)?\s*[x×*]\s*(\d+)\b/gi, (m, w, n) => Array(Math.min(Number(n), 200)).fill(w).join(' ')).split(/[\s,;+g]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const tick = () => { const t = parse().reduce((a, b) => a + b, 0); const b = Number(f.batch.value); form.querySelector('#bagTotal').textContent = `${f.bunit.value === 'pcs' ? 'In total: ' : parse().length + ' bag' + (parse().length === 1 ? '' : 's') + ', '}${gramsText(t, f.bunit.value)}${f.bunit.value === 'pcs' ? '' : ' together'}${f.bunit.value === 'pcs' ? piecesInGrams(t, f.piece.value) : ''}${b > 0 ? (t >= b ? ` · enough for ${Math.floor(t / b)} batch${Math.floor(t / b) === 1 ? '' : 'es'}` : ` · ${gramsText(b - t, f.bunit.value)} short of one batch`) : ''}`; };
    const pieceVis = () => {
      const pcs = f.bunit.value === 'pcs';
      form.querySelector('#pieceRow').style.display = pcs ? '' : 'none';
      f.bags.placeholder = pcs ? 'Pieces in each bag, e.g. 2, 3, 7' : 'Weight of each bag in grams, e.g. 1400, 180, 240';
      f.addW.placeholder = pcs ? 'pcs per bag' : 'g per bag';
      form.querySelector('#batchLabel').textContent = pcs ? 'One batch uses (pieces)' : 'One batch uses (g)';
      form.querySelector('#bagHelp').textContent = pcs ? 'Type how many pieces are in each bag, separated by commas, for example 2, 3, 1. Loose pieces with no bag: type the total as one number, for example 11.' : 'Type the weight of each bag in grams, separated by commas, for example 220, 220, 220.';
    };
    ['input', 'change'].forEach((ev) => form.addEventListener(ev, () => { tick(); pieceVis(); })); tick(); pieceVis();
    form.querySelector('[data-addbags]').addEventListener('click', () => {
      const w = Number(f.addW.value); const n = Math.max(1, Math.round(Number(f.addN.value) || 1));
      if (!(w > 0)) return;
      f.bags.value = [...parse(), ...Array(n).fill(w)].join(', '); f.addW.value = ''; f.addN.value = '1'; tick();
    });
    form.querySelector('[data-cancel]').addEventListener('click', () => renderStock());
    const save = async (bagsList) => {
      const name = f.name.value.trim();
      if (name.toLowerCase() !== r.name.toLowerCase()) await stockPost('/api/stock/edit', { oldName: r.name, newName: name, unit: f.bunit.value, category: f.cat.value });
      await stockPost('/api/stock/bags', { name, bags: bagsList, batch: Number(f.batch.value) || 0, category: f.cat.value, unit: f.bunit.value });
      await stockPost('/api/stock/item-meta', { name, oldName: r.name, brand: f.brand.value, size: f.bunit.value === 'pcs' ? f.piece.value : '', unit: 'g' });
    };
    form.addEventListener('submit', async (e) => { e.preventDefault(); try { await save(parse()); renderStock(); } catch (err) { /* shown */ } });
    form.querySelector('[data-combine]').addEventListener('click', async () => {
      try {
        await save(parse());
        const sg = await stockPost('/api/stock/bags/suggest', { name: f.name.value.trim(), batch: Number(f.batch.value) || undefined });
        if (sg.short > 0) { alert(`Together the bags are ${gramsText(sg.short, f.bunit.value)} short of one batch (${gramsText(sg.batch, f.bunit.value)}). Nothing was used.`); renderStock(); return; }
        if (!confirm(`Take these bags for one batch: ${sg.use.join(' + ')} (${gramsText(sg.use.reduce((a, b) => a + b, 0), f.bunit.value)}, ${gramsText(sg.over, f.bunit.value)} over ${gramsText(sg.batch, f.bunit.value)}).\n\nOK takes them out of the count. Left over: ${sg.leave.length ? sg.leave.join(' + ') : 'nothing'}.`)) { renderStock(); return; }
        await stockPost('/api/stock/bags', { name: f.name.value.trim(), bags: sg.leave, batch: sg.batch, category: f.cat.value, unit: f.bunit.value });
        renderStock();
      } catch (err) { /* shown */ }
    });
  }

  function openEdit(rowEl, r) {
    if (r.item.bags) return openBagEdit(rowEl, r);
    const form = el(`
      <form class="stock-row" style="display:grid;grid-template-columns:1fr 80px;gap:8px;align-items:center;border-color:var(--ink,#294bd4)">
        <input class="stock-edit-input" name="name" value="${escapeHtml(r.name)}" style="width:auto" required />
        <input class="stock-edit-input" name="count" type="number" step="any" inputmode="decimal" value="${r.qty}" style="width:auto" required />
        <select class="stock-edit-input" name="unit" style="width:auto">${unitOptions(r.unit)}</select>
        <select class="stock-edit-input" name="cat" style="width:auto">${catOptions(r.cat, 'Category')}</select>
        <input class="stock-edit-input" name="brand" placeholder="Brand" value="${escapeHtml(r.item.brand || '')}" maxlength="60" style="grid-column:1 / -1;width:auto" />
        <div style="grid-column:1 / -1;display:grid;grid-template-columns:1fr 80px;gap:8px"><input class="stock-edit-input" name="size" type="number" step="any" inputmode="decimal" placeholder="Size of one ${escapeHtml(r.unit || 'can')}, e.g. 330" value="${r.item.size || ''}" style="width:auto" /><select class="stock-edit-input" name="sizeUnit" style="width:auto">${sizeUnitOptions(r.item.sizeUnit || 'ml')}</select></div>
        <div style="grid-column:1 / -1;display:flex;gap:8px"><button class="primary-button" type="submit" style="flex:1">Save</button><button class="small-button" type="button" data-cancel>Cancel</button></div>
      </form>`);
    rowEl.replaceWith(form);
    form.querySelector('[name=name]').focus();
    form.querySelector('[data-cancel]').addEventListener('click', () => renderStock());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      try {
        await stockPost('/api/stock/edit', { oldName: r.name, newName: f.name.value.trim(), unit: f.unit.value, count: Number(f.count.value), category: f.cat.value });
        await stockPost('/api/stock/item-meta', { name: f.name.value.trim(), oldName: r.name, brand: f.brand.value, size: f.size.value, unit: f.sizeUnit.value });
        renderStock();
      } catch (err) { /* already shown */ }
    });
  }

  // A row built from receipts (the stock lots). The name comes from the Price Log so it is not renamed here; a recipe that says
  // "Tomato paste" takes from any "Tomato paste (brand)" together, so a change of brand needs no change to the recipe.
  function openIngredientEdit(rowEl, r) {
    const i = r.item;
    const form = el(`
      <form class="stock-row" style="display:grid;grid-template-columns:1fr 80px;gap:8px;align-items:center;border-color:var(--ink,#294bd4)">
        <div class="stock-name" style="grid-column:1 / -1">${escapeHtml(r.name)} <span class="stock-meta">· ${escapeHtml(i.left + i.unit)} left${i.pack ? ' · ' + escapeHtml(i.pack.size) + ' per ' + escapeHtml(i.pack.word) : ''}</span></div>
        <input class="stock-edit-input" name="brand" placeholder="Brand we buy, e.g. Chiangmai Winter" value="${escapeHtml(i.brand || '')}" maxlength="60" style="grid-column:1 / -1;width:auto" />
        <select class="stock-edit-input" name="cat" style="width:auto">${catOptions(r.cat)}</select>
        <input class="stock-edit-input" name="packs" type="number" step="any" inputmode="decimal" placeholder="${i.pack ? escapeHtml(i.pack.word) + 's left' : 'Packs left'}" value="${i.pack ? i.pack.packs : ''}" style="width:auto" />
        <input class="stock-edit-input" name="size" placeholder="Size of one pack, e.g. 450${escapeHtml(i.unit)}" value="${i.pack ? escapeHtml(i.pack.size) : ''}" style="width:auto" />
        <input class="stock-edit-input" name="word" placeholder="Pack word" value="${i.pack ? escapeHtml(i.pack.word) : 'bottle'}" style="width:auto" />
        <div style="grid-column:1 / -1;display:flex;gap:8px;flex-wrap:wrap"><button class="primary-button" type="submit" style="flex:1">Save</button><button class="small-button" type="button" data-swap>Different ingredient name now? Switch recipes</button><button class="small-button" type="button" data-cancel>Cancel</button></div>
      </form>`);
    rowEl.replaceWith(form);
    form.querySelector('[data-cancel]').addEventListener('click', () => renderStock());
    form.querySelector('[data-swap]').addEventListener('click', () => {
      const o = document.querySelector('#swapOld'); o.value = r.name; document.querySelector('#swapNew').focus();
      document.querySelector('#swapForm').scrollIntoView({ behavior: 'smooth' });
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      try {
        if (f.brand.value.trim() !== (i.brand || '')) await stockPost('/api/stock/ingredient-brand', { name: r.name, brand: f.brand.value });
        if (f.cat.value !== r.cat) await stockPost('/api/stock/ingredient-category', { name: r.name, category: f.cat.value });
        if (f.packs.value !== '' && Number.isFinite(Number(f.packs.value))) {
          const sizeChanged = !i.pack || f.size.value.trim() !== i.pack.size || f.word.value.trim() !== i.pack.word;
          await stockPost('/api/stock/ingredient-count', { name: r.name, packs: Number(f.packs.value), size: sizeChanged ? f.size.value.trim() : null, word: sizeChanged ? f.word.value.trim() : null });
        }
        renderStock();
      } catch (err) { /* already shown */ }
    });
  }

  const redBox = section.querySelector('#stockRed');
  if (red.length) {
    redBox.appendChild(el('<div class="intro" style="margin-top:14px"><h1 class="intro-title" style="font-size:18px;color:#b3261e">Fill asap</h1></div>'));
    const list = el('<div class="stock-list"></div>');
    red.forEach((r) => list.appendChild(drawRow(r, true)));
    redBox.appendChild(list);
  }

  const catBox = section.querySelector('#stockCats');
  [...STOCK_CATS, ''].forEach((cat) => {
    const inCat = rest.filter((r) => r.cat === cat).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    if (!inCat.length && cat) return;
    if (!inCat.length) return;
    catBox.appendChild(el(`<div class="intro" style="margin-top:18px"><h1 class="intro-title" style="font-size:18px">${cat || 'Needs a category'}</h1>${cat ? '' : '<p class="intro-body">I could not tell where these go. Pick a category once and they are sorted from then on.</p>'}</div>`));
    const list = el('<div class="stock-list"></div>');
    inCat.forEach((r) => {
      const rowEl = drawRow(r, false);
      if (!cat) {
        const sel = el(`<select class="stock-edit-input" style="width:auto;margin-left:8px">${catOptions('', 'Pick one')}</select>`);
        sel.addEventListener('change', async () => { if (!sel.value) return; try { await stockPost('/api/stock/edit', { oldName: r.name, category: sel.value }); renderStock(); } catch (err) { /* shown */ } });
        rowEl.insertBefore(sel, rowEl.querySelector('.stock-count-button'));
      }
      list.appendChild(rowEl);
    });
    catBox.appendChild(list);
  });
  if (!rows.length) catBox.appendChild(el('<div class="empty-state">No stock yet. Add your first item below.</div>'));

  // ---- add stock
  const names = section.querySelector('#stockNames');
  [...new Set([...stock.map((x) => x.itemName), ...ingredients.map((x) => x.name)])].forEach((n) => { const o = document.createElement('option'); o.value = n; names.appendChild(o); });
  const msg = section.querySelector('#addMsg');
  const say = (t) => { const m = document.querySelector('#addMsg'); if (m) m.textContent = t; };
  const syncSize = () => { section.querySelector('#addSizeRow').style.display = PACK_UNITS.includes(section.querySelector('#addUnit').value) ? 'grid' : 'none'; };
  section.querySelector('#addUnit').addEventListener('change', syncSize); syncSize();
  const syncMeat = () => { const m = section.querySelector('#addCat').value === 'Meat'; section.querySelector('#addBagRow').style.display = m ? 'grid' : 'none'; section.querySelector('#addCount').style.display = m ? 'none' : '';  if (m) section.querySelector('#addSizeRow').style.display = 'none'; else syncSize(); };
  section.querySelector('#addCat').addEventListener('change', syncMeat); syncMeat();
  const syncBagHint = () => { const pcs = section.querySelector('#addUnit').value === 'pcs'; section.querySelector('#addBags').placeholder = pcs ? 'Pieces in each bag, e.g. 2, 3, 7' : 'Weight of each bag in grams, e.g. 1400, 180, 240'; section.querySelector('#addBatch').placeholder = pcs ? 'Batch pcs' : 'Batch g'; };
  section.querySelector('#addUnit').addEventListener('change', syncBagHint); syncBagHint();
  section.querySelector('#addCategoryBtn').addEventListener('click', async () => {
    const name = prompt('Name of the new category (for example Dairy, Sauces):');
    if (!name || !name.trim()) return;
    try { await stockPost('/api/stock/category', { name: name.trim() }); await renderStock(); say(`Category added: ${name.trim()}`); } catch (err) { /* shown */ }
  });
  section.querySelector('#addStockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = section.querySelector('#addName').value.trim();
    const count = Number(section.querySelector('#addCount').value);
    const unit = section.querySelector('#addUnit').value;
    const category = section.querySelector('#addCat').value;
    const meat = category === 'Meat';
    if (!name || (!meat && !Number.isFinite(count)) || (!meat && section.querySelector('#addCount').value === '')) return;
    try {
      if (meat) {
        await stockPost('/api/stock/bags', { name, bags: section.querySelector('#addBags').value, batch: Number(section.querySelector('#addBatch').value) || 0, category: 'Meat', unit: unit === 'pcs' ? 'pcs' : 'g' });
        const brandM = section.querySelector('#addBrand').value.trim();
        if (brandM) await stockPost('/api/stock/item-meta', { name, brand: brandM, size: '', unit: 'g' });
        await renderStock(); say(`Saved: ${name}, counted in ${unit === 'pcs' ? 'pieces' : 'grams'}`); return;
      }
      await saveStock(name, count, unit, category);
      const brand = section.querySelector('#addBrand').value.trim();
      const size = section.querySelector('#addSize').value;
      if (brand || size) await stockPost('/api/stock/item-meta', { name, brand, size: PACK_UNITS.includes(unit) ? size : '', unit: section.querySelector('#addSizeUnit').value });
      section.querySelector('#addBrand').value = ''; section.querySelector('#addSize').value = '';
      await renderStock();
      say(`Saved: ${name} ${count} ${unit}`);
      const n = document.querySelector('#addName'); if (n) n.focus();
    } catch (err) { /* already shown */ }
  });
  section.querySelector('#bulkBtn').addEventListener('click', async () => {
    const lines = section.querySelector('#bulkText').value.split('\n').map((l) => l.trim()).filter(Boolean);
    const done = []; const bad = [];
    for (const line of lines) {
      const m = line.match(/^(.*?)[\s:=]+(\d+(?:\.\d+)?)\s*([A-Za-z]+)?$/);
      if (!m || !m[1].trim()) { bad.push(line); continue; }
      try { await saveStock(m[1].trim(), Number(m[2]), m[3] || 'can'); done.push(m[1].trim()); } catch (e) { bad.push(line); break; }
    }
    await renderStock();
    say(`Saved ${done.length}.` + (bad.length ? ` Not read: ${bad.join(' | ')}` : ''));
  });
  // ---- brand changes
  const swapBox = section.querySelector('#swapList');
  const dmyOf = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : 'every batch');
  if (!swaps.length) swapBox.appendChild(el('<div class="empty-state">Nothing replaced yet.</div>'));
  swaps.forEach((w) => {
    const rowEl = el(`<div class="stock-row"><div><div class="stock-name">${escapeHtml(w.line)} → ${escapeHtml(w.to)}</div><div class="stock-meta">${w.dish === '*' ? 'every dish' : escapeHtml(w.dish)} · from ${escapeHtml(dmyOf(w.from))}</div></div><button class="small-button" data-undo>Undo</button></div>`);
    rowEl.querySelector('[data-undo]').addEventListener('click', async () => {
      if (!confirm(`Go back to ${w.line} in recipes?`)) return;
      try { await stockPost('/api/ingredient-swaps/delete', { line: w.line, from: w.from }); renderStock(); } catch (err) { /* shown */ }
    });
    swapBox.appendChild(rowEl);
  });
  section.querySelector('#swapFrom').value = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  section.querySelector('#swapForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await stockPost('/api/ingredient-swaps', { old: section.querySelector('#swapOld').value, to: section.querySelector('#swapNew').value, from: section.querySelector('#swapFrom').value });
      if (r.note) alert(r.note);
      await renderStock();
      say('Saved. The recipe is unchanged.');
    } catch (err) { /* shown */ }
  });

  // ---- blends
  const listEl = section.querySelector('#blendList');
  if (!blends.length) listEl.appendChild(el('<div class="empty-state">No blends yet.</div>'));
  blends.forEach((b) => {
    const rowEl = el(`<div class="stock-row"><div><div class="stock-name">${escapeHtml(b.name)}</div><div class="stock-meta">${b.parts.map((p) => `${escapeHtml(p.name)} ${escapeHtml(String(p.parts))} part${p.parts === 1 ? '' : 's'} (${p.share}%)`).join(' + ')}</div></div><div style="display:flex;gap:6px"><button class="small-button" data-edit>Edit</button><button class="small-button" data-del>Delete</button></div></div>`);
    rowEl.querySelector('[data-edit]').addEventListener('click', () => fillBlend(b));
    rowEl.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm(`Delete the ${b.name} blend? The ingredients and their stock stay as they are.`)) return;
      try { await stockPost('/api/blends/delete', { name: b.name }); renderStock(); } catch (err) { /* shown */ }
    });
    listEl.appendChild(rowEl);
  });
  const partsBox = section.querySelector('#blendParts');
  const addPart = (name = '', parts = '') => {
    const r = el(`<div style="display:grid;grid-template-columns:1fr 80px;gap:8px;margin-bottom:6px"><input class="stock-edit-input" data-n list="stockNames" placeholder="Ingredient (as in stock)" value="${escapeHtml(name)}" style="width:auto" /><input class="stock-edit-input" data-p type="number" step="any" inputmode="decimal" placeholder="Parts" value="${escapeHtml(String(parts))}" style="width:auto" /></div>`);
    partsBox.appendChild(r);
  };
  function fillBlend(b) {
    section.querySelector('#blendName').value = b.name;
    partsBox.innerHTML = '';
    b.parts.forEach((p) => addPart(p.name, p.parts));
    section.querySelector('#blendForm').scrollIntoView({ behavior: 'smooth' });
  }
  addPart(); addPart();
  section.querySelector('#blendMore').addEventListener('click', () => addPart());
  section.querySelector('#blendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const parts = [...partsBox.children].map((r) => ({ name: r.querySelector('[data-n]').value.trim(), parts: Number(r.querySelector('[data-p]').value) })).filter((p) => p.name && p.parts > 0);
    try {
      await stockPost('/api/blends', { name: section.querySelector('#blendName').value.trim(), parts });
      await renderStock();
      say('Blend saved.');
    } catch (err) { /* shown */ }
  });
}


// Recount one ingredient. Known pack size: type packs. Unknown: ask the size of one pack and its word once, then packs.
async function recountIngredient(i) {
  let size = null; let word = null;
  if (!i.pack) {
    const ans = prompt(`Size of one pack of ${i.name} in ${i.unit}, for example 330${i.unit}. Cancel to count in ${i.unit} instead.`, '');
    if (ans === null || !ans.trim()) {
      const g = prompt(`${i.name} left in ${i.unit}:`, String(i.left));
      if (g === null || !Number.isFinite(Number(g))) return;
      try {
        await stockPost('/api/stock/ingredient-count', { name: i.name, base: Number(g) });
        renderStock();
      } catch (e) { /* shown */ }
      return;
    }
    size = ans.trim();
    word = prompt('What do you call one pack? For example can, bag, bottle.', 'can');
    if (word === null) return;
  }
  const label = i.pack ? i.pack.word : word;
  const n = prompt(`How many ${label}s of ${i.name} are left?`, i.pack ? String(i.pack.packs) : '');
  if (n === null || !n.trim() || !Number.isFinite(Number(n))) return;
  try {
    await stockPost('/api/stock/ingredient-count', { name: i.name, packs: Number(n), size, word });
    renderStock();
  } catch (err) { /* shown */ }
}

// ISO timestamp -> "15/10/2026 22:26" in Bangkok time
function formatStamp(value) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return value ? String(value) : 'never';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

async function saveStock(itemName, newCount, unit, category) {
  const res = await fetch('/api/stock/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemName, newCount, unit, category: category || '' }),
  });
  if (!res.ok) {
    let msg = 'Request failed';
    try { msg = (await res.json()).error || msg; } catch (e) { /* keep default */ }
    alert(`Stock was NOT updated: ${msg}`);
    throw new Error(msg);
  }
}

// ---- Init ----
// Numbers and Commands link back here with /#receipts, /#batchcook or /#stock.
const startTab = (location.hash || '').replace('#', '');
if (startTab === 'receipts-plan') {
  // Home button: open Receipts and land on the full shopping plan.
  renderReceipts();
  setTimeout(() => { const b = document.getElementById('shopBox'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 400);
} else if (PANELS[startTab] && startTab !== 'receipts') {
  document.querySelectorAll('.tab-button').forEach((b) => b.classList.toggle('active', b.dataset.tab === startTab));
  PANELS[startTab]();
} else {
  renderReceipts();
}
