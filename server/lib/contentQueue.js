// The Content Queue tab of the Claude Log. When Lily approves a post on the Content Plan page, one row lands here.
// A cloud task at 17:00 Bangkok reads the rows that are approved and due, posts them to Instagram and Facebook
// through Zapier, then writes published (with the post links) or failed (with the reason) back to the same row.
// The BOH page reads this tab, so a post shows as Published without anyone touching it.

const { readTab, readTabFresh, appendRows, updateRow } = require('./sheets');
const { ensureTab } = require('./cookLog');

const TAB = 'Content Queue';
const HEADERS = ['ID', 'Date', 'Time', 'Status', 'Format', 'Title', 'Caption', 'Media IDs', 'Media names', 'Instagram URL', 'Facebook URL', 'Note', 'Updated'];
const STATUSES = ['approved', 'published', 'failed', 'cancelled'];

async function rows(fresh = false) {
  try { return await (fresh ? readTabFresh : readTab)(TAB); } catch (err) { if (/unable to parse range|not found/i.test(String(err.message))) return []; throw err; }
}

const cell = (r, i) => String((r && r[i]) || '').trim();

// id -> { status, igUrl, fbUrl, note } for the page.
async function readQueue() {
  const out = {};
  for (const r of (await rows()).slice(1)) {
    const id = cell(r, 0);
    if (id) out[id] = { status: cell(r, 3), igUrl: cell(r, 9), fbUrl: cell(r, 10), note: cell(r, 11) };
  }
  return out;
}

const mediaIds = (media) => (Array.isArray(media) ? media : []).map((m) => String((m && m.id) || '').trim()).filter(Boolean);
const mediaNames = (media) => (Array.isArray(media) ? media : []).map((m) => String((m && m.name) || '').trim()).filter(Boolean);

// Adds or updates the row for one post. A row that is already published is left alone, so a post can never go out twice.
async function upsert(post, status, note = '', now = new Date()) {
  if (!STATUSES.includes(status)) throw new Error(`Queue status must be one of ${STATUSES.join(', ')}.`);
  await ensureTab(TAB, HEADERS);
  const rs = await rows(true);
  const at = rs.findIndex((r, i) => i > 0 && cell(r, 0) === post.id);
  if (at >= 0 && cell(rs[at], 3) === 'published') return { ok: true, kept: 'published' };
  const line = [
    post.id, post.date, post.time || '17:00', status, post.format || '', post.title || '', post.fullCaption || '',
    mediaIds(post.media).join(','), mediaNames(post.media).join(', '),
    at >= 0 ? cell(rs[at], 9) : '', at >= 0 ? cell(rs[at], 10) : '', note, now.toISOString(),
  ];
  if (at >= 0) await updateRow(TAB, at + 1, line);
  else await appendRows(TAB, [line], { raw: true });
  return { ok: true };
}

// Called when a post is un approved or dismissed. A post with no row, or already published, is left as it is.
async function cancel(id, now = new Date()) {
  const rs = await rows(true);
  const at = rs.findIndex((r, i) => i > 0 && cell(r, 0) === id);
  if (at < 0 || cell(rs[at], 3) === 'published' || cell(rs[at], 3) === 'cancelled') return { ok: true };
  const line = HEADERS.map((_, i) => cell(rs[at], i));
  line[3] = 'cancelled'; line[11] = 'Un approved on the Content Plan page'; line[12] = now.toISOString();
  await updateRow(TAB, at + 1, line);
  return { ok: true };
}

module.exports = { TAB, HEADERS, STATUSES, readQueue, upsert, cancel };
