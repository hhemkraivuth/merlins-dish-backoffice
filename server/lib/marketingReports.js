// Full reports from the weekly marketing check (audit, Grab listings, content plan, inspo visual).
// The short notes stay in "Marketing Notes". The full text of each report is kept here, one App State row per report,
// so the Marketing page can link to it and Lily can read or download it. Posting a report again replaces the earlier copy.

const { readTab } = require('./sheets');
const { setState, TAB } = require('./appState');

const PREFIX = 'marketing_report_';
const ORDER = ['audit', 'grab', 'content', 'inspo'];
const MAX_REPORTS = 12;
const MAX_CELL = 48000; // Google Sheets allows 50,000 characters in one cell.

const fail = (message) => Object.assign(new Error(message), { status: 400 });

// Checks one posted report and returns the row to store. Throws a 400 with a plain message when something is missing.
function prepare({ slug, title, markdown }, now = new Date()) {
  const s = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(s)) throw fail('Give the report a short name using letters, numbers and dashes, for example "audit".');
  const text = String(markdown || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw fail('The report is empty.');
  const name = String(title || '').trim() || s;
  const value = JSON.stringify({ title: name, markdown: text, updated: now.toISOString() });
  if (value.length > MAX_CELL) throw fail('That report is too long for one cell. Split it into two reports and post each one.');
  return { slug: s, key: PREFIX + s, value };
}

// Reports from the App State rows, in the usual order first, then any others by name.
function fromRows(rows, { withText = false } = {}) {
  const out = [];
  for (const r of (rows || []).slice(1)) {
    const key = String((r && r[0]) || '').trim();
    if (!key.startsWith(PREFIX)) continue;
    let v; try { v = JSON.parse(String(r[1] || '')); } catch (e) { continue; }
    if (!v || !v.markdown) continue;
    const slug = key.slice(PREFIX.length);
    out.push({ slug, title: v.title || slug, updated: v.updated || '', ...(withText ? { markdown: v.markdown } : {}) });
  }
  const rank = (s) => { const i = ORDER.indexOf(s); return i < 0 ? ORDER.length : i; };
  return out.sort((a, b) => rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug));
}

async function readRows() {
  try { return await readTab(TAB); } catch (err) { if (/unable to parse range|not found/i.test(String(err.message))) return []; throw err; }
}

async function listReports() { return fromRows(await readRows()); }
async function getReport(slug) { return fromRows(await readRows(), { withText: true }).find((r) => r.slug === String(slug || '').toLowerCase()) || null; }
async function saveReport(body) {
  const row = prepare(body);
  const have = await listReports();
  if (!have.some((r) => r.slug === row.slug) && have.length >= MAX_REPORTS) throw fail(`There are already ${MAX_REPORTS} reports. Replace one of those names instead.`);
  await setState(row.key, row.value);
  return { ok: true, slug: row.slug };
}

module.exports = { prepare, fromRows, listReports, getReport, saveReport, PREFIX, ORDER, MAX_CELL };
