// Shorthand used in cook notes.
//
// Dish keywords mirror aliases.js in merlins-dish-bot, so the same words work everywhere.
// Values are the TAB NAMES in the live Merlin's numbers sheet.
//
// Lily can add or change shorthand herself in the "Shorthand" tab of the Claude Log
// (Type | Short | Full name). Rows there override these defaults, so a new keyword never
// needs a code change.

const DEFAULT_DISH_ALIASES = {
  'Polished Pork Bolognese': ['bolo', 'bolognese', 'bolog'],
  'Noir Ragu': ['ragu'],
  'Tuscan Pork Braise': ['tuscan', 'tpb'],
  'Red Wine Beef Stew': ['rws', 'redwinestew'],
  'Dark beer Stew': ['dbs', 'darkbeerstew'],
  'Creamy Chicken Soup': ['chix', 'cs', 'chicsoup', 'chics'],
  'Pecorino & Broccoli Cream Soup': ['brocs', 'bs'],
};

// "meat" is special: it always means the first ingredient line of that dish's tab.
const DEFAULT_INGREDIENT_ALIASES = {
  o: 'Onion',
  g: 'Garlic',
  cl: 'Celery',
  c: 'Carrot',
};

function defaultShorthand() {
  const dishes = new Map();
  for (const [tab, list] of Object.entries(DEFAULT_DISH_ALIASES)) {
    for (const a of list) dishes.set(a, tab);
  }
  const ingredients = new Map(Object.entries(DEFAULT_INGREDIENT_ALIASES));
  return { dishes, ingredients };
}

// Rows from the Shorthand tab: [Type, Short, Full name] (header row optional)
function applyShorthandRows(base, rows = []) {
  const out = { dishes: new Map(base.dishes), ingredients: new Map(base.ingredients) };
  for (const r of rows) {
    const type = String(r[0] || '').trim().toLowerCase();
    const short = String(r[1] || '').trim().toLowerCase().replace(/\s+/g, '');
    const full = String(r[2] || '').trim();
    if (!short || !full) continue;
    if (type === 'dish') out.dishes.set(short, full);
    else if (type === 'ingredient') out.ingredients.set(short, full);
  }
  return out;
}

function seedRows() {
  const rows = [];
  for (const [tab, list] of Object.entries(DEFAULT_DISH_ALIASES)) {
    for (const a of list) rows.push(['Dish', a, tab]);
  }
  for (const [a, full] of Object.entries(DEFAULT_INGREDIENT_ALIASES)) rows.push(['Ingredient', a, full]);
  return rows;
}

module.exports = { defaultShorthand, applyShorthandRows, seedRows };
