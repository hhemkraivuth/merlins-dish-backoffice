const test = require('node:test');
const assert = require('node:assert');
const { parseDate, utc } = require('../lib/dates');
const { buildPriceBook, parsePurchaseUnit } = require('../lib/priceBook');
const { parseDishTab } = require('../lib/sheetRecipe');
const { parseNote, looksLikeAttempt } = require('../lib/noteParser');
const { defaultShorthand, applyShorthandRows } = require('../lib/aliases');
const { costBatch } = require('../lib/costBatch');
const { bologneseRows, priceLog } = require('./fixtures');

const TODAY = utc(2026, 10, 15);
const NOTE = `7/10
Bolo
Meat 1000
O 446
G 60
Cl 234
C 230
yield 21`;

test('dates', () => {
  assert.strictEqual(parseDate('7/10', TODAY).toISOString().slice(0, 10), '2026-10-07');
  assert.strictEqual(parseDate('20/12', TODAY).toISOString().slice(0, 10), '2025-12-20'); // future date -> last year
  assert.strictEqual(parseDate('26/10/2025', TODAY).toISOString().slice(0, 10), '2025-10-26');
  assert.strictEqual(parseDate(46302, TODAY).toISOString().slice(0, 10), '2026-10-07'); // Sheets serial
  assert.strictEqual(parseDate('31/02/2026', TODAY), null);
});

test('purchase units', () => {
  assert.deepStrictEqual(parsePurchaseUnit('1kg'), { qty: 1000, unit: 'g' });
  assert.deepStrictEqual(parsePurchaseUnit('2000ml'), { qty: 2000, unit: 'ml' });
  assert.deepStrictEqual(parsePurchaseUnit('48-pieces'), { qty: 48, unit: 'piece' });
});

test('price book uses latest purchase ON OR BEFORE the cook date', () => {
  const book = buildPriceBook({ priceLogRows: priceLog, today: TODAY });
  assert.strictEqual(book.lookup('Pork - minced', utc(2026, 10, 7)).cost, 0.13);  // not the 20/10 backfill
  assert.strictEqual(book.lookup('Pork - minced', utc(2026, 9, 20)).cost, 0.135);
  assert.strictEqual(book.lookup('Pork - minced', utc(2026, 10, 25)).cost, 0.15);
  assert.ok(book.lookup('Pork - minced', utc(2026, 1, 1)).missing);
  assert.strictEqual(book.lookup('Mutti polpa', utc(2026, 10, 7)).cost, 0.13);    // Polpa == Mutti polpa
  assert.strictEqual(book.lookup('Thyme', utc(2026, 10, 7)).cost, 1.48);          // same-day tie: later row wins
});

test('expense log rows are normalised per g, not per kg', () => {
  const book = buildPriceBook({
    priceLogRows: [],
    expenseRows: [['Shopping Date', 'Ingredient'], ['05/10/2026', 'Pork - minced', 260, '2kg', 130]],
    today: TODAY,
  });
  assert.strictEqual(book.lookup('Pork - minced', utc(2026, 10, 7)).cost, 0.13);
});

test('dish tab parses into recipe, packaging and utility', () => {
  const r = parseDishTab(bologneseRows);
  assert.strictEqual(r.dish, 'Polished Pork Bolognese');
  assert.strictEqual(r.sellingPrice, 165);
  assert.strictEqual(r.ingredients[0].name, 'Pork - minced');
  assert.strictEqual(r.ingredients.length, 17);
  assert.strictEqual(r.utility.length, 3);
  assert.strictEqual(r.usualYield, 22);
});

test('note parser reads the 7/10 note', () => {
  const sh = defaultShorthand();
  const { batches, problems } = parseNote(NOTE, sh, TODAY);
  assert.deepStrictEqual(problems, []);
  assert.strictEqual(batches.length, 1);
  assert.strictEqual(batches[0].dishTab, 'Polished Pork Bolognese');
  assert.strictEqual(batches[0].yield, 21);
  assert.strictEqual(batches[0].lines.length, 5);
  assert.strictEqual(batches[0].date.toISOString().slice(0, 10), '2026-10-07');
  assert.ok(looksLikeAttempt(NOTE));
  assert.ok(!looksLikeAttempt('see you at 7 for dinner'));
});

test('note parser handles several batches and "21 servings"', () => {
  const sh = defaultShorthand();
  const { batches } = parseNote('7/10 bolo\nmeat 1.2kg\n21 servings\n\nragu\nmeat 900\nyield 14', sh, TODAY);
  assert.strictEqual(batches.length, 2);
  assert.strictEqual(batches[0].lines[0].qty, 1200);
  assert.strictEqual(batches[0].yield, 21);
  assert.strictEqual(batches[1].dishTab, 'Noir Ragu');
  assert.strictEqual(batches[1].date.toISOString().slice(0, 10), '2026-10-07');
});

test('shorthand tab rows add and override keywords', () => {
  const sh = applyShorthandRows(defaultShorthand(), [['Type', 'Short', 'Full name'], ['Ingredient', 'tp', 'Tomato Paste'], ['Dish', 'bol', 'Polished Pork Bolognese']]);
  assert.strictEqual(sh.ingredients.get('tp'), 'Tomato Paste');
  assert.strictEqual(sh.dishes.get('bol'), 'Polished Pork Bolognese');
  assert.strictEqual(sh.dishes.get('bolo'), 'Polished Pork Bolognese');
});

test('7/10 bolognese costs 614.69 / 29.27 per portion', () => {
  const sh = defaultShorthand();
  const recipe = parseDishTab(bologneseRows);
  const book = buildPriceBook({ priceLogRows: priceLog, today: TODAY });
  const { batches } = parseNote(NOTE, sh, TODAY);
  const r = costBatch({ batch: batches[0], recipe, shorthand: sh, priceBook: book });
  assert.strictEqual(r.yield, 21);
  assert.strictEqual(r.ingredientCost, 544.59);
  assert.strictEqual(r.utilityCost, 21.87);
  assert.strictEqual(r.packagingCost, 48.24);
  assert.strictEqual(r.total, 614.69);
  assert.strictEqual(r.perPortion, 29.27);
  assert.strictEqual(r.foodCostPct, 17.7);
  const cups = r.lines.find((l) => l.name === 'Packaging Cup (12oz)');
  assert.strictEqual(cups.qty, 21);
  const reheat = r.lines.find((l) => /reheating/.test(l.name));
  assert.strictEqual(reheat.qty, 21);
  const pork = r.lines.find((l) => l.name === 'Pork - minced');
  assert.strictEqual(pork.qty, 1000);
  assert.strictEqual(pork.unitCost, 0.13);
  assert.strictEqual(pork.priceDate, '25/09/2026');
  assert.deepStrictEqual(r.notes, ['Meat read as Pork - minced']);
  assert.deepStrictEqual(r.flags, []);
});

test('backfilling a later purchase does not change an earlier batch', () => {
  const sh = defaultShorthand();
  const recipe = parseDishTab(bologneseRows);
  const { batches } = parseNote(NOTE, sh, TODAY);
  const before = costBatch({ batch: batches[0], recipe, shorthand: sh, priceBook: buildPriceBook({ priceLogRows: priceLog.filter((r) => r[0] !== '20/10/2026'), today: TODAY }) });
  const after = costBatch({ batch: batches[0], recipe, shorthand: sh, priceBook: buildPriceBook({ priceLogRows: priceLog, today: TODAY }) });
  assert.strictEqual(before.total, after.total);
});

test('flags: low yield, missing yield, unknown ingredient, price jump', () => {
  const sh = defaultShorthand();
  const recipe = parseDishTab(bologneseRows);
  const book = buildPriceBook({ priceLogRows: priceLog, today: TODAY });
  const low = costBatch({ batch: parseNote('7/10\nbolo\nmeat 300\nyield 8', sh, TODAY).batches[0], recipe, shorthand: sh, priceBook: book });
  assert.ok(low.flags.some((f) => /Low yield/.test(f)));
  const noYield = costBatch({ batch: parseNote('7/10\nbolo\nmeat 1000', sh, TODAY).batches[0], recipe, shorthand: sh, priceBook: book });
  assert.strictEqual(noYield.perPortion, null);
  assert.ok(noYield.flags.some((f) => /No yield/.test(f)));
  const unknown = costBatch({ batch: parseNote('7/10\nbolo\nzzz 50\nyield 21', sh, TODAY).batches[0], recipe, shorthand: sh, priceBook: book });
  assert.ok(unknown.flags.some((f) => /not recognised/.test(f)));
  const jumpBook = buildPriceBook({ priceLogRows: [...priceLog, ['06/10/2026', 'Onion', 90, '2000g', 2.0]], today: TODAY });
  const jump = costBatch({ batch: parseNote(NOTE, sh, TODAY).batches[0], recipe, shorthand: sh, priceBook: jumpBook });
  assert.ok(jump.flags.some((f) => /Onion: price moved/.test(f)));
});

test('merged date cells: a blank date takes the date of the row above (Price Log only)', () => {
  const rows = [
    ['Shopping Date', 'Ingredient', 'Purchase Price', 'Purchase Unit', 'Cost per Recipe Unit'],
    ['01/10/2026', 'Onion', 60, '2000g', 0.03],
    ['', 'Garlic', 75, '1000g', 0.075],      // same trip as the onion row
    [undefined, 'Carrot', 20, '1000g', 0.02], // Google omits trailing empty cells
    ['05/10/2026', 'Milk', 99, '2000ml', 0.0495],
    ['', 'Butter', 100, '250g', 0.4],
  ];
  const book = buildPriceBook({ priceLogRows: rows, today: TODAY });
  assert.strictEqual(book.lookup('Garlic', utc(2026, 10, 1)).cost, 0.075);   // inherits 01/10
  assert.strictEqual(book.lookup('Carrot', utc(2026, 10, 1)).cost, 0.02);
  assert.ok(book.lookup('Butter', utc(2026, 10, 4)).missing);                // inherits 05/10, so not yet bought on 04/10
  assert.strictEqual(book.lookup('Butter', utc(2026, 10, 5)).cost, 0.4);
  assert.strictEqual(book.skipped.inherited, 3);
  // receipt rows never inherit
  const exp = buildPriceBook({ expenseRows: [['Shopping Date', 'Ingredient', 'Purchase Price', 'Purchase Unit'], ['01/10/2026', 'Onion', 60, '2000g'], ['', 'Garlic', 75, '1000g']], today: TODAY });
  assert.ok(!exp.lookup('Garlic', utc(2026, 10, 7)));
  assert.strictEqual(exp.skipped.noDate, 1);
});
