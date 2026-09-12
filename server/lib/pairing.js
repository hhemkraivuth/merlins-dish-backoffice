const { extractOrderIdAndScreenType } = require('./vision');

// Reliable pairing: read the Grab Order ID + screen type off EVERY uploaded image first
// (one cheap, small vision call per image), then group by matching Order ID.
// This works regardless of the order screenshots were uploaded in.
async function pairScreenshotsByOrderId(files) {
  const identified = await Promise.all(
    files.map(async (file) => {
      try {
        const result = await extractOrderIdAndScreenType(file.buffer.toString('base64'), file.mimetype);
        return { file, orderId: result.order_id, screenType: result.screen_type };
      } catch (err) {
        return { file, orderId: null, screenType: 'unknown', error: err.message };
      }
    })
  );

  const groups = {};
  const unmatched = [];

  for (const item of identified) {
    if (!item.orderId) {
      unmatched.push(item);
      continue;
    }
    if (!groups[item.orderId]) groups[item.orderId] = [];
    groups[item.orderId].push(item);
  }

  const pairs = [];
  for (const [orderId, items] of Object.entries(groups)) {
    const detail = items.find((i) => i.screenType === 'detail');
    const payment = items.find((i) => i.screenType === 'payment');
    pairs.push({
      orderId,
      detail: detail?.file || items[0]?.file,
      payment: payment?.file || items[1]?.file,
      mediaType: items[0]?.file.mimetype,
      incomplete: !detail || !payment,
    });
  }

  // Screenshots where the Order ID couldn't be read at all — surfaced as a top-level flag,
  // not silently dropped
  if (unmatched.length) {
    pairs.push({ orderId: null, unreadableCount: unmatched.length, incomplete: true, unmatchedFiles: unmatched.map((u) => u.file.originalname) });
  }

  return pairs;
}

module.exports = { pairScreenshotsByOrderId };
