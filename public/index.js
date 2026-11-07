// The Index tab: what the order app shows right now, and the controls to change it.
// Every box saves straight to the order app (through BOH), so a change is live for customers at once.
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let S = null;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const short = (iso) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
const todayISO = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); // Bangkok date
const baht = (n) => `฿${Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 })}`;

async function api(action, body) {
  const res = await fetch(`/api/index/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  if (out.state) { S = { ...out.state, readOnly: false }; }
  return out;
}

let toastTimer = null;
function toast(msg, bad) {
  let t = $('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);padding:10px 16px;border-radius:10px;font-size:14px;z-index:9;max-width:90vw'; document.body.appendChild(t); }
  t.textContent = msg; t.style.background = bad ? '#b3261e' : '#1f6a34'; t.style.color = '#fff'; t.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 4200);
}
// Run a save. On success redraw with the fresh state the bot sent back.
async function save(action, body, okMsg) {
  try { await api(action, body); toast(okMsg || 'Saved. Live in the order app now.'); draw(); return true; } catch (err) { toast(err.message, true); return false; }
}
const lock = () => (S && S.readOnly ? 'disabled title="Read only until the bot update is live"' : '');

// ---------- announcement ----------
function annBox() {
  const a = S.announcement || {};
  const live = a.live;
  return `<div class="ix"><h3>Announcement <span class="pill ${live ? 'on' : 'off'}">${live ? 'Showing' : 'Not showing'}</span></h3>
    <p class="sub">The pop up customers see when they open the order app. While it is live it replaces the usual direct order benefits pop up.</p>
    ${a.headline ? `<p style="margin:4px 0"><b>${esc(a.headline)}</b></p><p style="margin:0 0 6px;white-space:pre-line">${esc(a.body)}</p><p class="sub">${a.startDate ? esc(dmy(a.startDate)) : 'now'} to ${a.endDate ? esc(dmy(a.endDate)) : 'until you clear it'}</p>` : '<p class="sub">No announcement set.</p>'}
    <div id="annEdit"></div>
    <div class="row"><button class="primary-button" id="annBtn" ${lock()}>${a.headline ? 'Edit announcement' : 'Write an announcement'}</button>${a.headline ? `<button class="small-button" id="annClear" ${lock()}>Clear it</button>` : ''}</div></div>`;
}
function wireAnn() {
  const a = S.announcement || {};
  $('annBtn').addEventListener('click', () => {
    $('annEdit').innerHTML = `<div style="margin:8px 0">
      <label>Headline<input id="aH" value="${esc(a.headline || '')}" maxlength="80" style="width:100%;box-sizing:border-box" /></label>
      <label style="margin-top:6px">Message<textarea id="aB">${esc(a.body || '')}</textarea></label>
      <div class="row"><label>Shows from<input type="date" id="aS" value="${esc(a.startDate || todayISO())}" /></label><label>Until (last day)<input type="date" id="aE" value="${esc(a.endDate || '')}" /></label></div>
      <div class="row"><button class="primary-button" id="aSave">Save and show now</button><button class="small-button" id="aCancel">Cancel</button></div></div>`;
    $('aH').focus();
    $('aCancel').addEventListener('click', () => { $('annEdit').innerHTML = ''; });
    $('aSave').addEventListener('click', () => save('announcement', { headline: $('aH').value, body: $('aB').value, startDate: $('aS').value || null, endDate: $('aE').value || null }));
  });
  const c = $('annClear');
  if (c) c.addEventListener('click', () => { if (confirm('Remove the announcement? Customers go back to the normal pop up.')) save('announcement/clear', {}, 'Announcement cleared.'); });
}

// ---------- opening hours ----------
function hoursBox() {
  const o = S.open || {};
  const items = [];
  (o.closures || []).forEach((c, i) => items.push(`<div class="item" style="cursor:default"><span>Closed ${esc(short(c.start))}${c.end !== c.start ? ' to ' + esc(short(c.end)) : ''}</span><button class="link" data-rm-closure="${i}" ${lock()}>Remove</button></div>`));
  (o.special || []).forEach((x, i) => items.push(`<div class="item" style="cursor:default"><span>${esc(short(x.date))}: open ${esc(x.open)} to ${esc(x.close)}</span><button class="link" data-rm-special="${i}" ${lock()}>Remove</button></div>`));
  const ov = o.override === true ? 'Forced OPEN until you switch back' : o.override === false ? 'Forced CLOSED until you switch back' : 'Following the normal hours';
  return `<div class="ix"><h3>Open and close <span class="pill ${o.isOpen ? 'on' : 'off'}">${o.isOpen === null ? 'Unknown' : o.isOpen ? 'Open now' : 'Closed now'}</span></h3>
    <p class="sub">Normal hours: ${esc(o.normalHours || '')}. ${esc(ov)}. These control right away orders. Customers can still schedule ahead on closed days.</p>
    ${items.length ? `<div>${items.join('')}</div>` : '<p class="sub">No special days or hours set.</p>'}
    <h4 style="margin:12px 0 4px;font-size:14px">Close for one or more days</h4>
    <div class="row"><label>From<input type="date" id="cF" value="${todayISO()}" /></label><label>To (last closed day)<input type="date" id="cT" value="${todayISO()}" /></label></div>
    <h4 style="margin:12px 0 4px;font-size:14px">Open late or close early on one date</h4>
    <div class="row"><label>Date<input type="date" id="sD" value="${todayISO()}" /></label><label>Opens<input type="time" id="sO" value="11:00" /></label><label>Closes<input type="time" id="sC" value="19:00" /></label></div>
    <label class="row" style="flex-direction:row;color:inherit;font-size:14px"><input type="checkbox" id="hAnn" checked /> Also post it on the announcement (replaces the current one)</label>
    <div id="hPrev" class="sub" style="margin:4px 0"></div>
    <div class="row"><button class="primary-button" id="hClose" ${lock()}>Close those days</button><button class="primary-button" id="hSpecial" ${lock()}>Set those hours</button></div>
    <div class="row"><button class="small-button" id="hForceOpen" ${lock()}>Force open now</button><button class="small-button" id="hForceClosed" ${lock()}>Force closed now</button><button class="small-button" id="hNormal" ${lock()}>Back to normal hours</button></div></div>`;
}
function hoursBody(extra) {
  const o = S.open || {};
  return { override: o.override === true ? 'open' : o.override === false ? 'closed' : null, closures: [...(o.closures || [])], special: [...(o.special || [])], ...extra };
}
function closeText(f, t) { return { headline: `Closed ${short(f)}${t !== f ? ' to ' + short(t) : ''}`, body: `We're closed ${short(f)}${t !== f ? ' to ' + short(t) : ''}, but you can still schedule your order as usual.` }; }
function specialText(d, o, c) { return { headline: `Special hours ${short(d)}`, body: `On ${short(d)} we're open ${o} to ${c} for right away orders. You can still schedule your order as usual.` }; }
async function postAnn(t, start, end) { return api('announcement', { headline: t.headline, body: t.body, startDate: start, endDate: end }); }
function wireHours() {
  const prev = () => {
    const f = $('cF').value; const t = $('cT').value;
    $('hPrev').textContent = $('hAnn').checked && f && t ? `Announcement will say: "${closeText(f, t).body}" (edit it in the box above afterwards).` : '';
  };
  ['cF', 'cT', 'hAnn'].forEach((id) => $(id).addEventListener('change', prev)); prev();
  document.querySelectorAll('[data-rm-closure]').forEach((b) => b.addEventListener('click', () => { const h = hoursBody(); h.closures.splice(Number(b.dataset.rmClosure), 1); save('hours', h, 'Closure removed.'); }));
  document.querySelectorAll('[data-rm-special]').forEach((b) => b.addEventListener('click', () => { const h = hoursBody(); h.special.splice(Number(b.dataset.rmSpecial), 1); save('hours', h, 'Special hours removed.'); }));
  $('hClose').addEventListener('click', async () => {
    const f = $('cF').value; const t = $('cT').value || f;
    if (!f) return toast('Pick the first closed day.', true);
    try {
      const h = hoursBody(); h.closures.push({ start: f, end: t });
      await api('hours', h);
      if ($('hAnn').checked) await postAnn(closeText(f, t), todayISO() < f ? todayISO() : f, t);
      toast('Closed. Right away orders stop on those days, scheduled orders carry on.'); draw();
    } catch (err) { toast(err.message, true); }
  });
  $('hSpecial').addEventListener('click', async () => {
    const d = $('sD').value; const o = $('sO').value; const c = $('sC').value;
    if (!d || !o || !c) return toast('Pick the date and both times.', true);
    try {
      const h = hoursBody(); h.special = h.special.filter((x) => x.date !== d); h.special.push({ date: d, open: o, close: c });
      await api('hours', h);
      if ($('hAnn').checked) await postAnn(specialText(d, o, c), todayISO() < d ? todayISO() : d, d);
      toast(`Saved. On ${short(d)} right away orders run ${o} to ${c}.`); draw();
    } catch (err) { toast(err.message, true); }
  });
  $('hForceOpen').addEventListener('click', () => save('hours', hoursBody({ override: 'open' }), 'Forced open.'));
  $('hForceClosed').addEventListener('click', () => save('hours', hoursBody({ override: 'closed' }), 'Forced closed.'));
  $('hNormal').addEventListener('click', () => save('hours', hoursBody({ override: null }), 'Back to the normal hours.'));
}

// ---------- promotions ----------
function promoLine(p) { return `${esc(p.label)}, ${esc(p.percentOff)}% off${p.startDate || p.endDate ? ` (${p.startDate ? esc(dmy(p.startDate)) : 'now'} to ${p.endDate ? esc(dmy(p.endDate)) : 'open ended'})` : ''}`; }
function promoBox() {
  const w = S.storewidePromo || {};
  const itemEntries = Object.entries(S.itemPromos || {});
  const nameOf = (id) => (S.menu.find((m) => m.id === id) || {}).name || id;
  return `<div class="ix"><h3>Promotions</h3>
    <p class="sub">Each item gets at most one discount. An item promo wins over the whole bill promo. Delivery fees are never discounted.</p>
    <p style="margin:6px 0"><b>Whole bill</b> <span class="pill ${w.active ? 'on' : 'off'}">${w.active ? 'On' : 'Off'}</span> ${w.label ? promoLine(w) : '<span class="sub">none set</span>'}</p>
    <div id="swEdit"></div><div class="row"><button class="primary-button" id="swBtn" ${lock()}>${w.label ? 'Edit whole bill promo' : 'Set a whole bill promo'}</button>${w.active ? `<button class="small-button" id="swOff" ${lock()}>Turn it off</button>` : ''}</div>
    <p style="margin:14px 0 4px"><b>Single item promos</b></p>
    ${itemEntries.length ? itemEntries.map(([id, p]) => `<div class="item" style="cursor:default"><span>${esc(nameOf(id))}: ${promoLine(p)}</span><button class="link" data-rm-ip="${esc(id)}" ${lock()}>Remove</button></div>`).join('') : '<p class="sub">None.</p>'}
    <div id="ipEdit"></div><div class="row"><button class="small-button" id="ipBtn" ${lock()}>Add an item promo</button></div></div>`;
}
function promoForm(p, withItem) {
  return `<div style="margin:8px 0">${withItem ? `<label>Item<select id="pI">${S.menu.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${baht(m.price)})</option>`).join('')}</select></label>` : ''}
    <div class="row"><label>Name shown to customers<input id="pL" value="${esc(p.label || '')}" placeholder="Launch Campaign" /></label><label>% off<input id="pP" type="number" min="1" max="100" step="1" value="${esc(p.percentOff || '')}" style="width:80px" /></label></div>
    <div class="row"><label>From<input type="date" id="pS" value="${esc(p.startDate || todayISO())}" /></label><label>Until (last day)<input type="date" id="pE" value="${esc(p.endDate || '')}" /></label></div>
    <div class="row"><button class="primary-button" id="pSave">Save</button><button class="small-button" id="pCancel">Cancel</button></div></div>`;
}
function wirePromo() {
  $('swBtn').addEventListener('click', () => {
    $('swEdit').innerHTML = promoForm(S.storewidePromo || {}, false);
    $('pCancel').addEventListener('click', () => { $('swEdit').innerHTML = ''; });
    $('pSave').addEventListener('click', () => save('promo/storewide', { label: $('pL').value, percentOff: $('pP').value, startDate: $('pS').value || null, endDate: $('pE').value || null, active: true }));
  });
  const off = $('swOff'); if (off) off.addEventListener('click', () => save('promo/storewide/off', {}, 'Whole bill promo turned off.'));
  $('ipBtn').addEventListener('click', () => {
    $('ipEdit').innerHTML = promoForm({}, true);
    $('pCancel').addEventListener('click', () => { $('ipEdit').innerHTML = ''; });
    $('pSave').addEventListener('click', () => save('promo/item', { id: $('pI').value, label: $('pL').value, percentOff: $('pP').value, startDate: $('pS').value || null, endDate: $('pE').value || null, active: true }));
  });
  document.querySelectorAll('[data-rm-ip]').forEach((b) => b.addEventListener('click', () => save('promo/item/clear', { id: b.dataset.rmIp }, 'Item promo removed.')));
}

// ---------- menu and prices ----------
function menuBox() {
  const cats = S.categories || [];
  const byCat = cats.map((c) => ({ c, list: S.menu.filter((m) => m.category === c.id) })).filter((x) => x.list.length);
  return `<div class="ix"><h3>Menu and prices</h3>
    <p class="sub">What the order app sells, at the direct order price. Tap an item to change its price, name or description, or to take it off the menu. Grab prices are set in Grab.</p>
    ${byCat.map(({ c, list }) => `<p style="margin:12px 0 2px"><b>${esc(c.label)}</b></p>${list.map((m) => `<div class="item" data-item="${esc(m.id)}"><span><b>${esc(m.name)}</b>${m.available ? '' : ' <span class="pill off">sold out</span>'}</span><span class="price">${baht(m.price)}</span></div><div data-slot="${esc(m.id)}"></div>`).join('')}`).join('')}
    <div id="addEdit"></div><div class="row"><button class="primary-button" id="addBtn" ${lock()}>+ Add a menu item</button></div>
    ${(S.removed || []).length ? `<p style="margin:14px 0 4px"><b>Taken off the menu</b></p>${S.removed.map((m) => `<div class="item" style="cursor:default"><span>${esc(m.name)} <span class="sub">${baht(m.price)}</span></span><button class="link" data-restore="${esc(m.id)}" ${lock()}>Put back</button></div>`).join('')}` : ''}</div>`;
}
function wireMenu() {
  document.querySelectorAll('[data-item]').forEach((row) => row.addEventListener('click', () => {
    if (S.readOnly) return toast('Read only until the bot update is live.', true);
    const m = S.menu.find((x) => x.id === row.dataset.item); const slot = document.querySelector(`[data-slot="${CSS.escape(m.id)}"]`);
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    slot.innerHTML = `<div style="background:#f7f5ef;border-radius:10px;padding:10px;margin:4px 0 8px">
      <div class="row"><label>Name<input id="mN" value="${esc(m.name)}" style="width:min(320px,70vw)" /></label><label>Price (฿)<input id="mP" type="number" min="0" step="1" value="${esc(m.price)}" style="width:90px" /></label></div>
      <label>Description<textarea id="mD">${esc(m.description)}</textarea></label>
      <div class="row"><button class="primary-button" id="mSave">Save</button><button class="small-button" id="mRemove">Take off the menu</button><button class="small-button" id="mCancel">Cancel</button></div></div>`;
    $('mCancel').addEventListener('click', () => { slot.innerHTML = ''; });
    $('mSave').addEventListener('click', () => save('menu/item', { id: m.id, name: $('mN').value, price: $('mP').value, description: $('mD').value }));
    $('mRemove').addEventListener('click', () => { if (confirm(`Take ${m.name} off the menu? Customers will no longer see it. You can put it back from the list below.`)) save('menu/remove', { id: m.id }, `${m.name} is off the menu.`); });
  }));
  document.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => save('menu/restore', { id: b.dataset.restore }, 'Put back on the menu.')));
  $('addBtn').addEventListener('click', () => {
    $('addEdit').innerHTML = `<div style="background:#f7f5ef;border-radius:10px;padding:10px;margin:8px 0">
      <div class="row"><label>Name<input id="nN" style="width:min(320px,70vw)" /></label><label>Price (฿)<input id="nP" type="number" min="0" step="1" style="width:90px" /></label><label>Category<select id="nC">${(S.categories || []).map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select></label></div>
      <label>Description (optional)<textarea id="nD"></textarea></label>
      <p class="sub">The photo can be added from the LINE group with setimage, once the item exists.</p>
      <div class="row"><button class="primary-button" id="nSave">Add to the menu</button><button class="small-button" id="nCancel">Cancel</button></div></div>`;
    $('nCancel').addEventListener('click', () => { $('addEdit').innerHTML = ''; });
    $('nSave').addEventListener('click', () => save('menu/add', { name: $('nN').value, price: $('nP').value, category: $('nC').value, description: $('nD').value }, 'Added. Customers can order it now.'));
  });
}

// ---------- delivery fees ----------
function feeBox() {
  const d = S.delivery || {};
  const cell = (id, label, v) => `<label>${label}<input id="${id}" type="number" min="0" step="1" value="${esc(v)}" style="width:90px" ${lock()} /></label>`;
  return `<div class="ix"><h3>Delivery fees</h3>
    <p class="sub">Distance from the kitchen. Beyond 10km you confirm the fee by hand in the LINE group.</p>
    <div class="row">${cell('fMin', 'Within 2km: free from (฿)', d.freeMin)}${cell('fSmall', 'Within 2km: fee under that (฿)', d.smallFee)}</div>
    <div class="row">${cell('f1', '2 to 5km (฿)', d.zone2to5)}${cell('f2', '5 to 7.5km (฿)', d.zone5to75)}${cell('f3', '7.5 to 10km (฿)', d.zone75to10)}</div>
    <div class="row"><button class="primary-button" id="fSave" ${lock()}>Save delivery fees</button></div></div>`;
}
function wireFees() {
  $('fSave').addEventListener('click', () => save('delivery', { freeMin: $('fMin').value, smallFee: $('fSmall').value, zone2to5: $('f1').value, zone5to75: $('f2').value, zone75to10: $('f3').value }, 'Delivery fees saved. New orders use them now.'));
}

function draw() {
  const note = S.readOnly ? `<div class="warn">${esc(S.note || 'Read only.')} You can see exactly what customers see, but editing switches on once the order app update is live.</div>` : '';
  $('idx').innerHTML = `<h2>Order app</h2>${note}${annBox()}${hoursBox()}${promoBox()}${menuBox()}${feeBox()}`;
  wireAnn(); wireHours(); wirePromo(); wireMenu(); wireFees();
}

(async function init() {
  try {
    const res = await fetch('/api/index/state');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    S = d; draw();
  } catch (err) { $('idx').innerHTML = `<div class="ix"><p class="sub" style="color:#b3261e">Could not load the order app: ${esc(err.message)}</p></div>`; }
})();
