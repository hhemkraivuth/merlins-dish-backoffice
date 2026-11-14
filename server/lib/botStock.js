// What is left, according to the customer bot. Read only: this only asks the bot's public menu feed (/api/menu),
// the same one customers' ordering page uses. It never writes to the bot, so ordering cannot be affected.
// The bot's own stock commands (setstock, left, soldout) stay the one place stock is changed.
const KEY = 'bot_stock_snapshot';

function botUrl() { return String(process.env.BOT_URL || process.env.BOT_MENU_URL || '').trim().replace(/\/+$/, '').replace(/\/api\/menu$/, ''); }

// Pure: menu JSON -> the lines worth showing. Items with a count, or sold out.
function snapshotFromMenu(menu, takenAt) {
  const items = (menu && Array.isArray(menu.items) ? menu.items : []).map((i) => ({
    name: String(i.name || i.id || '').trim(),
    left: typeof i.remaining === 'number' ? i.remaining : null,
    soldOut: i.available === false,
    // Regular and Large kept apart when the order app has a count for each size, so they are never shown as one total.
    sizes: Array.isArray(i.variantRemaining) ? i.variantRemaining.filter((v) => v && v.name && typeof v.left === 'number').map((v) => ({ name: String(v.name), left: v.left })) : [],
  })).filter((i) => i.name && (i.left !== null || i.soldOut || i.sizes.length));
  items.sort((a, b) => (a.soldOut === b.soldOut ? a.name.localeCompare(b.name) : a.soldOut ? 1 : -1));
  return { takenAt, items };
}

async function fetchSnapshot({ fetchImpl = fetch, now = () => new Date() } = {}) {
  const base = botUrl();
  if (!base) throw new Error('BOT_URL is not set, so BOH does not know where the customer bot lives.');
  const res = await fetchImpl(`${base}/api/menu`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`The bot answered ${res.status}.`);
  return snapshotFromMenu(await res.json(), now().toISOString());
}

async function saveSnapshot(store, snap) { await store.set(KEY, JSON.stringify(snap)); }
async function loadSnapshot(store) { try { const v = await store.get(KEY); return v ? JSON.parse(v) : null; } catch { return null; } }

module.exports = { KEY, botUrl, snapshotFromMenu, fetchSnapshot, saveSnapshot, loadSnapshot };
