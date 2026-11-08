// US dollar to baht. Dollar prices (Railway 5usd) are stored as dollars and never change. The baht on each month's row is that
// day's conversion, written next to the dollar amount in the Remarks so the two can never be confused.
// The live rate comes from a free public feed. The last good rate is kept in App State so a feed outage never blocks logging.
const KEY = 'usd_thb_rate';
const TTL_MS = 6 * 3600 * 1000;
let cache = null;

async function liveRate(fetchFn = fetch) {
  try {
    const res = await fetchFn('https://open.er-api.com/v6/latest/USD');
    const j = await res.json();
    const r = Number(j && j.rates && j.rates.THB);
    return Number.isFinite(r) && r > 10 && r < 100 ? Math.round(r * 100) / 100 : null;
  } catch (err) { return null; }
}

// -> { rate, source: 'live' | 'last saved' } or null when there is neither.
async function getUsdRate({ store, fetchFn, now = Date.now } = {}) {
  if (cache && now() - cache.at < TTL_MS) return { rate: cache.rate, source: 'live' };
  const live = await liveRate(fetchFn);
  if (live) {
    cache = { rate: live, at: now() };
    if (store) { try { await store.set(KEY, String(live)); } catch (err) { /* best effort */ } }
    return { rate: live, source: 'live' };
  }
  if (store) {
    try { const saved = Number(await store.get(KEY)); if (Number.isFinite(saved) && saved > 10) return { rate: saved, source: 'last saved' }; } catch (err) { /* none */ }
  }
  return null;
}
const toBaht = (usd, rate) => Math.round(Number(usd) * Number(rate) * 100) / 100;
const resetCache = () => { cache = null; };

module.exports = { getUsdRate, toBaht, liveRate, resetCache, KEY };
