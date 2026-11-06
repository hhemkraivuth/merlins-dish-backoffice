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
        <h1 class="intro-title">Weekly Receipts</h1>
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
        <h1 class="intro-title">Batch Cook</h1>
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
        <p class="intro-body">Packaging, cans and counted packs. Tap a number to recount; your number wins from that point on.</p>
      </div>
      <div class="intro" style="margin-top:18px">
        <h1 class="intro-title" style="font-size:18px">Packaging and cans</h1>
      </div>
      <div class="stock-list" id="stockList"></div>
      <div class="intro" style="margin-top:18px">
        <h1 class="intro-title" style="font-size:18px">Ingredient stock</h1>
        <p class="intro-body">What is left of each ingredient, built from receipts and cook notes. Tap a number to recount. Where a pack size is known it counts in packs (cans, bags), otherwise in g or ml.</p>
      </div>
      <div class="stock-list" id="ingredientList"><div class="loading">Loading…</div></div>
      <button class="primary-button" id="addStockBtn" style="margin-top:8px">+ Add item</button>
      <button class="primary-button" id="seedPkgBtn" style="margin-top:8px">Add the 4 packaging items (at 0)</button>
    </section>
  `);
  main.appendChild(section);

  const list = section.querySelector('#stockList');
  if (!stock.length) {
    list.innerHTML = '<div class="empty-state">No stock items yet — add your first one below.</div>';
  }
  stock.forEach((item) => list.appendChild(renderStockRow(item)));

  fetch('/api/stock/ingredients').then((r) => r.json()).then((d) => {
    const box = section.querySelector('#ingredientList');
    if (d.error) { box.innerHTML = `<div class="empty-state">${escapeHtml(d.error)}</div>`; return; }
    const items = d.items || [];
    if (!items.length) { box.innerHTML = '<div class="empty-state">No ingredient stock yet. It appears after a receipt (without "prices only") or an "opening" count in LINE.</div>'; return; }
    box.innerHTML = '';
    items.forEach((i) => {
      const row = el(`
      <div class="stock-row">
        <div>
          <div class="stock-name">${escapeHtml(i.name)}${i.low ? ' <span style="color:#b3261e;font-weight:600">LOW</span>' : ''}</div>
          <div class="stock-meta">${i.pack ? escapeHtml(i.left + i.unit) + ' · ' : 'tap to count in packs · '}oldest bought ${escapeHtml(i.oldest)}${i.level ? ' · alert below ' + escapeHtml(i.level) : ''}</div>
        </div>
        <button class="stock-count-button">${escapeHtml(i.pack ? i.pack.label : i.left + i.unit)}</button>
      </div>`);
      row.querySelector('button').addEventListener('click', () => recountIngredient(i));
      box.appendChild(row);
    });
  }).catch((err) => { section.querySelector('#ingredientList').innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; });

  section.querySelector('#seedPkgBtn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/stock/seed-packaging', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      alert(data.added.length ? `Added at 0: ${data.added.join(', ')}. Now set the real counts.` : 'All 4 packaging items are already there. Nothing changed.');
      renderStock();
    } catch (err) { alert(`Nothing was added: ${err.message}`); }
  });
  section.querySelector('#addStockBtn').addEventListener('click', () => {
    const name = prompt('Item name:');
    if (!name) return;
    const unit = prompt('Unit (e.g. Set, can, pcs):', '') || '';
    const count = prompt('Starting count:', '0');
    if (count == null) return;
    saveStock(name, Number(count), unit).then(() => renderStock()).catch(() => {});
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
        const res = await fetch('/api/stock/ingredient-count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: i.name, base: Number(g) }) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Not saved');
        renderStock();
      } catch (e) { alert(`Not saved: ${e.message}`); }
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
    const res = await fetch('/api/stock/ingredient-count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: i.name, packs: Number(n), size, word }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Not saved');
    renderStock();
  } catch (err) { alert(`Not saved: ${err.message}`); }
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
// Numbers and Commands link back here with /#receipts, /#batchcook or /#stock.
const startTab = (location.hash || '').replace('#', '');
if (PANELS[startTab] && startTab !== 'receipts') {
  document.querySelectorAll('.tab-button').forEach((b) => b.classList.toggle('active', b.dataset.tab === startTab));
  PANELS[startTab]();
} else {
  renderReceipts();
}
