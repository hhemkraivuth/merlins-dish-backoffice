// Shopping plan card, shared by the Receipts page and the Home (pit) box.
(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const baht = (n) => (n || n === 0 ? `฿${Math.round(n).toLocaleString('en-AU')}` : '');
  const when = (t) => (!t ? 'No trip needed' : t.inDays === 0 ? `Today, ${t.day}` : t.inDays === 1 ? `Tomorrow, ${t.day}` : `${t.day} (in ${t.inDays} days)`);

  // Each line: what is needed, what is left, what to buy, and the best price ever paid and where.
  const best = (i) => (i.bestPrice ? `${esc(i.bestPrice)}<small>${esc(i.bestShop || 'shop not recorded')}, ${esc(i.bestDate)}</small>` : '<small>no price yet</small>');
  const have = (i) => `${esc(i.onHandText)}<small>${i.handSource === 'counted' ? 'counted' : i.handSource === 'estimated' ? 'estimated' : ''}</small>`;
  const stop = (i) => `<button type="button" class="shop-stop" data-stop="${esc(i.name)}" style="font:inherit;font-size:12px;margin-top:3px;padding:2px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--muted);cursor:pointer">Stop buying</button>`;
  function freshRows(items) {
    return items.map((i) => `<tr><td>${esc(i.name)}<small>keeps ${i.cover} days${i.useBy ? `, use by ${esc(i.useBy)}` : ''}</small>${stop(i)}</td>
      <td class="r">${esc(i.needText)}</td><td class="r">${have(i)}</td>
      <td class="r"><b>${esc(i.buyText)}</b><small>${esc(i.packText)}</small></td><td>${best(i)}<small>usual: ${esc(i.shop || 'any')}</small></td><td class="r">${baht(i.estCost)}</td></tr>`).join('');
  }
  function bulkRows(groups) {
    return groups.map((g) => `<tr><td colspan="6"><b>${esc(g.shop)}</b> <small>${baht(g.estCost)}</small></td></tr>` + g.items.map((i) => `<tr>
      <td>${esc(i.name)}<small>${i.kind === 'Packaging' ? 'Packaging, ' : ''}${esc(i.monthlyText)} a month${i.runOut ? `, runs out ${esc(i.runOut)}` : ''}</small>${stop(i)}</td>
      <td class="r">${esc(i.needText)}</td><td class="r">${have(i)}</td>
      <td class="r"><b>${esc(i.buyText)}</b><small>${esc(i.packText)}</small></td><td>${best(i)}</td><td class="r">${baht(i.estCost)}</td></tr>`).join('')).join('');
  }
  // Running out (0 or below 2): first thing on the list, in red, 0 first.
  function urgentBox(items) {
    if (!items || !items.length) return '';
    const left = (u) => `${u.qty === 0 ? 'none left' : `${u.qty} ${esc(u.unit)} left`}`;
    return `<div class="shop-urgent" style="background:#fdecea;border:1px solid #e8b4ae;border-radius:10px;padding:10px 12px;margin-bottom:12px">
      <div style="color:#b3261e;font-weight:700;margin-bottom:6px">Buy first: running out (${items.length})</div>
      ${items.map((u) => `<div class="sum-row" style="color:#b3261e"><span><b>${esc(u.name)}</b>${u.category ? ` <small>${esc(u.category)}</small>` : ''}</span><span><b>${left(u)}</b></span></div>`).join('')}
    </div>`;
  }
  const HEAD = '<thead><tr><th>Item</th><th class="r">Need</th><th class="r">Have</th><th class="r">Buy</th><th>Best price ever</th><th class="r">Est.</th></tr></thead>';

  // compact: the Home box shows the two trips and the totals; the full list is on the Receipts page.
  function render(box, p, { compact = false } = {}) {
    const f = p.fresh; const b = p.bulk; const t = p.trips;
    const head = `<div class="shop-top">
      <div class="shop-trip"><span>Bulk trip</span><b>${esc(when(b.tripDate))}</b><small>${b.groups.length ? `${baht(b.estCost)} across ${b.groups.length} shop${b.groups.length > 1 ? 's' : ''}, covers ${b.coverDays} days` : 'Nothing to bulk buy'}</small></div>
      <div class="shop-trip"><span>Fresh run</span><b>${esc(when(f.nextRun))}</b><small>${f.items.length ? `${baht(f.estCost)}, then every ${f.cycleDays} days` : 'No fresh items found'}</small></div>
      <div class="shop-trip"><span>Trips this month</span><b>${t.planned.total} planned</b><small>${esc(t.lastMonthLabel)}: ${t.lastMonth} trips. This month so far: ${t.thisMonthSoFar}</small></div></div>`;
    const urgent = urgentBox(p.urgent);
    const warn = p.warnings.length ? `<ul class="shop-warn">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
    if (compact) {
      box.innerHTML = urgent + head + `<a class="shop-link" href="/#receipts">Full shopping list on the Receipts page</a>` + (warn ? `<details class="sum-more"><summary>Notes</summary>${warn}</details>` : '');
      return;
    }
    const demand = p.demand.filter((d) => d.perMonth).map((d) => `<tr><td>${esc(d.dish)}</td><td class="r">${d.perMonth}</td><td>${esc(d.basis)}</td></tr>`).join('');
    box.innerHTML = urgent + head
      + `<details class="shop-drop"><summary>Fresh run <small>${f.runs.length ? esc(f.runs.join(', ')) : ''} · ${f.items.length} items · ${baht(f.estCost)}</small></summary>`
      + (f.items.length ? `<div class="log-scroll"><table class="log-table">${HEAD}<tbody>${freshRows(f.items)}</tbody></table></div>` : '<p class="note">No fresh items in the plan.</p>') + `</details>`
      + `<details class="shop-drop"><summary>Bulk trip <small>${esc(b.tripDate ? b.tripDate.day : 'none needed')} · ${b.groups.reduce((n, g) => n + g.items.length, 0)} items · ${baht(b.estCost)}</small></summary>`
      + (b.groups.length ? `<div class="log-scroll"><table class="log-table">${HEAD}<tbody>${bulkRows(b.groups)}</tbody></table></div>` : '<p class="note">Nothing to bulk buy.</p>') + `</details>`
      + (b.enough.length ? `<details class="sum-more"><summary>Already stocked for the month (${b.enough.length})</summary>${b.enough.map((e) => `<div class="sum-row"><span>${esc(e.name)}</span><span>lasts to ${esc(e.until)}</span></div>`).join('')}</details>` : '')
      + `<details class="sum-more"><summary>How this was worked out</summary><ul class="shop-warn">${p.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
      + (demand ? `<div class="log-scroll"><table class="log-table"><thead><tr><th>Dish</th><th class="r">Portions a month</th><th>Basis</th></tr></thead><tbody>${demand}</tbody></table></div>` : '') + `</details>`
      + extras(p)
      + warn;
    wire(box);
  }

  // Stock that no recipe ingredient claims yet, and ingredients that were switched off.
  function extras(p) {
    const names = p.ingredientNames || [];
    const un = (p.unlinked || []).length ? `<details class="sum-more" open><summary>Stock not linked to a recipe ingredient (${p.unlinked.length})</summary>
      <p class="note">These are counted on the Stock page but the plan cannot tell which recipe ingredient they are, so it ignores them. Pick the ingredient and tap Link. Anything that is not an ingredient can stay here.</p>
      ${p.unlinked.map((u) => `<div class="sum-row" style="gap:6px;flex-wrap:wrap"><span><b>${esc(u.name)}</b> <small>${esc(u.count)} ${esc(u.unit)}</small></span>
        <span><select data-pick="${esc(u.key)}" style="font:inherit;font-size:14px;padding:4px"><option value="">Choose ingredient</option>${names.map((n) => `<option>${esc(n)}</option>`).join('')}</select>
        <button type="button" data-link="${esc(u.key)}" style="font:inherit;font-size:13px;padding:4px 10px;border:0;border-radius:8px;background:var(--accent);color:var(--card);cursor:pointer">Link</button></span></div>`).join('')}</details>` : '';
    const rt = (p.retired || []).length ? `<details class="sum-more"><summary>Not buying any more (${p.retired.length})</summary>${p.retired.map((r) => `<div class="sum-row"><span>${esc(r)}</span><span><button type="button" data-restore="${esc(r)}" style="font:inherit;font-size:13px;padding:4px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);cursor:pointer">Restore</button></span></div>`).join('')}</details>` : '';
    return un + rt;
  }

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Not saved');
  }
  function wire(box) {
    if (box._wired) return;
    box._wired = true;
    box.addEventListener('click', async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      try {
        if (t.dataset.stop) { if (!window.confirm(`Stop buying ${t.dataset.stop}? It leaves the plan. Recipes and stock are not changed, and you can restore it under "Not buying any more".`)) return; await post('/api/shopping/retire', { name: t.dataset.stop }); }
        else if (t.dataset.restore) await post('/api/shopping/retire', { name: t.dataset.restore, undo: true });
        else if (t.dataset.link) { const sel = box.querySelector(`select[data-pick="${CSS.escape(t.dataset.link)}"]`); if (!sel || !sel.value) return; await post('/api/shopping/link', { stock: t.dataset.link, to: sel.value }); }
        else return;
        load(box, { refresh: true });
      } catch (err) { window.alert(err.message); }
    });
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
