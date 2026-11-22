// Pinned notes for the team report pop up. A pinned note cannot be marked Noted or dismissed. It stays on the pop up, the Home strip and the
// Team report button every day between `from` and `to` (inclusive), then drops off by itself. Add new ones to PINNED.

const PINNED = [
  {
    id: 'xmas-web-2026',
    team: 'Marketing',
    from: '2026-11-23',
    to: '2027-01-15',
    title: 'Order web decorations (Christmas and New Year)',
    phases: [
      { from: '2026-11-23', to: '2026-12-12', text: 'Christmas decorations' },
      { from: '2026-12-13', to: '2026-12-25', text: 'Christmas and New Year together' },
      { from: '2026-12-26', to: '2027-01-15', text: 'New Year only, Christmas is off' },
    ],
    after: 'From 16/01/2027 all decorations switch off by themselves.',
    footer: 'Preview any day: add ?xmas=1, ?xmas=both, ?xmas=ny or ?xmas=0 to the order web address.',
  },
];

const dmy = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };

// todayIso "YYYY-MM-DD" -> [{ key, team, title, lines }] for the notes that apply today.
function pinnedFor(todayIso) {
  return PINNED.filter((p) => todayIso >= p.from && todayIso <= p.to).map((p) => {
    const now = (p.phases || []).find((ph) => todayIso >= ph.from && todayIso <= ph.to);
    const lines = [];
    if (now) lines.push(`Now: ${now.text}.`);
    (p.phases || []).forEach((ph) => lines.push(`${dmy(ph.from)} to ${dmy(ph.to)}: ${ph.text}${now === ph ? ' (now)' : ''}`));
    if (p.after) lines.push(p.after);
    if (p.footer) lines.push(p.footer);
    return { key: `pin|${p.id}`, team: p.team, title: p.title, until: dmy(p.to), lines };
  });
}

module.exports = { pinnedFor, PINNED };
