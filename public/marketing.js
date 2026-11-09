const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TITLES = { Competitor: 'Competitors', Inspo: 'Inspo accounts', Trend: 'Trends', 'Ad draft': 'Ad drafts (nothing runs without your approval)', Date: 'Dates and festivals' };

// "Key: ..." and "Borrow: ..." each go on their own line so long summaries are easier to read.
// Key is the one thing to know. Borrow is the one idea from an inspo account worth copying for Merlin's.
function parts(text) {
  const t = String(text || '');
  const re = /(?:^|\s)(Key|Borrow):\s*/g;
  const out = { summary: '', Key: '', Borrow: '' };
  let label = 'summary'; let last = 0; let m;
  while ((m = re.exec(t))) { out[label] = (out[label] ? out[label] + ' ' : '') + t.slice(last, m.index).trim(); label = m[1]; last = m.index + m[0].length; }
  out[label] = (out[label] ? out[label] + ' ' : '') + t.slice(last).trim();
  return out;
}
function body(text) {
  const p = parts(text);
  return (p.summary ? esc(p.summary) + '<br>' : '') + (p.Key ? `<b>Key:</b> ${esc(p.Key)}<br>` : '') + (p.Borrow ? `<b>Borrow:</b> ${esc(p.Borrow)}<br>` : '');
}

function note(n) {
  const draft = n.kind === 'Ad draft' && /draft/i.test(n.status) ? '<span class="draft">Draft</span>' : '';
  return `<div class="note"><b>${esc(n.title)}${draft}</b>${body(n.note)}<small>${esc(n.date)}</small></div>`;
}

// Full history as a CSV for Excel, same approach as the Numbers page. Key is split into its own column.
let HISTORY = [];
function downloadNotes() {
  const cell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ['Date', 'Kind', 'Title', 'Summary', 'Key', 'Borrow', 'Status'];
  const rows = HISTORY.map((n) => { const p = parts(n.note); return [n.date, n.kind, n.title, p.summary, p.Key, p.Borrow, n.status]; });
  const blob = new Blob(['\ufeff' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const t = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `merlins-dish-marketing-notes-${String(t.getDate()).padStart(2, '0')}-${String(t.getMonth() + 1).padStart(2, '0')}-${t.getFullYear()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  return rows.length;
}


// ---- Weekly Insight (phone first): three moves, the numbers, who moved, borrow cards, price lanes, dates ----
const DMY = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const dayNum = (text) => { const m = String(text || '').match(DMY); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) / 864e5 : null; };
const shopName = (t) => String(t || '').replace(/\s*\(Grab\)\s*/i, '').replace(/\s*\(content plan\)\s*/i, '').trim();

function statusOf(n) {
  const s = `${n.status || ''}`;
  if (/opening/i.test(s)) return ['Opening', 'open'];
  if (/not read/i.test(s) || /not read yet/i.test(n.note)) return ['Not read yet', ''];
  return ['Watch', 'watch'];
}
const RANK = { Opening: 0, Watch: 1, 'Not read yet': 2 };

function moveCard(n, i) {
  const p = parts(n.note);
  const chip = p.Borrow ? `<span class="chip borrow">Borrow from ${esc(p.Borrow)}</span>` : (n.status ? `<span class="chip open">${esc(n.status)}</span>` : '');
  return `<details class="card move"><summary><span class="num">${i + 1}</span><span class="name">${esc(n.title)}</span><span class="open"></span></summary><div class="more">${p.summary ? `<span>${esc(p.summary)}</span>` : ''}${chip}</div></details>`;
}

function whoMoved(list) {
  const rows = list.map((n) => { const [label, cls] = statusOf(n); return { n, label, cls }; }).sort((a, b) => RANK[a.label] - RANK[b.label]);
  return rows.map(({ n, label, cls }, i) => {
    const p = parts(n.note);
    const grab = !/^\s*@/.test(n.title);
    const hint = (p.Key || p.summary || '').split(/(?<=\.)\s/)[0];
    return `<details class="card" ${i === 0 && label === 'Opening' ? 'open' : ''}><summary><span class="row"><span class="name">${esc(grab ? shopName(n.title) : n.title)}<span class="chip tag">${grab ? 'Grab' : 'Instagram'}</span></span><span class="chip ${cls}">${label}</span></span><span class="hint">${esc(hint)}</span></summary><p class="more">${p.Key ? `<b>Key:</b> ${esc(p.Key)}` : esc(p.summary)}</p></details>`;
  }).join('');
}

function borrowCards(list) {
  const sorted = [...list].sort((a, b) => (/hangrybeefnoodle/i.test(b.title) ? 1 : 0) - (/hangrybeefnoodle/i.test(a.title) ? 1 : 0));
  return sorted.map((n, i) => {
    const p = parts(n.note);
    const first = i === 0 && /hangrybeefnoodle/i.test(n.title);
    const kind = /content plan/i.test(n.title) ? 'Content plan inspo' : 'Visual inspo';
    return `<article class="card plain ${first ? 'first' : ''}">${first ? '<span class="chip first">Borrow first</span>' : ''}<span class="name">${esc(shopName(n.title))}</span><span class="hint">${kind}</span><span style="font-size:16px;line-height:1.4">${esc(p.Borrow || p.summary)}</span></article>`;
  }).join('');
}

function priceLanes(grab, merlin) {
  const rows = [];
  if (merlin && merlin.grab) rows.push({ name: "Merlin's", lo: merlin.grab.lo, hi: merlin.grab.hi, us: true, extra: `${baht(merlin.direct.lo)} to ${baht(merlin.direct.hi)} on the order bot` });
  for (const n of grab) {
    const m = String(n.note).match(/฿\s?(\d+)\s*(?:to|-|–)\s*฿?\s?(\d+)/);
    if (m) rows.push({ name: shopName(n.title), lo: +m[1], hi: +m[2] });
  }
  if (rows.length < 1) return '';
  const max = Math.ceil(Math.max(...rows.map((r) => r.hi)) / 50) * 50;
  const pct = (v) => Math.max(0, Math.min(100, (v / max) * 100));
  const lanes = rows.map((r) => `<div class="lane ${r.us ? 'us' : ''}"><div class="lh"><span class="ln">${esc(r.name)}${r.us ? ' on Grab' : ''}</span><span class="lr">${baht(r.lo)} to ${baht(r.hi)}</span></div><div class="track"><div class="bar" style="left:${pct(r.lo).toFixed(1)}%;width:${Math.max(pct(r.hi) - pct(r.lo), 2).toFixed(1)}%"></div></div>${r.extra ? `<div class="lr" style="margin-top:4px">${esc(r.extra)}</div>` : ''}</div>`).join('');
  const foot = merlin ? "Merlin's Grab prices are the order bot menu plus the ฿25 Grab markup, mains only." : "Merlin's price range is not available right now, the order bot did not answer.";
  return `<h2>Price lanes on Grab</h2><div class="lanes">${lanes}<div class="axis"><span style="left:0">${baht(0)}</span><span style="left:50%;transform:translateX(-50%)">${baht(max / 2)}</span><span style="right:0">${baht(max)}</span></div><p class="sub" style="margin:0">${esc(foot)} Competitor ranges are read from the latest Grab notes.</p></div>`;
}
const baht = (n) => `฿${Math.round(n).toLocaleString('en-AU')}`;

function insightTop(d) {
  const today = dayNum(d.today);
  const recent = (n) => { const x = dayNum(n.date); return x !== null && today - x <= 7; };
  const moves = (d.notes.Move || []).filter(recent).slice(0, 3);
  const comp = d.notes.Competitor || [];
  const movedNow = comp.filter((n) => recent(n) && statusOf(n)[0] !== 'Not read yet');
  const next = (d.dates || [])[0];
  const tile = (lab, val, ctx) => `<section class="tile"><span class="lab">${esc(lab)}</span><span class="val">${esc(val)}</span><span class="ctx">${esc(ctx)}</span></section>`;
  return '<h2>Three moves this week</h2>'
    + (moves.length ? `<div class="stack">${moves.map(moveCard).join('')}</div>` : '<p class="empty">No moves yet. The Sunday check writes three each week.</p>')
    + '<h2>The numbers</h2>'
    + `<div class="tiles">${tile('Orders this week', String(d.week.orders), `Grab ${d.week.grab || 0}, LINE ${d.week.line || 0}, Instagram ${d.week.ig || 0}`)}${tile('Orders this month', String(d.month.orders), `Grab ${d.month.grab || 0}, LINE ${d.month.line || 0}, Instagram ${d.month.ig || 0}`)}${tile('Next date', next ? `${next.away} days` : 'None', next ? `${next.label}, ${next.day} ${next.date}` : 'Nothing fixed in the next 60 days')}${tile('Competitor moves', String(movedNow.length), movedNow.slice(0, 3).map((n) => shopName(n.title)).join(', ') || 'None this week')}</div>`;
}

function insightMid(d) {
  const comp = d.notes.Competitor || [];
  const grab = comp.filter((n) => !/^\s*@/.test(n.title));
  const inspo = d.notes.Inspo || [];
  return (comp.length ? `<h2>Who moved</h2><p class="sub" style="margin:0">Tap a row for its Key. Opening means a gap we can use, Watch means keep an eye on it.</p><div class="stack">${whoMoved(comp)}</div>` : '')
    + (inspo.length ? `<h2>Borrow cards</h2><div class="stack">${borrowCards(inspo)}</div>` : '')
    + priceLanes(grab, d.merlin);
}

function datesAhead(d) {
  return '<h2>Dates ahead</h2>' + ((d.dates || []).length ? `<div class="datelist">${d.dates.slice(0, 6).map((x) => `<div class="d"><div class="dd"><span class="wd">${esc(x.day)}</span><span class="dn">${esc(x.date.slice(0, 5))}</span></div><div><div class="dl">${esc(x.label)}</div><div class="da">${x.away} days</div></div></div>`).join('')}</div>` : '<p class="empty">Nothing fixed in the next 60 days.</p>');
}

function draw(d) {
  HISTORY = d.history || [];
  const EMPTY = { Competitor: 'Updated every Sunday night.', Inspo: 'Updated every Sunday night.', Trend: 'Updated every Sunday night.', 'Ad draft': 'Drafts only, nothing runs without your approval.', Date: 'Festivals and holidays, updated every Sunday night.' };
  const section = (title, list, empty) => `<div class="box"><details ${list.length ? 'open' : ''}><summary>${esc(title)} (${list.length})</summary>${list.length ? list.map(note).join('') : `<p class="sub">${esc(empty)}</p>`}</details></div>`;
  // Competitors: Grab shops first, then the Instagram accounts (their title starts with @). Nothing is cut off.
  const cl = d.notes.Competitor || [];
  const social = cl.filter((n) => /^\s*@/.test(n.title));
  const grab = cl.filter((n) => !/^\s*@/.test(n.title));
  const status = `<p class="big ${d.auditDue ? 'due' : ''}">${d.auditDue ? 'Check pending' : 'Up to date'}</p><p class="sub">${esc(d.auditNote)} Claude runs it every Sunday at 11pm, the summary lands here.</p>`;
  const competitors = `<div class="box"><h3>Grab competitors</h3>${status}<details ${grab.length ? 'open' : ''}><summary>Grab shops (${grab.length})</summary>${grab.length ? grab.map(note).join('') : '<p class="sub">Add a screenshot folder per shop in Competitor Grab screenshots. Updated every Sunday night.</p>'}</details></div>`
    + `<div class="box"><h3>Social competitors</h3><details ${social.length ? 'open' : ''}><summary>Instagram accounts (${social.length})</summary>${social.length ? social.map(note).join('') : '<p class="sub">Updated every Sunday night.</p>'}</details></div>`;
  // Inspo: @hangrybeefnoodle (the content plan account) always sits at the top.
  if (d.notes.Inspo) d.notes.Inspo = [...d.notes.Inspo].sort((a, b) => (/hangrybeefnoodle/i.test(b.title) ? 1 : 0) - (/hangrybeefnoodle/i.test(a.title) ? 1 : 0));
  const known = new Set(['Competitor', 'Trend', 'Move', 'Inspo', 'Ad draft', 'Date']);
  const other = d.kinds.filter((k) => !known.has(k)).map((k) => section(TITLES[k] || k, d.notes[k] || [], EMPTY[k] || 'Nothing logged yet.')).join('');
  // Order: moves, numbers, trends, Grab and social competitors, inspo accounts, who moved, borrow cards, price lanes,
  // then dates ahead, ad drafts, dates and festivals at the bottom.
  $('top').innerHTML = insightTop(d)
    + section(TITLES.Trend, d.notes.Trend || [], EMPTY.Trend)
    + competitors
    + section(TITLES.Inspo, d.notes.Inspo || [], EMPTY.Inspo)
    + insightMid(d)
    + datesAhead(d)
    + section(TITLES['Ad draft'], d.notes['Ad draft'] || [], EMPTY['Ad draft'])
    + section(TITLES.Date, d.notes.Date || [], EMPTY.Date)
    + other;
  $('sections').innerHTML = '';
}

async function load() {
  const s = $('status');
  try {
    const res = await fetch('/api/marketing');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    draw(d);
    $('dlNotes').textContent = `Download all notes (CSV, ${HISTORY.length} rows)`;
    if (!$('kind').options.length) $('kind').innerHTML = d.kinds.map((k) => `<option>${esc(k)}</option>`).join('');
    s.textContent = '';
  } catch (err) { s.className = 'status err'; s.textContent = err.message; }
}

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = $('addStatus');
  a.textContent = 'Saving…';
  try {
    const res = await fetch('/api/marketing/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: $('kind').value, title: $('title').value, note: $('note').value }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Not saved');
    $('title').value = ''; $('note').value = '';
    a.textContent = 'Saved.';
    load();
  } catch (err) { a.textContent = `Not saved: ${err.message}`; }
});
$('dlNotes').addEventListener('click', () => { const n = downloadNotes(); const st = $('status'); st.className = 'status'; st.textContent = `Downloaded ${n} rows.`; });
load();
