// LINE webhook for the back of house group (its own LINE channel, separate from the
// customer bot's). Only messages from BOH_GROUP_ID are acted on.

const { verifySignature, reply, push, getContent } = require('../lib/lineApi');
const { processNote, processReceipt, processTypedReceipt, HELP } = require('../lib/cookService');
const { processStock } = require('../lib/stockService');
const { processLots } = require('../lib/lotService');
const { defaultShorthand, applyShorthandRows } = require('../lib/aliases');
const { bangkokToday } = require('../lib/dates');

const seenEvents = new Map(); // webhookEventId -> timestamp, so LINE redeliveries are not processed twice
function alreadySeen(id) {
  if (!id) return false;
  if (seenEvents.has(id)) return true;
  seenEvents.set(id, Date.now());
  if (seenEvents.size > 500) seenEvents.delete(seenEvents.keys().next().value);
  return false;
}

function defaultDeps() {
  const live = require('../lib/liveData');
  const { appendRows } = require('../lib/sheets');
  const { getAllStock, setStockCount, deductStock } = require('../lib/stockCounts');
  const cookLog = require('../lib/cookLog');
  const { extractReceiptWithCatalogue } = require('../lib/receiptVision');
  const lots = require('../lib/ingredientLots');
  const lotDeps = {
    loadLotBook: () => lots.loadLotBook(bangkokToday()),
    saveLots: lots.saveLots,
    addLots: lots.addLots,
    loadUntracked: lots.loadUntracked,
    loadCatalogue: live.loadCatalogue,
  };

  return {
    token: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    secret: process.env.LINE_CHANNEL_SECRET,
    groupId: process.env.BOH_GROUP_ID,
    reply, push, getContent,
    note: {
      loadShorthand: async () => {
        try { return applyShorthandRows(defaultShorthand(), await cookLog.readShorthandRows()); }
        catch (err) { console.error('Shorthand tab unavailable, using defaults:', err.message); return defaultShorthand(); }
      },
      loadRecipe: live.loadRecipe,
      loadPriceBook: live.loadPriceBook,
      isLogged: cookLog.isLogged,
      batchKey: cookLog.batchKey,
      writeBatch: cookLog.writeBatch,
      deductStock,
      loadLotBook: lotDeps.loadLotBook,
      saveLots: lotDeps.saveLots,
    },
    lots: lotDeps,
    stock: { getAll: getAllStock, setCount: setStockCount },
    // Photo receipts are off unless RECEIPT_PHOTOS=on (they need an Anthropic key). Typed receipts always work.
    receiptPhotos: String(process.env.RECEIPT_PHOTOS || '').toLowerCase() === 'on',
    receipt: {
      loadCatalogue: live.loadCatalogue,
      extractReceipt: extractReceiptWithCatalogue,
      appendExpenseRows: async (rows) => { await appendRows('Expense Log', rows); live.invalidate(); },
      addLots: lotDeps.addLots,
      loadUntracked: lotDeps.loadUntracked,
    },
  };
}

function createHandler(getDeps) {
  async function sendBack(deps, ev, text) {
    try {
      await deps.reply(ev.replyToken, text, deps.token);
    } catch (err) {
      // Reply tokens expire quickly (a receipt read can be slow), so fall back to a push.
      try { await deps.push(ev.source.groupId, text, deps.token); }
      catch (err2) { console.error('LINE reply and push both failed:', err2.message); }
    }
  }

  async function handleEvent(deps, ev) {
    if (ev.type !== 'message' || !ev.source || ev.source.type !== 'group') return;
    if (alreadySeen(ev.webhookEventId)) return;

    const isText = ev.message.type === 'text';
    const text = isText ? ev.message.text.trim() : '';

    // Setup helper: before BOH_GROUP_ID is set, the only thing the bot does is tell you the group id.
    if (!deps.groupId) {
      if (isText && /^(groupid|group id)$/i.test(text)) await sendBack(deps, ev, `This group's id is:\n${ev.source.groupId}\n\nPut it in Railway as BOH_GROUP_ID.`);
      return;
    }
    if (ev.source.groupId !== deps.groupId) return;

    if (isText) {
      if (/^(help|\?)$/i.test(text)) return sendBack(deps, ev, HELP);
      let replies;
      try {
        const sent = new Date(ev.timestamp || Date.now());
        replies = (deps.receipt && deps.receipt.appendExpenseRows && await processTypedReceipt(text, bangkokToday(sent.getTime()), deps.receipt))
          || (deps.lots && await processLots(text, bangkokToday(sent.getTime()), deps.lots))
          || (deps.stock && await processStock(text, deps.stock))
          || await processNote(text, deps.note);
      } catch (err) {
        // Never fail silently in the group: say what went wrong and that nothing was logged.
        console.error('Cook note failed:', err);
        const msg = String((err && err.message) || err).slice(0, 300);
        const access = /permission|403|404|not found|forbidden/i.test(msg)
          ? "\nThis usually means a sheet isn't shared with the app's service account (Merlin's numbers as Viewer, Claude Log as Editor)."
          : '';
        return sendBack(deps, ev, `I couldn't process that. Nothing was changed.\nReason: ${msg}${access}`);
      }
      if (!replies) {
        // Never go quiet: say plainly that the message wasn't understood.
        return sendBack(deps, ev, `I didn't recognise that as a cook note, a stock command or a receipt, so nothing was changed.\nSend "help" to see the formats.`);
      }
      for (const r of replies) await sendBack(deps, ev, r);
      return;
    }

    if (ev.message.type === 'image') {
      if (!deps.receiptPhotos) {
        return sendBack(deps, ev, 'Receipt photos are switched off. Type the receipt instead, for example:\n18/10\nminced pork 1000g 110thb');
      }
      try {
        const content = await deps.getContent(ev.message.id, deps.token);
        const sent = new Date(ev.timestamp || Date.now());
        const messageDate = bangkokToday(sent.getTime());
        const out = await processReceipt(content, messageDate, deps.receipt);
        await sendBack(deps, ev, out);
      } catch (err) {
        console.error('Receipt failed:', err);
        await sendBack(deps, ev, `Couldn't process that photo (${err.message}). Nothing was logged.`);
      }
    }
  }

  return async function webhook(req, res) {
    const deps = getDeps();
    if (!deps.secret || !deps.token) return res.status(503).json({ error: 'LINE channel not configured' });
    if (!verifySignature(req.rawBody, req.get('x-line-signature'), deps.secret)) return res.status(401).json({ error: 'bad signature' });

    res.sendStatus(200); // answer LINE straight away, work continues in the background
    for (const ev of (req.body && req.body.events) || []) {
      handleEvent(deps, ev).catch((err) => console.error('LINE event failed:', err));
    }
  };
}

let defaults = null;
const webhook = createHandler(() => (defaults = defaults || defaultDeps()));

module.exports = { webhook, createHandler };
