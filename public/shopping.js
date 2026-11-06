// Shopping plan card, shared by the Receipts page and the Home (pit) box.
(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const baht = (n) => (n || n === 0 ? `฿${Math.round(n).toLocaleString('en-AU')}` : '');
  const when = (t) => (!t ? 'No trip needed' : t.inDays === 0 ? `Today, ${t.day}` : t.inDays === 1 ? `Tomorrow, ${t.day}` : `${t.day} (in ${t.inDays} days)`);

  function freshRows(items) {
    return items.map((i) => `<tr><td>${esc(i.name)}<small>keeps ${i.cover} days${i.useBy ? `, use by ${esc(i.useBy)}` : ''}</small></td>
      <td class="r">${esc(i.buyText)}<small>${esc(i.packText)}</small></td><td>${esc(i.shop)}</td><td class="r">${baht(i.estCost)}</td></tr>`).join('');
  }
  function bulkRows(groups) {
    return groups.map((g) => `<tr><td colspan="4"><b>${esc(g.shop)}</b> <small>${baht(g.estCost)}</small></td></tr>` + g.items.map((i) => `<tr>
      <td>${esc(i.name)}<small>${esc(i.monthlyText)} a month, have about ${esc(i.onHandText)}${i.runOut ? `, runs out ${esc(i.runOut)}` : ''}</small></td>
      <td class="r">${esc(i.buyText)}<small>${esc(i.packText)}</small></td><td>${i.kind === 'Packaging' ? 'Packaging' : ''}</td><td class="r">${baht(i.estCost)}</td></tr>`).join('')).join('');
  }

  // compact: the Home box shows the two trips and the totals; the full list is on the Receipts page.
  function render(box, p, { compact = false } = {}) {
    const f = p.fresh; const b = p.bulk; const t = p.trips;
    const head = `<div class="shop-top">
      <div class="shop-trip"><span>Bulk trip</span><b>${esc(when(b.tripDate))}</b><small>${b.groups.length ? `${baht(b.estCost)} across ${b.groups.length} shop${b.groups.length > 1 ? 's' : ''}, covers ${b.coverDays} days` : 'Nothing to bulk buy'}</small></div>
      <div class="shop-trip"><span>Fresh run</span><b>${esc(when(f.nextRun))}</b><small>${f.items.length ? `${baht(f.estCost)}, then every ${f.cycleDays} days` : 'No fresh items found'}</small></div>
      <div class="shop-trip"><span>Trips this month</span><b>${t.planned.total} planned</b><small>${esc(t.lastMonthLabel)}: ${t.lastMonth} trips. This month so far: ${t.thisMonthSoFar}</small></div></div>`;
    const warn = p.warnings.length ? `<ul class="shop-warn">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
    if (compact) {
      box.innerHTML = head + `<a class="shop-link" href="/#receipts">Full shopping list on the Receipts page</a>` + (warn ? `<details class="sum-more"><summary>Notes</summary>${warn}</details>` : '');
      return;
    }
    const demand = p.demand.filter((d) => d.perMonth).map((d) => `<tr><td>${esc(d.dish)}</td><td class="r">${d.perMonth}</td><td>${esc(d.basis)}</td></tr>`).join('');
    box.innerHTML = head
      + `<h3 class="shop-h">Fresh runs <small>${f.runs.length ? esc(f.runs.join(', ')) : ''}</small></h3>`
      + (f.items.length ? `<div class="log-scroll"><table class="log-table"><thead><tr><th>Item</th><th class="r">Buy</th><th>Shop</th><th class="r">Est.</th></tr></thead><tbody>${freshRows(f.items)}</tbody></table></div>` : '<p class="note">No fresh items in the plan.</p>')
      + `<h3 class="shop-h">Bulk trip, ${esc(b.tripDate ? b.tripDate.day : 'none needed')}</h3>`
      + (b.groups.length ? `<div class="log-scroll"><table class="log-table"><thead><tr><th>Item</th><th class="r">Buy</th><th></th><th class="r">Est.</th></tr></thead><tbody>${bulkRows(b.groups)}</tbody></table></div>` : '<p class="note">Nothing to bulk buy.</p>')
      + (b.enough.length ? `<details class="sum-more"><summary>Already stocked for the month (${b.enough.length})</summary>${b.enough.map((e) => `<div class="sum-row"><span>${esc(e.name)}</span><span>lasts to ${esc(e.until)}</span></div>`).join('')}</details>` : '')
      + `<details class="sum-more"><summary>How this was worked out</summary><ul class="shop-warn">${p.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
      + (demand ? `<div class="log-scroll"><table class="log-table"><thead><tr><th>Dish</th><th class="r">Portions a month</th><th>Basis</th></tr></thead><tbody>${demand}</tbody></table></div>` : '') + `</details>`
      + warn;
  }

  async function load(box, opts) {
    box.innerHTML = '<p class="note">Working out the shopping plan…</p>';
    try {
      const res = await fetch('/api/shopping/plan' + (opts && opts.refresh ? '?refresh=1' : ''));
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
      render(box, d, opts);
    } catch (err) { box.innerHTML = `<p class="note stale">${esc(err.message)}</p>`; }
  }
  window.ShoppingPlan = { render, load };
})();
