// The Index tab: what the order app shows (announcement, hours, promos, menu, delivery fees).
//
// Reading and writing go to the customer bot's back office API (/api/admin/*), which needs two Railway variables:
//   BOT_URL          the customer bot address (already set)
//   BOT_ADMIN_TOKEN  the same secret as ADMIN_API_TOKEN on the bot
// Until the bot has been updated and both are set, the tab falls back to the bot's public feeds and is READ ONLY.
// BOH never touches the bot's data any other way.
const { botUrl } = require('./botStock');

const ACTIONS = new Set([
  'announcement', 'announcement/clear', 'hours', 'promo/storewide', 'promo/storewide/off', 'promo/item', 'promo/item/clear',
  'menu/price', 'menu/image', 'menu/item', 'menu/add', 'menu/remove', 'menu/restore', 'delivery', 'stock', 'command',
]);

const token = () => String(process.env.BOT_ADMIN_TOKEN || '').trim();

// The bot's own defaults, used only when the bot has not been updated yet and cannot say.
const DEFAULT_DELIVERY = { freeMin: 300, smallFee: 30, zone2to5: 50, zone5to75: 120, zone75to10: 180 };

// Pure: the public feeds -> the same shape the admin state has, marked read only.
function stateFromPublic(menu, shop) {
  const items = (menu && menu.items) || [];
  const promoIds = items.filter((i) => i.promoLabel);
  const sw = promoIds.find((i) => !i.promoIsItemSpecific);
  const ann = menu && menu.announcement;
  return {
    readOnly: true,
    open: { isOpen: shop ? !!shop.isOpen : null, message: shop && !shop.isOpen ? shop.closedMessage : null, override: null, closures: [], special: [], blocks: [], normalHours: 'Mon-Fri 11:00-13:30 and 15:00-21:00' },
    announcement: ann ? { active: true, live: true, headline: ann.headline || '', body: ann.body || '', startDate: ann.startDate || null, endDate: ann.endDate || null } : { active: false, live: false, headline: '', body: '', startDate: null, endDate: null },
    storewidePromo: sw ? { active: true, label: sw.promoLabel, percentOff: sw.promoPercentOff, startDate: null, endDate: null } : { active: false, label: '', percentOff: 0, startDate: null, endDate: null },
    itemPromos: Object.fromEntries(promoIds.filter((i) => i.promoIsItemSpecific).map((i) => [i.id, { active: true, label: i.promoLabel, percentOff: i.promoPercentOff }])),
    categories: (menu && menu.categories) || [],
    menu: items.map((i) => ({ id: i.id, name: i.name, price: i.price, category: i.category, description: i.description || '', available: i.available !== false, image: i.image || null, requiresPasta: !!i.requiresPasta, requiresSize: !!i.requiresSize })),
    removed: [],
    delivery: shop ? { ...DEFAULT_DELIVERY, freeMin: shop.freeDeliveryMin ?? 300, smallFee: shop.smallOrderFee ?? 30, ...(shop.zoneFees || {}) } : DEFAULT_DELIVERY,
  };
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

// ---- auto expiry ----------------------------------------------------------------------------------------------------
// Anything with an end date in the past is switched off: the announcement, the whole bill promo, item promos, closed days
// and special hours. Pure: state -> [{ action, body, label }]. todayIso is the Bangkok date, "YYYY-MM-DD".
function staleActions(state, todayIso) {
  const out = [];
  if (!state || state.readOnly) return out;
  const past = (d) => Boolean(d) && String(d) < todayIso;
  const a = state.announcement || {};
  if (a.headline && past(a.endDate)) out.push({ action: 'announcement/clear', body: {}, label: `announcement "${a.headline}" (ended ${a.endDate})` });
  const w = state.storewidePromo || {};
  if (w.active && past(w.endDate)) out.push({ action: 'promo/storewide/off', body: {}, label: `whole bill promo "${w.label}" (ended ${w.endDate})` });
  for (const [id, p] of Object.entries(state.itemPromos || {})) {
    if (p && past(p.endDate)) out.push({ action: 'promo/item/clear', body: { id }, label: `item promo "${p.label || id}" (ended ${p.endDate})` });
  }
  const o = state.open || {};
  const closures = (o.closures || []).filter((c) => !past(c.end || c.start));
  const special = (o.special || []).filter((x) => !past(x.date));
  const blocks = (o.blocks || []).filter((x) => !past(x.date));
  if (closures.length !== (o.closures || []).length || special.length !== (o.special || []).length || blocks.length !== (o.blocks || []).length) {
    out.push({ action: 'hours', body: { override: o.override === true ? 'open' : o.override === false ? 'closed' : null, closures, special, blocks }, label: 'closed days, special hours or blocked slots that have passed' });
  }
  return out;
}

const bangkokIso = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

async function loadState() {
  const st = await loadStateRaw();
  const todo = staleActions(st, bangkokIso());
  if (!todo.length) return st;
  const cleared = [];
  for (const t of todo) { try { await act(t.action, t.body); cleared.push(t.label); } catch (err) { console.error('Index expiry:', t.action, err.message); } }
  if (!cleared.length) return st;
  return { ...(await loadStateRaw()), expired: cleared };
}

// For the hourly timer: same clean up with no page open.
async function expireStale() {
  const st = await loadStateRaw();
  const cleared = [];
  for (const t of staleActions(st, bangkokIso())) { try { await act(t.action, t.body); cleared.push(t.label); } catch (err) { console.error('Index expiry:', t.action, err.message); } }
  return { cleared };
}

async function loadStateRaw() {
  const base = botUrl();
  if (!base) throw new Error('BOT_URL is not set, so BOH does not know where the order app lives.');
  if (token()) {
    const r = await getJson(`${base}/api/admin/state`, { 'x-admin-token': token() });
    if (r.ok) return { ...r.body, readOnly: false };
    // 404 means the bot has not been updated yet, 401 means the token does not match. Either way, show what we can.
    const why = r.status === 401 ? 'The token does not match the one on the bot.' : r.status === 404 ? 'The bot has not been updated with the control API yet.' : `The bot answered ${r.status}.`;
    const pub = await loadPublic(base);
    return { ...pub, note: `${why} Showing the live order app, read only.` };
  }
  const pub = await loadPublic(base);
  return { ...pub, note: 'BOT_ADMIN_TOKEN is not set yet, so this is read only.' };
}

async function loadPublic(base) {
  const [m, s] = await Promise.all([getJson(`${base}/api/menu`), getJson(`${base}/api/shop-info`)]);
  if (!m.ok) throw new Error(`The order app answered ${m.status}.`);
  return stateFromPublic(m.body, s.ok ? s.body : null);
}

async function act(action, body) {
  if (!ACTIONS.has(action)) { const e = new Error('Unknown action'); e.status = 400; throw e; }
  const base = botUrl();
  if (!base || !token()) { const e = new Error('Editing needs BOT_URL and BOT_ADMIN_TOKEN on BOH, and the bot update on the bot.'); e.status = 409; throw e; }
  const res = await fetch(`${base}/api/admin/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': token() }, body: JSON.stringify(body || {}) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(out.error || `The bot answered ${res.status}.`); e.status = res.status === 401 || res.status === 404 ? 409 : res.status; throw e; }
  return out;
}

module.exports = { ACTIONS, stateFromPublic, loadState, expireStale, staleActions, act, DEFAULT_DELIVERY };
