// Edit or delete one line of the receipts list (an Expense Log row or an Overheads row).
//   delete  removes the row, and for an ingredient also its unused stock lot
//   edit    adds the corrected line through the normal typed receipt reader, then removes the old row, so nothing is lost if the new line can't be read
// The row is found by position, but only touched if it still matches what the page showed (date, item, price), so a stale page can never hit the wrong row.

const TABS = { E: 'Expense Log', O: 'Overheads' };

function createReceiptItems(getDeps) {
  const sheets = () => require('../lib/sheets');

  async function verify(ref) {
    if (!ref || !TABS[ref.t] || !(ref.i >= 1)) return null;
    const tab = TABS[ref.t];
    const rows = await sheets().readTabFresh(tab);
    const row = rows[ref.i];
    const priceCol = ref.t === 'E' ? 2 : 3;
    if (!row || String(row[0] || '') !== ref.d || String(row[1] || '') !== ref.n || String(row[priceCol] || '') !== ref.p) return null;
    return { tab, row };
  }

  // Takes the row out. An ingredient's stock lot goes too, unless a batch has already used some of it.
  async function removeRow(ref, row, { keepStock = false } = {}) {
    await sheets().deleteRowAt(TABS[ref.t], ref.i);
    let keptLot = '';
    // An overhead that topped up the Stock page (foil, bags) takes it back off when deleted. An edit leaves stock alone.
    if (!keepStock) {
      const sm = String(row[ref.t === 'O' ? 5 : 6] || '').match(/Stock \+(\d+(?:\.\d+)?) ([^;]+)/);
      if (sm) { try { await getDeps().adjustPacks(sm[2].trim(), -Number(sm[1])); } catch (err) { console.error('Stock take back failed:', err); } }
    }
    if (ref.t === 'E') {
      const id = (String(row[6] || '').match(/R\d{6}-\d{6}/) || [])[0];
      if (id) {
        let done = false;
        await sheets().deleteRowsWhere('Ingredient Lots', (r) => {
          if (done || !String(r[11] || '').includes(id) || String(r[1] || '').toLowerCase() !== String(row[1] || '').toLowerCase()) return false;
          if (Number(r[6]) < Number(r[4]) - 1e-6) { keptLot = `${r[1]} (${r[6]} of ${r[4]} left)`; return false; }
          done = true; return true;
        });
      }
    }
    return keptLot;
  }

  async function del(req, res) {
    try {
      const ref = req.body && req.body.ref;
      const hit = await verify(ref);
      if (!hit) return res.status(409).json({ error: 'That line has changed since the page loaded. Refresh the page and try again. Nothing was changed.' });
      const kept = await removeRow(ref, hit.row);
      res.json({ ok: true, text: `Deleted${kept ? `. Its stock lot was kept because a batch already used some of it: ${kept}` : ''}.` });
    } catch (err) { console.error('Receipt line delete failed:', err); res.status(500).json({ error: `Couldn't delete it. Reason: ${err.message}` }); }
  }

  async function edit(req, res) {
    try {
      const b = req.body || {};
      const hit = await verify(b.ref);
      if (!hit) return res.status(409).json({ error: 'That line has changed since the page loaded. Refresh the page and try again. Nothing was changed.' });
      const clean = (v) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
      const date = clean(b.date); const item = clean(b.item); const shop = clean(b.shop); const qty = clean(b.qty);
      const price = Number(String(b.price).replace(/[,฿\s]/g, ''));
      if (!date || !item || !Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Date, item and a price are needed. Nothing was changed.' });
      const lines = [date];
      if (shop) lines.push(`at ${shop}`);
      if (b.ref.t === 'E') {
        if (!qty) return res.status(400).json({ error: 'How many is needed, with its unit, for example 500g. Nothing was changed.' });
        lines.push(`${item} ${qty} ${price}thb`);
      } else {
        const kind = clean(b.kind).toLowerCase();
        lines.push(kind === 'r&d' ? 'r&d' : kind === 'meta ads' ? 'meta ads' : 'overhead');
        lines.push(`${item}${qty ? ' ' + qty : ''}, ${price}thb`);
      }
      const { processTypedReceipt } = require('../lib/cookService');
      const { bangkokToday } = require('../lib/dates');
      const deps = { ...getDeps(), typedVia: 'Edited on the web', skipStock: true };
      const replies = (await processTypedReceipt(lines.join('\n'), bangkokToday(), deps)) || [];
      const text = replies.join('\n');
      if (!/logged/i.test(text) || /Couldn't use these lines/.test(text)) {
        return res.status(400).json({ error: `The corrected line could not be read, so nothing was changed.\n${text || 'Check the item, how many and the price.'}` });
      }
      const kept = await removeRow(b.ref, hit.row, { keepStock: true });
      res.json({ ok: true, text: `Saved. ${kept ? `The old stock lot was kept because a batch already used some of it: ${kept}.` : ''}`.trim() });
    } catch (err) { console.error('Receipt line edit failed:', err); res.status(500).json({ error: `Couldn't save the change. Reason: ${err.message}` }); }
  }

  return { del, edit };
}

const handlers = createReceiptItems(() => require('../lib/receiptDeps').buildReceiptDeps());
module.exports = { ...handlers, createReceiptItems };
