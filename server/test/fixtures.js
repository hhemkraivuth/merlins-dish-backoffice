// Real data copied from the Merlin's numbers sheet (15/10/2026) for the 7/10 bolognese test.
const bologneseCsv = `Menu,Polished Pork Bolognese,,,,,,
Selling Price (฿),165.00,,,,,,
,,,,,,,
Ingredients,QTY,Unit,Cost / Unit,Total Cost,,Portion (g),200
Pork - minced,1000,g,0.130,130.00,,all sauce,200
Onion,446,g,0.045,20.07,,,
Garlic,60,g,0.075,4.50,,,
Carrot,223,g,0.017,3.81,,,
Celery,240,g,0.089,21.36,,,
Tomato Paste,160,g,0.304,48.57,,,
Polpa,1600,g,0.130,208.00,,,
Knorr cube - pork full,4,piece,2.000,8.00,,,
Milk,500,ml,0.050,24.94,,,
Balsamic Vinegar,30,ml,0.214,6.42,,,
Anchovies,40,g,1.526,61.06,,,
Nutmeg,0.4,g,3.450,1.38,,,
Thyme,2.8,g,1.480,4.14,,,
Oil,10,g,0.055,0.55,,,
Butter,0,g,0.318,0.00,,,
Ajinomoto,9,g,0.111,1.00,,,
Black pepper,2,g,0.600,1.20,,,
,,,,,,,
Utility costs - cooking (Stove),40,mins,0.244,9.76,,,
Utility costs - cooking (Pressure cooker),40,mins,0.077,3.08,,,
Utility costs - reheating,22,order,0.430,9.46,,,
,,,,,,,
Packaging,,,,,,,
Packaging Cup (26oz),0,Set,3.459,0.00,,,
Packaging Cup (16oz),0,Set,3.215,0.00,,,
Packaging Cup (12oz),22,Set,2.297,50.53,,,
Packaging Box (carb600ml),0,Set,1.540,0.00,,,
,,,,,,,
SUMMARY,,,,,,,
Total Ingredient Cost,,,,1439.23,,,`;

function csvRows(s) { return s.split('\n').map((l) => l.split(',')); }

// Price Log rows: Date | Ingredient | Purchase Price | Purchase Unit | Cost per Recipe Unit | Shopped at
const priceLog = [
  ['Shopping Date', 'Ingredient', 'Purchase Price', 'Purchase Unit', 'Cost per Recipe Unit', 'Shopped at'],
  ['17/09/2026', 'Pork - minced', 135, '1000g', 135 / 1000],
  ['25/09/2026', 'Pork - minced', 130, '1000g', 130 / 1000],
  ['20/10/2026', 'Pork - minced', 150, '1000g', 150 / 1000], // backfilled later purchase, must NOT be used for 7/10
  ['04/10/2026', 'Onion', 90, '2000g', 90 / 2000],
  ['04/10/2026', 'Garlic', 75, '1000g', 75 / 1000],
  ['04/10/2026', 'Carrot', 24.25, '1420g', 24.25 / 1420],
  ['26/09/2026', 'Celery', 178, '2000g', 178 / 2000],
  ['25/09/2026', 'Tomato Paste', 170, '560g', 170 / 560],
  ['25/09/2026', 'Polpa', 325, '2500g', 325 / 2500],
  ['05/07/2026', 'Knorr cube - pork full', 96, '48pcs', 96 / 48],
  ['04/10/2026', 'Milk', 99.75, '2000ml', 99.75 / 2000],
  ['20/08/2026', 'Balsamic Vinegar', 107, '500ml', 107 / 500],
  ['25/09/2026', 'Anchovies', 1038, '680g', 1038 / 680],
  ['16/08/2026', 'Nutmeg', 138, '40g', 138 / 40],
  ['26/07/2026', 'Thyme', 372, '170g', 372 / 170],
  ['26/07/2026', 'Thyme', 1.48, '1g', 1.48],
  ['15/07/2026', 'Oil', 55.19, '1000ml', 55.19 / 1000],
  ['14/07/2026', 'Ajinomoto', 111, '1000g', 111 / 1000],
  ['08/03/2026', 'Ajinomoto', 10, '50g', 0.2],
  ['13/08/2026', 'Black pepper', 60, '100g', 0.6],
  ['08/08/2026', 'Utility costs - cooking (Stove)', 0.24, '1 min', 0.244],
  ['08/08/2026', 'Utility costs - cooking (Pressure cooker)', 0.08, '1 min', 0.077],
  ['31/07/2026', 'Utility costs - reheating', 0.43, 'order', 0.43],
  ['26/10/2025', 'Packaging Cup (12oz)', 2.297, 'Set', 2.297],
];

module.exports = { bologneseRows: csvRows(bologneseCsv), priceLog };
