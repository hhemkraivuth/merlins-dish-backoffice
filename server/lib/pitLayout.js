// The pit's look: which theme is on (automatic by date, normal, festive, Valentine's) and the decorations Lily has placed.
// Saved in the App State tab so every phone sees the same pit and nothing needs a code change.
// Keep TYPES in step with the DECOR list in public/office.js.
const KEY = 'pit_layout';
const THEMES = ['auto', 'normal', 'christmas', 'festive', 'valentines', 'lunar', 'easter', 'songkran', 'unicorn', 'pride'];
const TYPES = [
  'plant', 'flowers', 'lamp', 'rug', 'balloons',
  'tree', 'gift', 'wreath', 'snowman', 'lights', 'candycane',
  'fairy', 'candles', 'glow', 'goldstars', 'goldballoons',
  'heart', 'hballoons', 'roses', 'garland', 'hgift',
  'lantern', 'lanterns', 'orangetree', 'envelope', 'ingot',
  'egg', 'basket', 'bunny', 'chick', 'tulips', 'bunting',
  'bucket', 'watergun', 'marigolds', 'splash', 'mgarland',
  'unicorn', 'rainbow', 'cloud', 'sparkles', 'ubal',
  'flag', 'pheart', 'pbanner', 'pballoons',
];
const MAX_ITEMS = 80;
const W = 192; const H = 120;

const round1 = (n) => Math.round(n * 10) / 10;

function sanitise(input) {
  const v = input && typeof input === 'object' ? input : {};
  const theme = THEMES.includes(v.theme) ? v.theme : 'auto';
  const items = [];
  for (const it of Array.isArray(v.items) ? v.items : []) {
    if (!it || !TYPES.includes(it.t)) continue;
    const x = Number(it.x); const y = Number(it.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    items.push({ t: it.t, x: round1(Math.min(W, Math.max(0, x))), y: round1(Math.min(H, Math.max(0, y))) });
    if (items.length >= MAX_ITEMS) break;
  }
  return { theme, items };
}

async function load() {
  try {
    const appState = require('./appState');
    return sanitise(JSON.parse((await appState.getState(KEY)) || '{}'));
  } catch (err) { return sanitise({}); }
}

async function save(input) {
  const appState = require('./appState');
  const v = sanitise(input);
  await appState.setState(KEY, JSON.stringify(v));
  return v;
}

module.exports = { sanitise, load, save, THEMES, TYPES, KEY, MAX_ITEMS };
