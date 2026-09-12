const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// One small, cheap call per order-pair or per receipt — this is the ONLY step
// that costs meaningful tokens. Everything downstream (rules, sequencing,
// lot depletion) is plain deterministic JS, not AI.

const ORDER_EXTRACTION_PROMPT = `You are reading two Grab food delivery app screenshots for ONE order: a detail screen and a payment screen.

Extract ONLY what is visible. Return strict JSON, no markdown fences, no commentary:
{
  "order_id": string,
  "transaction_datetime": string,
  "customer_name": string or null (null if masked/blank),
  "is_new_customer": boolean,
  "items": [{"name": string, "size": string or null, "gross_price": number, "qty": number}],
  "net_total": number,
  "gross_order_value": number,
  "merchant_funded_discount": number or 0,
  "commission": number or 0,
  "marketing_success_fee": number or 0,
  "uncertain_fields": [string]
}

For "size": some dishes (e.g. Red Wine Beef Stew) come in named sizes like "Regular" or "Large" — read this from the item name/option text if shown (e.g. "Red Wine Beef Stew (Large)"). For dishes with only one size, set size to null.

If a field is unclear or unreadable, put it in uncertain_fields and make your best-effort guess for the value.`;

const RECEIPT_EXTRACTION_PROMPT = `You are reading a shopping receipt photo.

Extract ONLY what is visible. Return strict JSON, no markdown fences, no commentary:
{
  "shopping_date": string or null,
  "shopped_at": string or null,
  "line_items": [
    {"item_name": string, "purchase_price": number, "purchase_qty": number, "purchase_unit": string}
  ],
  "receipt_total": number or null,
  "uncertain_fields": [string]
}

If handwriting or print is unclear, put the field in uncertain_fields and make your best-effort guess.`;

const ORDER_ID_ONLY_PROMPT = `Look at this single Grab food delivery app screenshot (either an order-detail screen or a payment screen).

Return strict JSON only, no markdown fences, no commentary:
{
  "order_id": string or null,
  "screen_type": "detail" or "payment" or "unknown"
}

The order ID is usually shown near the top of the screen, often prefixed like "GF-" or as a longer alphanumeric code. If you cannot read it, return null.`;

// Cheap first-pass call: read just the Order ID + screen type off ONE image.
// Used to group a batch of mixed screenshots into detail+payment pairs before
// running the full extraction, so pairing works regardless of upload order.
async function extractOrderIdAndScreenType(imageBase64, mediaType = 'image/png') {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: ORDER_ID_ONLY_PROMPT },
        ],
      },
    ],
  });
  return parseJsonResponse(msg);
}

async function extractOrderPair(detailImageBase64, paymentImageBase64, mediaType = 'image/png') {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: detailImageBase64 } },
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: paymentImageBase64 } },
          { type: 'text', text: ORDER_EXTRACTION_PROMPT },
        ],
      },
    ],
  });
  return parseJsonResponse(msg);
}

async function extractReceipt(imageBase64, mediaType = 'image/png') {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: RECEIPT_EXTRACTION_PROMPT },
        ],
      },
    ],
  });
  return parseJsonResponse(msg);
}

function parseJsonResponse(msg) {
  const textBlock = msg.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text response from vision extraction');
  const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { extractOrderPair, extractReceipt, extractOrderIdAndScreenType };
