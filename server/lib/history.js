// Months from before the app existed, copied from the "Log" tab of the Merlin's numbers sheet (read on 05/11/2026).
// Only totals are known for these months, so the Numbers page shows them as they are.
// A month the app has its own data for always wins over a row here.
//
// Columns copied: direct sales (LINE/IG), Meta ads, Grab sales, merchant funded, service fee, marketing fee,
// Net Grab earning (already after Grab ads and adjustments), Costs (approx) and Monthly Net Profit.
const { utc } = require('./dates');

const HISTORY = [
  // [year, month, direct, metaAds, grabSales, discount, serviceFee, marketingFee, netGrab, costs, profit]
  [2025, 11, 2455, 1077, 0, 0, 0, 0, 0, 2131.40, -753.40],
  [2025, 12, 960, 0, 0, 0, 0, 0, 0, 609.26, 350.74],
  [2026, 1, 4325, 1312.30, 0, 0, 0, 0, 0, 3288.62, -275.92],
  [2026, 2, 8725, 3679.26, 0, 0, 0, 0, 0, 4707.33, 338.41],
  [2026, 3, 5514, 2176.76, 420, 0, 0, 48.15, 0, 2611.50, 725.74],
  [2026, 4, 1536, 2077.39, 5377, 106, 1692.03, 310.84, 2964.32, 4043.28, -1620.35],
  [2026, 5, 0, 0, 3889.20, 154, 1198.94, 195.81, 2249.43, 353.78, 1895.65],
  [2026, 6, 0, 0, 28696, 624, 9211.52, 2052.26, 15319.57, 18330.64, -3011.07],
  [2026, 7, 2357, 0, 58506, 4796, 17240.98, 4772.21, 30194.35, 18921.42, 13629.93],
  [2026, 8, 1285, 0, 83237, 8751, 23910.07, 7002.18, 41636.35, 27852.23, 15069.12],
  [2026, 9, 1268, 0, 114006, 13311, 32323.20, 7820.75, 56390.25, 32388.77, 25269.48],
];

const r2 = (n) => Math.round(n * 100) / 100;

function historyMonths() {
  return HISTORY.map(([y, m, direct, ads, gross, discount, commission, marketing, netGrab, costs, profit]) => ({
    key: `${y}-${String(m).padStart(2, '0')}`,
    label: `${String(m).padStart(2, '0')}/${y}`,
    from: utc(y, m, 1),
    to: new Date(Date.UTC(y, m, 0)),
    history: true,
    grab: { orders: 0, gross, discount, commission, marketing, otherFees: r2(Math.max(gross - discount - commission - marketing - netGrab, 0)), net: netGrab },
    line: { orders: 0, gross: direct, discount: 0, net: direct, delivery: 0, rider: 0 },
    revenue: r2(direct + netGrab),
    foodCost: 0, overheads: 0, purchases: 0, moneyToTakeOut: null,
    ads, costs, margin: profit, marginPct: null,
    missingCosts: [], flags: [],
  }));
}

// Months the app already has data for are kept as they are; history fills only the months before them.
function withHistory(live) {
  const have = new Set(live.filter((p) => p.grab.gross || p.line.gross || p.foodCost || p.overheads).map((p) => p.key));
  const firstLive = live.length ? live[0].key : '9999-99';
  const older = historyMonths().filter((h) => !have.has(h.key) && h.key < firstLive);
  return [...older, ...live];
}

module.exports = { historyMonths, withHistory, HISTORY };
