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
    return `<details class="card" ${i === 0 && label === 'Opening' ? 'open' : ''}><summary><span class="row"><span class="name">${esc(grab ? shopName(n.title) : n.title)}<span class="chip tag">${grab ? 'Grab' : 'Instagram'}</span></span><span class="chip ${cls}">${label}</span></span><span class="hint">${esc(hint)}</span></summary><div class="more">${p.summary ? `<p style="margin:0 0 8px">${esc(p.summary)}</p>` : ''}${p.Key ? `<p style="margin:0"><b>Key:</b> ${esc(p.Key)}</p>` : ''}<p class="sub" style="margin:8px 0 0">${esc(n.date)}</p></div></details>`;
  }).join('');
}

// Inspo accounts as one list: the Borrow line on top, tap for what the account does and its Key.
function borrowCards(list) {
  const sorted = [...list].sort((a, b) => (/hangrybeefnoodle/i.test(b.title) ? 1 : 0) - (/hangrybeefnoodle/i.test(a.title) ? 1 : 0));
  return sorted.map((n, i) => {
    const p = parts(n.note);
    const first = i === 0 && /hangrybeefnoodle/i.test(n.title);
    const kind = /content plan/i.test(n.title) ? 'Content plan inspo' : 'Visual inspo';
    return `<details class="card ${first ? 'first' : ''}"><summary>${first ? '<span class="chip first">Borrow first</span>' : ''}<span class="name">${esc(shopName(n.title))}</span><span class="hint">${kind}</span><span style="font-size:16px;line-height:1.4">${esc(p.Borrow || p.summary)}</span></summary><div class="more">${p.summary ? `<p style="margin:0 0 8px">${esc(p.summary)}</p>` : ''}${p.Key ? `<p style="margin:0"><b>Key:</b> ${esc(p.Key)}</p>` : ''}<p class="sub" style="margin:8px 0 0">${esc(n.date)}</p></div></details>`;
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
  const foot = merlin ? "Merlin's Grab prices are what Grab orders were charged in the last 60 days, mains only. A dish with no Grab order yet is the order bot price plus ฿25." : "Merlin's price range is not available right now, the order bot did not answer.";
  return `<div class="lanes">${lanes}<div class="axis"><span style="left:0">${baht(0)}</span><span style="left:50%;transform:translateX(-50%)">${baht(max / 2)}</span><span style="right:0">${baht(max)}</span></div><p class="sub" style="margin:0">${esc(foot)} Competitor ranges are read from the latest Grab notes.</p></div>`;
}
const baht = (n) => `฿${Math.round(n).toLocaleString('en-AU')}`;


// "11/11/2026" to "11/11/26", small, next to the Three moves heading.
const shortDate = (t) => { const m = String(t || '').match(DMY); return m ? `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3].slice(2)}` : ''; };
const repLink = (d, slug, label = 'Full report') => ((d.reports || []).some((r) => r.slug === slug) ? `<a class="rl" href="report.html?doc=${encodeURIComponent(slug)}">${esc(label)} <span aria-hidden="true">›</span></a>` : '');

// Top line: when the Sunday check last ran, and the way into the full reports.
function reportBar(d) {
  const first = (d.reports || [])[0];
  return `<div class="rbar"><span class="${d.auditDue ? 'due' : ''}">${esc(d.auditNote)}</span>${first ? `<a class="rbtn" href="report.html?doc=${encodeURIComponent(first.slug)}">Full report <span aria-hidden="true">›</span></a>` : ''}</div>`;
}

function insightTop(d) {
  const today = dayNum(d.today);
  const recent = (n) => { const x = dayNum(n.date); return x !== null && today - x <= 7; };
  const moves = (d.notes.Move || []).filter(recent).slice(0, 3);
  const when = moves.length ? shortDate(moves[0].date) : '';
  return `<h2>Three moves this week${when ? ` <small class="when">(${esc(when)})</small>` : ''}</h2>`
    + (moves.length ? `<div class="stack">${moves.map(moveCard).join('')}</div>` : '<p class="empty">No moves yet. The Sunday check writes three each week.</p>');
}

// The bet detail is one long line. Put each labelled part on its own line, label in bold.
function betLines(text) {
  const t = String(text || '');
  const re = /\s*\b(Number|Test|Lever|Baseline|Grab New against RT|Review):\s*/g;
  const out = []; let label = ''; let last = 0; let m;
  while ((m = re.exec(t))) { out.push([label, t.slice(last, m.index).trim()]); label = m[1]; last = m.index + m[0].length; }
  out.push([label, t.slice(last).trim()]);
  return out.filter(([, b]) => b).map(([l, b]) => `<p style="margin:0 0 6px">${l ? `<b>${esc(l)}:</b> ` : ''}${esc(b)}</p>`).join('');
}

// The month's bet, one line. Tap for the detail note. "November:" stays bold like the Strategy card on Home.
function betStrip(d) {
  const list = d.notes.Bet || [];
  const head = list.find((n) => /^[A-Za-z]+:\s/.test(n.title)) || list[0];
  if (!head) return '';
  const m = head.title.match(/^([A-Za-z]+:)\s*(.*)$/);
  const ends = [...head.title.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)].pop();
  const left = ends ? Math.round(Date.UTC(+ends[3], +ends[2] - 1, +ends[1]) / 864e5 - dayNum(d.today)) : null;
  const tail = left === null ? '' : left < 0 ? 'ended' : left === 0 ? 'last day' : `${left} ${left === 1 ? 'day' : 'days'} left`;
  const more = list.filter((n) => n !== head).map((n) => `<p style="margin:0 0 6px"><b>${esc(n.title)}</b></p>${betLines(parts(n.note).summary)}`).join('');
  return `<details class="bet"><summary><span><b>${esc(m ? m[1] : 'Bet:')}</b> ${esc(m ? m[2] : head.title)}${tail ? ` <span class="left">${esc(tail)}</span>` : ''}</span><span class="chev" aria-hidden="true"></span></summary>${more ? `<div class="more">${more}</div>` : ''}</details>`;
}

function numbers(d) {
  const tile = (lab, val, ctx) => `<section class="tile"><span class="lab">${esc(lab)}</span><span class="val">${esc(val)}</span><span class="ctx">${esc(ctx)}</span></section>`;
  const today = dayNum(d.today);
  const comp = d.notes.Competitor || [];
  const open = comp.filter((n) => { const x = dayNum(n.date); return x !== null && today - x <= 7 && statusOf(n)[0] === 'Opening'; });
  const g = d.bet;
  return '<h2>The numbers</h2><div class="tiles">'
    + tile('Orders this week', String(d.week.orders), `Grab ${d.week.grab || 0}, LINE ${d.week.line || 0}, Instagram ${d.week.ig || 0}`)
    + tile('Orders this month', String(d.month.orders), `Grab ${d.month.grab || 0}, LINE ${d.month.line || 0}, Instagram ${d.month.ig || 0}`)
    + tile('Grab to direct', g ? `${g.count} of ${g.target}` : 'Not set', g ? `By ${g.until.slice(0, 5)}, direct orders from Grab customers` : 'No bet with a count yet')
    + tile('Openings for us', String(open.length), open.slice(0, 3).map((n) => shopName(n.title)).join(', ') || 'None this week')
    + '</div>';
}

// Trends: headlines only, three showing, the rest one tap away. Tap a headline for its detail.
function trendsBox(d) {
  const list = d.notes.Trend || [];
  if (!list.length) return '<h2>Trends</h2><p class="empty">Updated every Sunday night.</p>';
  const row = (n) => `<details class="trow"><summary><span>${esc(n.title)}</span><span class="chev" aria-hidden="true"></span></summary><p class="more">${esc(parts(n.note).summary)} <span class="sub">${esc(n.date)}</span></p></details>`;
  const rest = list.slice(3);
  return `<h2>Trends</h2><div class="trends">${list.slice(0, 3).map(row).join('')}${rest.length ? `<details class="trow more-trends"><summary><span>More trends (${rest.length})</span><span class="chev" aria-hidden="true"></span></summary>${rest.map(row).join('')}</details>` : ''}</div>`;
}

const drawer = (title, count, inner, open = false) => `<details class="drawer" ${open ? 'open' : ''}><summary><span>${esc(title)}${count === null ? '' : ` (${count})`}</span><span class="chev" aria-hidden="true"></span></summary><div class="dbody">${inner}</div></details>`;

function datesAhead(d, dateNotes) {
  const next = (d.dates || []).length ? `<div class="datelist">${d.dates.slice(0, 6).map((x) => `<div class="d"><div class="dd"><span class="wd">${esc(x.day)}</span><span class="dn">${esc(x.date.slice(0, 5))}</span></div><div><div class="dl">${esc(x.label)}</div><div class="da">${x.away} days</div></div></div>`).join('')}</div>` : '<p class="empty">Nothing fixed in the next 60 days.</p>';
  const all = dateNotes.length ? `<details class="trow"><summary><span>All dates and festivals (${dateNotes.length})</span><span class="chev" aria-hidden="true"></span></summary>${dateNotes.map(note).join('')}</details>` : '';
  return next + all;
}

function draw(d) {
  HISTORY = d.history || [];
  const comp = d.notes.Competitor || [];
  const grab = comp.filter((n) => !/^\s*@/.test(n.title));
  if (d.notes.Inspo) d.notes.Inspo = [...d.notes.Inspo].sort((a, b) => (/hangrybeefnoodle/i.test(b.title) ? 1 : 0) - (/hangrybeefnoodle/i.test(a.title) ? 1 : 0));
  const inspo = d.notes.Inspo || [];
  const known = new Set(['Competitor', 'Trend', 'Move', 'Bet', 'Inspo', 'Ad draft', 'Date']);
  const other = d.kinds.filter((k) => !known.has(k) && (d.notes[k] || []).length).map((k) => drawer(TITLES[k] || k, d.notes[k].length, d.notes[k].map(note).join(''))).join('');
  const drafts = d.notes['Ad draft'] || [];
  const lanes = priceLanes(grab, d.merlin);
  // Order: top line, moves, bet, numbers, trends, borrow, then everything else folded away.
  $('top').innerHTML = reportBar(d)
    + insightTop(d)
    + betStrip(d)
    + numbers(d)
    + trendsBox(d)
    + `<h2>Borrow${repLink(d, 'content', 'Content plan')}</h2>` + (inspo.length ? `<div class="stack">${borrowCards(inspo)}</div>` : '<p class="empty">Updated every Sunday night.</p>')
    + '<div class="drawers">'
    + (comp.length ? drawer('Who moved', comp.length, `<p class="sub" style="margin:0 0 10px">Tap a row for its Key. Opening means a gap we can use, Watch means keep an eye on it. ${repLink(d, 'audit')} ${repLink(d, 'grab', 'Grab listings')}</p><div class="stack">${whoMoved(comp)}</div>`) : '')
    + (lanes ? drawer('Price lanes on Grab', null, lanes) : '')
    + drawer('Dates ahead', (d.dates || []).length, datesAhead(d, d.notes.Date || []))
    + drawer('Ad drafts (nothing runs without your approval)', null, drafts.length ? drafts.map(note).join('') : '<p class="sub">Drafts only, nothing runs without your approval.</p>')
    + other
    + '</div>';
  $('sections').innerHTML = '';
}

async function load() {
  const s = $('status');
  try {
    const [res, rep] = await Promise.all([fetch('/api/marketing'), fetch('/api/marketing/reports').then((r) => r.json()).catch(() => ({}))]);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
    d.reports = rep.reports || [];
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
