// "Sync now" on the Content Plan page. BOH cannot start a Claude task by itself, so the button leaves a request in App State.
// A light hourly cloud task looks for it, starts the weekly content review (which reads the Raw shoots folder and writes the
// new posts), and sends back a content-sync-ack row through the Cloud Inbox so the page stops saying "waiting".
const REQUEST_KEY = 'content_sync_request';
const LAST_KEY = 'content_sync_last';

const parse = (v) => { try { const o = JSON.parse(v || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } };

async function request(deps = {}) {
  const st = deps.appState || require('./appState');
  const now = (deps.now || (() => new Date()))();
  const open = parse(await st.getState(REQUEST_KEY));
  if (open && open.requestedAt) return { pending: open.requestedAt, already: true };
  await st.setState(REQUEST_KEY, JSON.stringify({ requestedAt: now.toISOString() }));
  return { pending: now.toISOString(), already: false };
}

async function state(deps = {}) {
  const st = deps.appState || require('./appState');
  const [req, last] = await Promise.all([st.getState(REQUEST_KEY).catch(() => ''), st.getState(LAST_KEY).catch(() => '')]);
  const open = parse(req); const done = parse(last);
  return { pending: open && open.requestedAt ? open.requestedAt : null, last: done || null };
}

// Cloud Inbox kind content-sync-ack: the hourly task has started the review.
async function ack(payload = {}, deps = {}) {
  const st = deps.appState || require('./appState');
  const now = (deps.now || (() => new Date()))();
  const open = parse(await st.getState(REQUEST_KEY));
  await st.setState(LAST_KEY, JSON.stringify({ requestedAt: (open && open.requestedAt) || payload.requestedAt || null, startedAt: now.toISOString() }));
  await st.setState(REQUEST_KEY, '');
  return { ok: true, startedAt: now.toISOString() };
}

module.exports = { request, state, ack, REQUEST_KEY, LAST_KEY };
