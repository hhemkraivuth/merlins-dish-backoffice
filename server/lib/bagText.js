// Typed bags with pieces, for meats counted in pieces per bag (chicken thigh):
//   7pcs 980g + 1pc 150g     two bags, 7 pieces weighing 980g and 1 piece weighing 150g
//   1pc of 7 150g            one thigh taken out of a 7 piece bag, leaving 6
// Pieces pick the bag off the card, grams set the cost.

const NUM = '\\d+(?:[.,]\\d+)?';
const SEG = new RegExp(`^(\\d+)\\s*(?:pcs?|pieces?)(?:\\s*of\\s*(\\d+))?\\s*(${NUM})\\s*(kg|g|gm|grams?)?$`, 'i');
const toNum = (s) => Number(String(s).replace(',', '.'));

// Returns { pieces: [{ n, of, grams }], grams } or null when the text is not in the piece form.
function parsePieceBags(text) {
  const segs = String(text || '').split('+').map((s) => s.trim());
  const pieces = [];
  for (const s of segs) {
    const m = s.match(SEG);
    if (!m) return null;
    const grams = toNum(m[3]) * (/^kg$/i.test(m[4] || '') ? 1000 : 1);
    const n = Number(m[1]); const of = m[2] ? Number(m[2]) : 0;
    if (!(n > 0) || !(grams > 0) || (of && of <= n)) return null;
    pieces.push({ n, of, grams });
  }
  return pieces.length ? { pieces, grams: pieces.reduce((a, p) => a + p.grams, 0) } : null;
}

module.exports = { parsePieceBags };
