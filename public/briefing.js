// The staff briefing pop up, the team to do card and the Today strip. Loaded on every page; the card and strip only exist on Home.
// Away from Home a small Team report button sits bottom right, and the pop up opens by itself when there is something new
// (or, once a day per tab, when a task is overdue or due today).
// On open, the team "runs up" with anything new since Lily last closed the window. Closing it (Noted, the cross, Esc or a tap outside) marks it all as noted.
// Below the reports sits the to do list, with due dates. The same list also lives on the Home page as the To do card.
(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let data = { reports: [], todos: [], done: [], teams: ['Me'], today: '', riderMissing: 0 };
  let modal = null;

  const css = document.createElement('style');
  css.textContent = `
  .bf-back{position:fixed;inset:0;background:rgba(20,20,30,.55);display:flex;align-items:flex-end;justify-content:center;z-index:50;padding:0}
  @media(min-width:600px){.bf-back{align-items:center;padding:16px}}
  .bf-card{background:var(--card,#fff);color:var(--ink,#222);width:100%;max-width:520px;max-height:88vh;overflow:auto;border-radius:16px 16px 0 0;border:3px solid var(--blue,#2b4c9b);padding:14px 16px 16px;box-shadow:0 10px 40px rgba(0,0,0,.3)}
  @media(min-width:600px){.bf-card{border-radius:16px}}
  .bf-head{display:flex;gap:10px;align-items:flex-end;margin-bottom:10px}
  .bf-pig{width:58px;height:58px;flex:0 0 auto}
  .bf-bubble{position:relative;flex:1;background:#fff8d6;border:2px solid var(--blue,#2b4c9b);border-radius:14px;padding:8px 12px;font-weight:700;font-size:15px;line-height:1.3}
  .bf-bubble:before{content:"";position:absolute;left:-9px;bottom:12px;border:8px solid transparent;border-right-color:var(--blue,#2b4c9b);border-left:0}
  .bf-bubble small{display:block;font-weight:500;font-size:12px;color:var(--muted,#666);margin-top:2px}
  .bf-x{border:0;background:none;font-size:26px;line-height:1;cursor:pointer;color:var(--muted,#666);align-self:flex-start;padding:0 4px}
  .bf-card h3{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#666);margin:14px 0 6px}
  .bf-rep{border:1px solid var(--line,#ddd);border-left:5px solid var(--red,#c0392b);border-radius:10px;padding:8px 10px;margin:0 0 8px;font-size:14px;line-height:1.35}
  .bf-rep b{display:block;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#666);margin-bottom:2px}
  .bf-rep p{margin:2px 0}
  .bf-rep a{color:var(--blue,#2b4c9b);font-weight:600}
  .bf-none{font-size:14px;color:var(--muted,#666);margin:0 0 6px}
  .bf-todo{display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--line,#ddd);font-size:14px}
  .bf-todo input[type=checkbox]{width:20px;height:20px;margin-top:1px;flex:0 0 auto}
  .bf-todo .t{flex:1;line-height:1.3}
  .bf-todo .m{display:block;font-size:12px;color:var(--muted,#666)}
  .bf-todo .m.over{color:var(--red,#c0392b);font-weight:700}
  .bf-todo .m.now{color:#b26a00;font-weight:700}
  .bf-todo .rm{border:0;background:none;color:var(--muted,#666);cursor:pointer;font-size:13px;text-decoration:underline}
  .bf-add{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .bf-add input,.bf-add select{font:inherit;font-size:14px;padding:7px 9px;border:1px solid var(--line,#ccc);border-radius:8px;background:var(--card,#fff);color:inherit;min-width:0}
  .bf-add .tx{flex:1 1 100%}
  .bf-btn{font:inherit;font-size:14px;font-weight:700;padding:8px 16px;border:0;border-radius:999px;background:var(--blue,#2b4c9b);color:#fff;cursor:pointer}
  .bf-btn.alt{background:none;color:var(--blue,#2b4c9b);border:1px solid var(--blue,#2b4c9b)}
  .bf-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
  .bf-err{color:var(--red,#c0392b);font-size:13px;margin:6px 0 0;min-height:16px}
  .bf-fab{position:fixed;right:14px;bottom:14px;z-index:40;display:flex;align-items:center;gap:6px;font:inherit;font-size:14px;font-weight:700;padding:8px 14px 8px 10px;border:2px solid var(--blue,#2b4c9b);border-radius:999px;background:#fff8d6;color:var(--blue,#2b4c9b);cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.2)}
  .bf-fab svg{width:26px;height:26px}
  .bf-fab .n{min-width:20px;height:20px;line-height:20px;text-align:center;border-radius:999px;background:var(--red,#c0392b);color:#fff;font-size:12px;padding:0 5px}
  .bf-strip{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:0 0 14px;padding:9px 12px;border:1px solid var(--line,#ddd);border-radius:12px;background:var(--card,#fff);font-size:14px}
  .bf-strip b{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#666);margin-right:2px}
  .bf-chip{font:inherit;font-size:13px;font-weight:700;padding:4px 10px;border-radius:999px;border:1px solid var(--line,#ccc);background:none;color:inherit;cursor:pointer;text-decoration:none}
  .bf-chip.bad{border-color:var(--red,#c0392b);color:var(--red,#c0392b)}
  .bf-chip.warn{border-color:#b26a00;color:#b26a00}
  .bf-chip.info{border-color:var(--blue,#2b4c9b);color:var(--blue,#2b4c9b)}
  .bf-chip.ok{border-color:#1f6a34;color:#1f6a34;cursor:default}
  details.bf-done{margin-top:8px;font-size:13px}
  details.bf-done .bf-todo{color:var(--muted,#666);text-decoration:line-through}
  `;
  document.head.appendChild(css);

  async function call(url, body) {
    const res = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
    return out;
  }

  function todoRow(t, done) {
    const cls = t.overdue ? 'over' : t.today ? 'now' : '';
    return `<div class="bf-todo"><input type="checkbox" data-done="${esc(t.id)}" ${done ? 'checked' : ''} aria-label="Done"><span class="t">${esc(t.text)}<span class="m ${done ? '' : cls}">${esc(t.team)}${done ? '' : ', ' + esc(t.dueText)}</span></span><button class="rm" data-rm="${esc(t.id)}" type="button">Delete</button></div>`;
  }
  function todoList() {
    const open = data.todos.length ? data.todos.map((t) => todoRow(t, false)).join('') : '<p class="bf-none">Nothing on the list.</p>';
    const done = data.done.length ? `<details class="bf-done"><summary>Done (${data.done.length})</summary>${data.done.map((t) => todoRow({ ...t, dueText: '' }, true)).join('')}</details>` : '';
    return open + done;
  }
  function addForm() {
    return `<div class="bf-add"><input class="tx" data-f="text" maxlength="200" placeholder="What needs doing, for example shoot the Thanksgiving dish" aria-label="Task"><select data-f="team" aria-label="Who">${data.teams.map((t) => `<option>${esc(t)}</option>`).join('')}</select><input type="date" data-f="due" aria-label="Due date"><button class="bf-btn" data-add type="button">Add</button></div><p class="bf-err" data-err></p>`;
  }

  // Wires the to do controls inside one container (the pop up or the Home card).
  function wire(root, redraw) {
    const err = (m) => { const e = root.querySelector('[data-err]'); if (e) e.textContent = m || ''; };
    const run = async (url, body) => { try { const out = await call(url, body); data.todos = out.todos; data.done = out.done; redraw(); } catch (e) { err(e.message); } };
    root.querySelectorAll('[data-done]').forEach((c) => c.addEventListener('change', () => run('/api/todos/done', { id: c.dataset.done, done: c.checked })));
    root.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => run('/api/todos/delete', { id: b.dataset.rm })));
    const add = root.querySelector('[data-add]');
    if (add) add.addEventListener('click', () => {
      const f = (n) => root.querySelector(`[data-f="${n}"]`).value;
      run('/api/todos', { text: f('text'), team: f('team'), due: f('due') });
    });
  }

  function repHtml(r) {
    return `<div class="bf-rep"><b>${esc(r.team)}</b>${r.lines.map((l) => `<p>${esc(l)}</p>`).join('')}${r.href ? `<p><a href="${esc(r.href)}">Open it</a></p>` : ''}</div>`;
  }

  async function noted() {
    const keys = data.reports.map((r) => r.key);
    close();
    if (keys.length) { try { await call('/api/briefing/seen', { keys }); data.reports = []; } catch (e) { /* it will simply show again next time */ } }
    drawStrip(); drawFab();
  }
  function close() { if (modal) { document.removeEventListener('keydown', onKey); modal.remove(); modal = null; } }
  function onKey(e) { if (e.key === 'Escape') noted(); }

  function draw() {
    if (!modal) return;
    const n = data.reports.length;
    const late = data.todos.filter((t) => t.overdue).length;
    const line = n ? `${n} ${n === 1 ? 'thing' : 'things'} to tell you.` : 'Nothing new since you last looked.';
    modal.querySelector('.bf-card').innerHTML = `
      <div class="bf-head"><svg class="bf-pig" viewBox="0 0 64 64" aria-hidden="true"><circle cx="14" cy="14" r="7" fill="#f4a3b5"/><circle cx="50" cy="14" r="7" fill="#f4a3b5"/><circle cx="32" cy="34" r="25" fill="#f7b8c6" stroke="#2b4c9b" stroke-width="3"/><ellipse cx="32" cy="42" rx="11" ry="8" fill="#f08aa3" stroke="#2b4c9b" stroke-width="2"/><circle cx="28" cy="42" r="2" fill="#2b4c9b"/><circle cx="36" cy="42" r="2" fill="#2b4c9b"/><circle cx="22" cy="29" r="3" fill="#2b4c9b"/><circle cx="42" cy="29" r="3" fill="#2b4c9b"/></svg><div class="bf-bubble">Boss, got a minute?<small>${esc(data.today)}. ${esc(line)}${late ? ` ${late} overdue.` : ''}</small></div><button class="bf-x" data-x type="button" aria-label="Close">×</button></div>
      <h3>Reports</h3>${n ? data.reports.map(repHtml).join('') : '<p class="bf-none">All quiet.</p>'}
      <h3>To do</h3><div data-list>${todoList()}</div>${addForm()}
      <div class="bf-foot"><button class="bf-btn" data-noted type="button">Noted</button></div>`;
    modal.querySelector('[data-x]').addEventListener('click', noted);
    modal.querySelector('[data-noted]').addEventListener('click', noted);
    wire(modal.querySelector('.bf-card'), () => { draw(); drawCard(); drawStrip(); drawFab(); });
  }

  function open() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'bf-back';
    modal.innerHTML = '<div class="bf-card" role="dialog" aria-modal="true" aria-label="Team report"></div>';
    modal.addEventListener('click', (e) => { if (e.target === modal) noted(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(modal);
    draw();
  }

  // The To do card on the Home page.
  function drawCard() {
    const box = document.getElementById('todoBox');
    if (!box) return;
    box.querySelector('[data-card]').innerHTML = `<div data-list>${todoList()}</div>${addForm()}`;
    wire(box.querySelector('[data-card]'), () => { drawCard(); draw(); drawStrip(); });
  }

  // The Today strip on Home: one line of what needs the owner today.
  function drawStrip() {
    const box = document.getElementById('todayStrip');
    if (!box) return;
    const late = data.todos.filter((t) => t.overdue).length;
    const now = data.todos.filter((t) => t.today).length;
    const n = data.reports.length;
    const rider = data.riderMissing || 0;
    const chips = [];
    if (late) chips.push(`<button class="bf-chip bad" type="button" data-open>${late} overdue</button>`);
    if (now) chips.push(`<button class="bf-chip warn" type="button" data-open>${now} due today</button>`);
    if (n) chips.push(`<button class="bf-chip info" type="button" data-open>${n} new ${n === 1 ? 'report' : 'reports'}</button>`);
    if (rider) chips.push(`<a class="bf-chip warn" href="commands.html#deliveryCost">${rider} rider ${rider === 1 ? 'fee' : 'fees'} to log</a>`);
    box.innerHTML = `<div class="bf-strip"><b>Today</b>${chips.length ? chips.join('') : '<span class="bf-chip ok">Nothing needs you today</span>'}</div>`;
    box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', open));
  }

  // The floating Team report button on every page except Home.
  const PIG = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="14" cy="14" r="7" fill="#f4a3b5"/><circle cx="50" cy="14" r="7" fill="#f4a3b5"/><circle cx="32" cy="34" r="25" fill="#f7b8c6" stroke="#2b4c9b" stroke-width="3"/><ellipse cx="32" cy="42" rx="11" ry="8" fill="#f08aa3" stroke="#2b4c9b" stroke-width="2"/><circle cx="28" cy="42" r="2" fill="#2b4c9b"/><circle cx="36" cy="42" r="2" fill="#2b4c9b"/><circle cx="22" cy="29" r="3" fill="#2b4c9b"/><circle cx="42" cy="29" r="3" fill="#2b4c9b"/></svg>';
  let fab = null;
  function drawFab() {
    if (document.getElementById('todoBox') || document.getElementById('teamReport')) return; // Home has its own button
    if (!fab) {
      fab = document.createElement('button');
      fab.type = 'button'; fab.className = 'bf-fab'; fab.setAttribute('aria-label', 'Team report');
      fab.addEventListener('click', async () => { try { data = await call('/api/briefing'); } catch (e) { /* keep what we have */ } open(); drawFab(); });
      document.body.appendChild(fab);
    }
    const count = data.reports.length + data.todos.filter((t) => t.overdue || t.today).length;
    fab.innerHTML = `${PIG}<span>Team report</span>${count ? `<span class="n">${count}</span>` : ''}`;
  }

  async function init() {
    const home = Boolean(document.getElementById('todoBox'));
    const btn = document.getElementById('teamReport');
    if (btn) btn.addEventListener('click', async () => { try { data = await call('/api/briefing'); } catch (e) { /* keep what we have */ } drawCard(); drawStrip(); open(); });
    try { data = await call('/api/briefing'); } catch (e) { return; }
    drawCard(); drawStrip(); drawFab();
    const urgent = data.todos.some((t) => t.overdue || t.today);
    if (home) { if (data.reports.length || urgent) open(); return; }
    // Other pages: anything new always opens it (closing marks it noted). Overdue and due today open it once a day per tab.
    let shownToday = false;
    try { shownToday = sessionStorage.getItem('bfDay') === data.today; } catch (e) { /* storage blocked */ }
    if (data.reports.length || (urgent && !shownToday)) {
      try { sessionStorage.setItem('bfDay', data.today); } catch (e) { /* fine */ }
      open();
    }
  }
  init();
})();
