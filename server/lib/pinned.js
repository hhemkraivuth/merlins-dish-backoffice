// Pinned notes for the team report pop up. A pinned note cannot be marked Noted or dismissed. It stays on the pop up, the Home strip and the
// Team report button every day between `from` and `to` (inclusive), then drops off by itself. Add new ones to PINNED.
const { SEASONS, END_NOTE, OFF_FROM, dmy } = require('./visualMerch');

const PINNED = [
  {
    id: 'xmas-web-2026',
    team: 'Visual Merchandise',
    from: SEASONS[0].from,
    to: SEASONS[SEASONS.length - 1].to,
    title: 'Order web decorations',
    seasons: SEASONS,
    after: END_NOTE,
  },
];

const dm = (iso) => dmy(iso).slice(0, 5);

// todayIso "YYYY-MM-DD" -> [{ key, team, title, until, now, later, lines }] for the notes that apply today.
// now: one short line. later: one short line of what changes next. lines: the full list (used by the handover and tests).
function pinnedFor(todayIso) {
  return PINNED.filter((p) => todayIso >= p.from && todayIso <= p.to).map((p) => {
    const cur = p.seasons.find((s) => todayIso >= s.from && todayIso <= s.to);
    const upcoming = p.seasons.filter((s) => s.from > todayIso);
    const lines = [];
    if (cur) lines.push(`Now: ${cur.text}.`);
    p.seasons.forEach((s) => lines.push(`${dmy(s.from)} to ${dmy(s.to)}: ${s.text}${cur === s ? ' (now)' : ''}`));
    if (p.after) lines.push(p.after);
    const later = [...upcoming.map((s) => `${dm(s.from)} ${s.short}`), `off ${dm(OFF_FROM)}/${OFF_FROM.slice(0, 4)}`].join(', ');
    return { key: `pin|${p.id}`, team: p.team, title: p.title, until: dmy(p.to), now: cur ? cur.short : '', later, lines };
  });
}

module.exports = { pinnedFor, PINNED };
