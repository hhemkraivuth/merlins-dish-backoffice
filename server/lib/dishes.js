// Names shared by the ledger, the reports and sell-through.
// A "batch dish" is cooked in batches (cost logged at cook time, never as a per-order Recipe row).

const BATCH_DISHES = [
  ['Polished Pork Bolognese', /^(polished pork )?bolognese/i],
  ['Noir Ragu', /^(noir )?ragu/i],
  ['Tuscan Pork Braise', /^tuscan pork braise/i],
  ['Red Wine Beef Stew', /^red wine beef stew/i],
  ['Dark beer Stew', /^dark beer stew/i],
  ['Creamy Chicken Soup', /^creamy chicken soup/i],
  ['Pecorino & Broccoli Cream Soup', /^pecorino/i],
];

// Rows that look like a dish name but are not a portion: size upgrades and side charges.
const NOT_A_PORTION = /upgrade|upcharge|serving size|utensil/i;

const PASTAS = ['tubetti', 'radiatori', 'rigatoni', 'lumache', 'linguine', 'spaghetti', 'heart', 'chefferi', 'farfalle'];

function normName(s) {
  return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

// Returns the canonical dish tab name, or null. Anchored at the start so that a pasta row such as
// "Rigatoni (paired with Noir Ragu)" is never mistaken for the Ragu itself.
function batchDishOf(desc) {
  const d = String(desc || '').trim();
  if (!d || NOT_A_PORTION.test(d)) return null;
  for (const [name, re] of BATCH_DISHES) if (re.test(d)) return name;
  return null;
}

// "Tubetti (standalone side)" / "Rigatoni (paired with X)" / "Tubetti (Extra)" -> "tubetti"
function pastaOf(desc) {
  const first = String(desc || '').trim().toLowerCase().split(/[\s(]/)[0];
  return PASTAS.includes(first) ? first : null;
}

module.exports = { BATCH_DISHES, PASTAS, NOT_A_PORTION, normName, batchDishOf, pastaOf };
