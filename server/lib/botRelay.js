// Order app commands typed in the BOH group. The order app's own commands (close, open now, promo, soldout, block and so on)
// only worked in the order app's group. Here BOH passes them on through the order app's control API and posts the order
// app's reply back, marked "Order app:", so one group is enough.
//
//   'both'  BOH keeps its own record too: left (the cooked dishes' counts), close with a date and unclose (the Closed Days tab).
//   'bot'   only the order app understands it, so BOH does nothing else with the message.
// Words BOH already uses itself (stock, open, count, free, low, undo, swap, rider, waste) are never passed on, except
// "open now" and "open today", which BOH has never used.

const BOTH = [/^(left|setstock)\b/i, /^close\s+(today|\d{1,2}[/.]\d{1,2})/i, /^(unclose|reopen)\s+(today|\d{1,2}[/.]\d{1,2})/i];
const BOT = [
  /^close$/i,
  /^open\s+(now|today)$/i,
  /^(normal|reset|auto)\s+hours$/i,
  /^(status|hours|removed|restore|keywords|promos?)$/i,
  /^promo\s+off$/i,
  /^(block|unblock|remove|restore|soldout|instock|itempromo|additem|announce|announcement|promo)\b/i,
  /^in\s?stock\b/i,
];

function classify(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (BOTH.some((r) => r.test(t))) return 'both';
  if (BOT.some((r) => r.test(t))) return 'bot';
  return null;
}

// act: botAdmin.act. Returns the lines to post in the group.
async function relay(text, act) {
  try {
    const out = await act('command', { text: String(text).trim() });
    if (!out.handled) return ['Order app: it did not recognise that, so nothing changed there.'];
    const replies = (out.replies || []).filter(Boolean);
    return replies.length ? replies.map((r) => `Order app: ${r}`) : ['Order app: done.'];
  } catch (err) {
    return [`Order app: not reached (${String((err && err.message) || err).slice(0, 200)}). Nothing changed there.`];
  }
}

module.exports = { classify, relay };
