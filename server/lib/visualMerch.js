// Visual Merchandise: dresses the order web (the shop "window") for every event and season.
// SEASONS is the schedule the order web follows (the same dates live in the order web repo, public/xmas.js).
// Dates are Bangkok time, inclusive. Add the next event here and in the order web's decoration file.

const SEASONS = [
  { from: '2026-11-23', to: '2026-12-12', short: 'Christmas', text: 'Christmas decorations' },
  { from: '2026-12-13', to: '2026-12-25', short: 'Christmas + New Year', text: 'Christmas and New Year together' },
  { from: '2026-12-26', to: '2027-01-15', short: 'New Year', text: 'New Year only, Christmas is off' },
];
// The year ahead, planned but not built. Windows are suggested dates (Lily can change them). Event dates marked "check" need confirming nearer the time.
const PLANNED = [
  { name: "Lunar New Year", event: '06/02/2027', from: '2027-01-30', to: '2027-02-13', note: 'Red and gold. Shop is back from 04/01/2027.' },
  { name: "Valentine's Day", event: '14/02/2027', from: '2027-02-08', to: '2027-02-15', note: 'Overlaps Lunar New Year, so they can run together like Christmas and New Year.' },
  { name: 'Easter', event: '28/03/2027', from: '2027-03-21', to: '2027-03-29', note: 'Good Friday is 26/03/2027.' },
  { name: 'Songkran', event: '13/04/2027 to 15/04/2027', from: '2027-04-06', to: '2027-04-16', note: 'Water, flowers, Thai New Year. Check the shop closure.' },
  { name: 'Oktoberfest', event: '18/09/2027 to 03/10/2027 (check)', from: '2027-09-18', to: '2027-10-03', note: 'Fits the beer stews.' },
  { name: 'Pride month', event: 'June 2027', from: '2027-06-01', to: '2027-06-30', note: 'Rainbow window for the whole month.' },
  { name: 'Christmas 2027', event: '25/12/2027', from: '2027-11-22', to: '2027-12-25', note: 'The Christmas layer comes back, then New Year again.' },
];
// Ideas Lily has not decided on yet.
const MAYBE = [
  { name: 'Loy Krathong', event: 'Full moon, November (check the 2027 date)' },
  { name: 'Halloween', event: '31/10/2027' },
  { name: 'Thanksgiving', event: '25/11/2027, a hook for the expat customers' },
  { name: "Mother's Day (Thailand)", event: '12/08/2027' },
  { name: "Father's Day (Thailand)", event: '05/12/2027' },
  { name: "Mother's Day (Australia and US)", event: 'May 2027, for the expats' },
  { name: 'Australia Day', event: '26/01/2027, a nod to the Aussie side' },
  { name: 'Shop birthday', event: 'Merlin\'s Dish own birthday' },
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
  const card = { name: 'VM', key: 'Visual Merchandise', channel: null, updates: [] };
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

module.exports = { PLANNED, MAYBE, SEASONS, END_NOTE, OFF_FROM, windowNow, pitCard, dmy };
