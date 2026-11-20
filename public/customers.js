const $ = (id) => document.getElementById(id);
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let DATA = { list: [], summary: {} };
let filter = 'all'; let sortKey = 'lastOrder'; let sortDir = -1;

const FILTERS = [
  ['all', 'All'],
  ['ready', 'Reward ready'],
  ['near', 'One order away'],
  ['repeat', 'Repeat customers'],
  ['lapsed', 'Quiet 30+ days'],
  ['noaddr', 'No address yet'],
];
const KEEP = {
  all: () => true,
  ready: (c) => c.canLow || c.canHigh,
  near: (c) => c.orders === 4 || c.orders === 9,
  repeat: (c) => c.orders >= 2,
  lapsed: (c) => c.daysSince !== null && c.daysSince > 30 && c.orders >= 2,
  noaddr: (c) => !c.address,
};
const dateKey = (c) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(c.lastOrder || ''); return m ? +m[3] * 10000 + +m[2] * 100 + +m[1] : 0; };
const SORTS = {
  name: (c) => (c.name || '').toLowerCase(),
  orders: (c) => c.orders,
  lastOrder: dateKey,
  daysSince: (c) => (c.daysSince === null ? 1e9 : c.daysSince),
};

function dots(n) {
  // The ladder resets at a redemption, so this shows where the person is now: out of 5 first, then out of 10.
  return `${Math.min(n, 10)}/${n < 5 ? 5 : 10}`;
}

function rows() {
  const q = $('q').value.trim().toLowerCase();
  const keep = DATA.list.filter(KEEP[filter]).filter((c) => !q || [c.name, c.phone, c.address].join(' ').toLowerCase().includes(q));
  const f = SORTS[sortKey];
  return keep.sort((a, b) => (f(a) > f(b) ? 1 : f(a) < f(b) ? -1 : 0) * sortDir);
}

function draw() {
  const s = DATA.summary || {};
  $('cards').innerHTML = [
    [s.customers, 'Customers'],
    [`${s.repeat || 0} (${s.repeatPct || 0}%)`, 'Ordered 2 or more times'],
    [s.rewardReady, 'Reward ready to give'],
    [s.nearReward, 'One order from a reward'],
    [s.lapsed, 'Repeat customers quiet 30+ days'],
    [s.withAddress, 'With a saved address'],
  ].map(([v, l]) => `<div class="cardbox"><b>${esc(v === undefined ? 0 : v)}</b><span>${l}</span></div>`).join('');
  $('chips').innerHTML = FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`).join('');
  const list = rows();
  const th = (k, l, num) => `<th class="${num ? 'num' : ''}" data-s="${k}">${l}${sortKey === k ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}</th>`;
  $('tbl').innerHTML = `<thead><tr>${th('name', 'Name')}<th>Phone</th>${th('orders', 'Orders', true)}<th>Points</th><th>Reward</th>${th('lastOrder', 'Last order')}${th('daysSince', 'Days ago', true)}<th>Address</th><th>LINE</th><th></th></tr></thead><tbody>${
    list.length ? list.map((c) => `<tr><td>${esc(c.name) || '<span class="tag">no name</span>'}</td><td>${esc(c.phone)}</td><td class="num">${c.orders}</td><td class="dots">${dots(c.orders)}</td><td><span class="tag ${c.canLow || c.canHigh ? 'ready' : ''}">${esc(c.status)}</span></td><td>${esc(c.lastOrder)}</td><td class="num">${c.daysSince === null ? '' : c.daysSince}</td><td class="addr">${esc(c.address) || '<span class="tag warn">none</span>'}${c.hasPin ? '' : ' <span class="tag warn">no pin</span>'}${c.note ? `<br><span class="why" style="margin:0">Note: ${esc(c.note)}</span>` : ''}</td><td>${c.hasLine ? 'Yes' : ''}</td><td><button class="editbtn" type="button" data-edit="${c.row}">Edit</button></td></tr>`).join('') : '<tr><td colspan="10">Nobody matches.</td></tr>'
  }</tbody>`;
  $('status').textContent = `Showing ${list.length} of ${DATA.list.length} customers.`;
}

async function load() {
  $('status').textContent = 'Loading…'; $('status').className = 'status';
  try {
    const res = await fetch('/api/customers');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    DATA = body; draw();
  } catch (err) { $('status').textContent = err.message; $('status').className = 'status err'; }
}

// ---- edit, add and merge ----
function note(msg, err) { const m = $('edMsg'); if (m) { m.textContent = msg; m.className = 'msg' + (err ? ' err' : ''); } }
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}
function openEditor(row) {
  const c = row ? DATA.list.find((x) => x.row === row) : null;
  const others = DATA.list.filter((x) => !c || x.row !== c.row);
  const v = (k) => esc(c ? c[k] : '');
  $('editor').hidden = false;
  $('editor').innerHTML = `<h3>${c ? `Edit ${esc(c.name || c.phone)}` : 'Add a customer'}</h3>
    <div class="grid">
      <div><label>Name</label><input id="edName" value="${v('name')}" /></div>
      <div><label>Phone (the order app finds people by this)</label><input id="edPhone" inputmode="tel" value="${v('phone')}" /></div>
      <div><label>Orders (points)</label><input id="edOrders" type="number" min="0" max="99" value="${c ? c.orders : 0}" /></div>
      <div><label>Last order date (D/M/YYYY)</label><input id="edDate" value="${v('lastOrder')}" placeholder="19/11/2026" /></div>
      <div style="grid-column:1/-1"><label>Address</label><input id="edAddr" value="${v('address')}" /></div>
      <div style="grid-column:1/-1"><label>Rider note (shown to the customer's rider on their next order)</label><input id="edNote" value="${v('note')}" /></div>
      <div style="grid-column:1/-1"><label>Map pin: latitude, longitude (where their next order's map starts)</label><input id="edPin" value="${c && c.hasPin ? esc(c.lat + ', ' + c.lng) : ''}" placeholder="13.7368, 100.5603 or a Google Maps link" /></div>
    </div>
    <p class="why" style="margin:8px 0 0">Points reset to 0 after a reward is redeemed. The order app opens the map at this pin and fills in the address and rider note for returning customers, and they can still move it. Changing the address does not move the pin, so update both together.</p>
    <div class="row"><button id="edSave" type="button">${c ? 'Save changes' : 'Add customer'}</button><button id="edCancel" type="button">Cancel</button></div>
    ${c && others.length ? `<div class="merge"><b>Merge another customer into this one</b>
      <p class="why" style="margin:4px 0 8px">Use this for the same person listed twice. The other row is emptied and its orders are added here (change the total if they should not be added).</p>
      <div class="grid"><div><label>Merge in</label><select id="mgWho">${others.map((o) => `<option value="${o.row}" data-orders="${o.orders}" data-phone="${esc(o.phone)}">${esc(o.name || 'no name')}, ${esc(o.phone)}, ${o.orders} orders</option>`).join('')}</select></div>
      <div><label>Total orders after merging</label><input id="mgTotal" type="number" min="0" max="99" /></div></div>
      <div class="row"><button id="mgGo" type="button">Merge</button></div></div>` : ''}
    <div id="edMsg" class="msg"></div>`;
  $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const total = () => { const sel = $('mgWho'); if (sel && c) $('mgTotal').value = c.orders + Number(sel.selectedOptions[0].dataset.orders || 0); };
  if ($('mgWho')) { total(); $('mgWho').addEventListener('change', total); }
  $('edCancel').addEventListener('click', () => { $('editor').hidden = true; });
  $('edSave').addEventListener('click', async () => {
    if (c && $('edAddr').value.trim() !== (c.address || '').trim() && $('edPin').value.trim() === (c.hasPin ? c.lat + ', ' + c.lng : '') && c.hasPin
      && !confirm('You changed the address but not the map pin, so their next order will still open the map at the old spot. Save anyway?')) return;
    note('Saving…');
    try {
      await post('/api/customers/save', { pin: $('edPin').value, row: c ? c.row : undefined, expectPhone: c ? c.phone : undefined, name: $('edName').value, phone: $('edPhone').value, orders: $('edOrders').value, lastOrder: $('edDate').value, address: $('edAddr').value, note: $('edNote').value });
      $('editor').hidden = true; await load();
    } catch (err) { note(err.message, true); }
  });
  if ($('mgGo')) $('mgGo').addEventListener('click', async () => {
    const sel = $('mgWho').selectedOptions[0];
    if (!confirm(`Merge ${sel.textContent} into ${c.name || c.phone}? The other row will be emptied.`)) return;
    note('Merging…');
    try {
      await post('/api/customers/merge', { keepRow: c.row, expectKeepPhone: c.phone, dropRow: Number(sel.value), expectDropPhone: sel.dataset.phone, orders: $('mgTotal').value });
      $('editor').hidden = true; await load();
    } catch (err) { note(err.message, true); }
  });
}
$('add').addEventListener('click', () => openEditor(null));
$('tbl').addEventListener('click', (e) => { const b = e.target.closest('[data-edit]'); if (b) openEditor(Number(b.dataset.edit)); });
$('reload').addEventListener('click', load);
$('q').addEventListener('input', draw);
$('chips').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; draw(); } });
$('tbl').addEventListener('click', (e) => {
  const h = e.target.closest('[data-s]'); if (!h) return;
  if (sortKey === h.dataset.s) sortDir = -sortDir; else { sortKey = h.dataset.s; sortDir = sortKey === 'name' ? 1 : -1; }
  draw();
});
$('csv').addEventListener('click', () => {
  const head = ['Name', 'Phone', 'Orders', 'Reward', 'Last order', 'Days since', 'Address', 'On LINE'];
  const q = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
  const lines = [head.map(q).join(','), ...rows().map((c) => [c.name, `="${c.phone}"`, c.orders, c.status, c.lastOrder, c.daysSince, c.address, c.hasLine ? 'Yes' : ''].map(q).join(','))];
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'customers.csv'; a.click(); URL.revokeObjectURL(url);
});
load();
