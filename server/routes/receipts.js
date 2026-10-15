const { extractReceipt } = require('../lib/vision');
const { appendRows } = require('../lib/sheets');
const { parsePurchaseUnit } = require('../lib/priceBook');

// NEW, SEPARATE tab — never the live Price Log tab in the Merlin's numbers file.
// Lily reviews this and manually copies into Price Log when ready.
const EXPENSE_LOG_TAB = 'Expense Log';

async function handleBatch(req, res) {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No receipts uploaded' });
    }

    const results = [];
    for (const file of files) {
      try {
        const extracted = await extractReceipt(file.buffer.toString('base64'), file.mimetype);

        const flags = [];
        if (!extracted.shopping_date) flags.push('No shopping date read from receipt');
        if (extracted.uncertain_fields?.length) {
          flags.push(...extracted.uncertain_fields.map((f) => `Vision uncertain: ${f}`));
        }

        // Matches Price Log column shape: Shopping Date | Ingredient | Purchase Price | Purchase Unit | Cost per Recipe Unit | Shopped at | Remarks
        const sheetRows = extracted.line_items.map((item) => {
          // Cost per recipe unit is per gram (or ml, or piece). A "2kg" receipt line is converted to 2000g first.
          const pu = parsePurchaseUnit(`${item.purchase_qty}${item.purchase_unit || ''}`);
          const base = pu && pu.qty > 0 ? pu.qty : item.purchase_qty;
          const costPerRecipeUnit = base > 0 ? Number((item.purchase_price / base).toFixed(5)) : '';
          return [
            extracted.shopping_date || '',
            item.item_name,
            item.purchase_price,
            `${item.purchase_qty}${item.purchase_unit}`,
            costPerRecipeUnit,
            extracted.shopped_at || '',
            flags.length ? flags.join('; ') : '',
          ];
        });

        await appendRows(EXPENSE_LOG_TAB, sheetRows);

        results.push({
          file: file.originalname,
          itemsLogged: sheetRows.length,
          receiptTotal: extracted.receipt_total,
          flags,
        });
      } catch (err) {
        results.push({ file: file.originalname, error: err.message });
      }
    }

    const flaggedCount = results.filter((r) => r.flags?.length).length;
    res.json({ processed: results.length, flagged: flaggedCount, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { handleBatch };
