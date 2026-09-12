// Plain deterministic logic encoding Merlin's Dish accounting-rules.md.
// No AI calls in this file — everything here is fixed business logic.

const BATCH_COOKED_DISHES = [
  'Tuscan Pork Braise',
  'Polished Pork Bolognese',
  'Bolognese',
  'Noir Ragu',
  'Ragu',
  'Red Wine Beef Stew',
  // extend as new batch-cooked dishes are added
];

const NOODLE_BUNDLE_PRICE = {
  standalone_tubetti_radiatori: 50,
  standalone_other: 55,
  bundled_with_bolognese_ragu_tubetti_radiatori: 5,
  bundled_other: 0,
};

function isBatchCooked(dishName) {
  return BATCH_COOKED_DISHES.some((d) => dishName.toLowerCase().includes(d.toLowerCase()));
}

function getNoodlePrice({ noodleType, isStandalone, isBundledWithBologneseOrRagu }) {
  const isTubettiOrRadiatori = /tubetti|radiatori/i.test(noodleType);
  if (isStandalone) {
    return isTubettiOrRadiatori
      ? NOODLE_BUNDLE_PRICE.standalone_tubetti_radiatori
      : NOODLE_BUNDLE_PRICE.standalone_other;
  }
  if (isBundledWithBologneseOrRagu) {
    return isTubettiOrRadiatori
      ? NOODLE_BUNDLE_PRICE.bundled_with_bolognese_ragu_tubetti_radiatori
      : NOODLE_BUNDLE_PRICE.bundled_other;
  }
  return 0;
}

// Builds the Type-column row sequence for one order: Order rows -> Grab deduction rows -> Recipe rows
// per accounting-rules.md ("Order -> Grab -> Recipe, not Order -> Recipe -> Grab")
async function buildOrderRows(extractedOrder) {
  const rows = [];
  const flags = [];

  const orderType = extractedOrder.is_new_customer ? 'Grab-N' : 'Grab-RT';

  // 1. Order rows — one per distinctly priced line item, gross price (Money In = full order value before deductions)
  for (const item of extractedOrder.items) {
    rows.push({
      type: 'Order',
      dish: item.size ? `${item.name} (${item.size})` : item.name,
      amount: item.gross_price * item.qty,
      orderType,
      customerName: extractedOrder.customer_name || '',
      orderId: extractedOrder.order_id,
      datetime: extractedOrder.transaction_datetime,
    });
  }

  if (!extractedOrder.customer_name) {
    flags.push('Masked/blank customer name');
  }

  // 2. Grab deduction rows — only if present in this order's screenshot
  if (extractedOrder.merchant_funded_discount > 0) {
    rows.push({ type: 'Grab', label: 'Merchant funded discount', amount: -extractedOrder.merchant_funded_discount, orderId: extractedOrder.order_id });
  }
  if (extractedOrder.commission > 0) {
    rows.push({ type: 'Grab', label: 'Commission', amount: -extractedOrder.commission, orderId: extractedOrder.order_id });
  }
  if (extractedOrder.marketing_success_fee > 0) {
    rows.push({ type: 'Grab', label: 'Marketing success fee', amount: -extractedOrder.marketing_success_fee, orderId: extractedOrder.order_id });
  }

  // 3. Recipe cost rows — last. Batch-cooked dishes NEVER get per-order Recipe rows (cost logged at cook time);
  // instead their portion weight is deducted from the active lot (handled by the caller via deductFromLot,
  // since that needs an async Sheets read/write — kept out of this pure function).
  for (const item of extractedOrder.items) {
    if (isBatchCooked(item.name)) {
      continue; // deduction handled separately by the route, per-lot
    }
    // Non-batch dishes (Bacon Steak, drinks, pasta) get a Recipe row per existing rule
    rows.push({
      type: 'Recipe',
      dish: item.name,
      // cost/unit resolved elsewhere from Menu Summary
      orderId: extractedOrder.order_id,
    });
  }

  // Math reconciliation check
  const grossSum = extractedOrder.items.reduce((s, i) => s + i.gross_price * i.qty, 0);
  const expectedNet = grossSum - (extractedOrder.merchant_funded_discount || 0);
  if (Math.abs(expectedNet - extractedOrder.net_total) > 1) {
    flags.push(`Math mismatch: expected net ${expectedNet}, screenshot shows ${extractedOrder.net_total}`);
  }

  if (extractedOrder.uncertain_fields?.length) {
    flags.push(...extractedOrder.uncertain_fields.map((f) => `Vision uncertain: ${f}`));
  }

  return { rows, flags };
}

// Determines what size name to use for a batch-cooked order line, so it maps onto
// the correct fixed-count "size" in the active lot. If vision found a size (e.g.
// "Large"), use it as-is; single-size dishes are stored under "Regular" in the lot.
function resolveSizeName(size) {
  return size || 'Regular';
}

module.exports = { isBatchCooked, getNoodlePrice, buildOrderRows, resolveSizeName, BATCH_COOKED_DISHES };
