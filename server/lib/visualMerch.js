// Visual Merchandise: dresses the order web (the shop "window") for every event and season.
// SEASONS is the schedule the order web follows (the same dates live in the order web repo, public/xmas.js).
// Dates are Bangkok time, inclusive. Add the next event here and in the order web's decoration file.

const SEASONS = [
  { from: '2026-11-23', to: '2026-12-12', short: 'Christmas', text: 'Christmas decorations' },
  { from: '2026-12-13', to: '2026-12-25', short: 'Christmas + New Year', text: 'Christmas and New Year together' },
  { from: '2026-12-26', to: '2027-01-15', short: 'New Year', text: 'New Year only, Christmas is off' },
];
const OFF_FROM = '2027-01-16'; // the day after the last season ends
const END_NOTE = 'From 16/01/2027 all decorations switch off by themselves.';

const dmy = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
const dm = (iso) => dmy(iso).slice(0, 5);

// What the window is wearing today and what changes next.
function windowNow(todayIso) {
  const now = SEASONS.find((s) => todayIso >= s.from && todayIso <= s.to) || null;
  const next = SEASONS.find((s) => s.from > todayIso) || null;
  return { now, next };
}

// The Pit card for the Visual Merchandise team.
function pitCard(todayIso) {
  const { now, next } = windowNow(todayIso);
  const card = { name: 'Visual Merchandise', key: 'Visual Merchandise', channel: null, updates: [] };
  if (now) {
    card.top = now.short;
    card.line = 'on the order web';
    card.note = next ? `Next change ${dm(next.from)}: ${next.short}` : `Off ${dmy(OFF_FROM)}`;
  } else if (next) {
    card.top = 'Starts ' + dm(next.from);
    card.line = next.short;
  } else {
    card.top = 'Plain window';
    card.line = 'no event scheduled';
  }
  card.headline = card.top;
  return card; // no updates on purpose: the pinned note in the team report carries the reminder, so the pop up is not doubled
}

module.exports = { SEASONS, END_NOTE, OFF_FROM, windowNow, pitCard, dmy };
