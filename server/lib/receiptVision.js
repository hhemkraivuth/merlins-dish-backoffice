// Receipt reading for the LINE intake. Same job as extractReceipt in vision.js, plus it is
// given the list of known ingredient names (Price Tracker) so each line can be mapped to the
// name Lily's sheet uses. That mapping is what lets the cost lookup find the price later.

const Anthropic = require('@anthropic-ai/sdk');

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in Railway for this app. Add it under Variables and redeploy');
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

function prompt(catalogue) {
  return `You are reading a shopping receipt photo for a small Bangkok kitchen.

Extract ONLY what is visible. Return strict JSON, no markdown fences, no commentary:
{
  "shopping_date": string or null,   // as printed, e.g. "13/10/2026" or "2026-10-13"
  "shopped_at": string or null,
  "line_items": [
    {"item_name": string,             // as printed on the receipt
     "ingredient": string or null,    // EXACT name from the known list below if this item is clearly that ingredient, else null
     "purchase_price": number,        // total price paid for this line
     "purchase_qty": number,          // quantity bought, in the unit below
     "purchase_unit": string}         // one of: g, kg, ml, l, piece
  ],
  "receipt_total": number or null,
  "uncertain_fields": [string]
}

Known ingredient names:
${catalogue.join('\n')}

Rules: never invent an ingredient match, use null when unsure. If the weight or volume is part of the item name (e.g. "Minced pork 500g"), use it for purchase_qty and purchase_unit. If handwriting or print is unclear, add the field to uncertain_fields and give your best guess.`;
}

async function extractReceiptWithCatalogue(imageBase64, mediaType, catalogue) {
  const msg = await getClient().messages.create({
    model: process.env.RECEIPT_MODEL || 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: prompt(catalogue) },
      ],
    }],
  });
  const block = msg.content.find((b) => b.type === 'text');
  if (!block) throw new Error('No text response from receipt reading');
  return JSON.parse(block.text.replace(/```json|```/g, '').trim());
}

module.exports = { extractReceiptWithCatalogue };
