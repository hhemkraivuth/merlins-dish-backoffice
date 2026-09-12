const { extractOrderPair } = require('../lib/vision');
const { buildOrderRows, isBatchCooked, resolveSizeName } = require('../lib/accountingRules');
const { deductFromLot } = require('../lib/batchLots');
const { appendRows } = require('../lib/sheets');
const { pairScreenshotsByOrderId } = require('../lib/pairing');

const CLAUDE_LOG_TAB = 'Claude Log'; // existing tab — writes here only, never Master Log directly

async function handleBatch(req, res) {
  try {
    const files = req.files; // multer in-memory files
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No screenshots uploaded' });
    }

    // Group files into detail+payment pairs by reading each screenshot's Order ID first
    const pairs = await pairScreenshotsByOrderId(files);

    const results = [];
    for (const pair of pairs) {
      // Unreadable-Order-ID group — surfaced as its own flagged entry, not silently dropped
      if (!pair.orderId) {
        results.push({
          orderId: 'unreadable',
          error: `${pair.unreadableCount} screenshot(s) had no readable Order ID`,
          files: pair.unmatchedFiles,
        });
        continue;
      }
      if (pair.incomplete) {
        results.push({
          orderId: pair.orderId,
          error: 'Only found one screenshot (detail or payment) for this Order ID — need both to log',
        });
        continue;
      }
      try {
        const extracted = await extractOrderPair(
          pair.detail.buffer.toString('base64'),
          pair.payment.buffer.toString('base64'),
          pair.mediaType
        );

        const { rows, flags } = await buildOrderRows(extracted);

        // Deduct batch-cooked items from their active lot's fixed portion count for that size
        // (bookkeeping only — no Recipe row written; cost is set once per batch, not per order)
        for (const item of extracted.items) {
          if (!isBatchCooked(item.name)) continue;
          const sizeName = resolveSizeName(item.size);
          const result = await deductFromLot(item.name, sizeName, item.qty);
          if (!result.deducted) {
            flags.push(`Could not deduct "${item.name}" (${sizeName}) — ${result.reason}. Needs a Batch Cook entry.`);
          } else if (result.outOfStock) {
            flags.push(`"${item.name}" (${sizeName}) was already at 0 stock when this order came in — check freezer/log a new batch`);
          }
        }

        const sheetRows = rows.map((r) => [
          extracted.transaction_datetime,
          r.orderId,
          r.type,
          r.dish || r.label || '',
          r.amount ?? '',
          r.orderType || '',
          r.customerName || '',
          flags.length ? flags.join('; ') : '',
        ]);

        await appendRows(CLAUDE_LOG_TAB, sheetRows);

        results.push({ orderId: extracted.order_id, rowsWritten: sheetRows.length, flags });
      } catch (err) {
        results.push({ orderId: pair.orderId || 'unknown', error: err.message });
      }
    }

    const flaggedCount = results.filter((r) => r.flags?.length).length;
    res.json({
      processed: results.length,
      flagged: flaggedCount,
      results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { handleBatch };
