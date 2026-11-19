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
  const on = Math.min(n, 10);
  return '●'.repeat(on) + '○'.repeat(Math.max(0, (n < 5 ? 5 : 10) - on));
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
  $('tbl').innerHTML = `<thead><tr>${th('name', 'Name')}<th>Phone</th>${th('orders', 'Orders', true)}<th>Points</th><th>Reward</th>${th('lastOrder', 'Last order')}${th('daysSince', 'Days ago', true)}<th>Address</th><th>LINE</th></tr></thead><tbody>${
    list.length ? list.map((c) => `<tr><td>${esc(c.name) || '<span class="tag">no name</span>'}</td><td>${esc(c.phone)}</td><td class="num">${c.orders}</td><td class="dots">${dots(c.orders)}</td><td><span class="tag ${c.canLow || c.canHigh ? 'ready' : ''}">${esc(c.status)}</span></td><td>${esc(c.lastOrder)}</td><td class="num">${c.daysSince === null ? '' : c.daysSince}</td><td class="addr">${esc(c.address) || '<span class="tag warn">none</span>'}</td><td>${c.hasLine ? 'Yes' : ''}</td></tr>`).join('') : '<tr><td colspan="9">Nobody matches.</td></tr>'
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
