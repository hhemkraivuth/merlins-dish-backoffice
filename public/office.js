// The office: the same layout, size and colours as the original pixel office, redrawn as soft flat shapes (no pixels).
// One desk per team, four pigs in red, blue, yellow and green t shirts and a giraffe chef who walk between the desks.
// Plain SVG. Desk name plates are HTML on top so they stay sharp and tappable.
(function () {
  const W = 192, H = 120, LANE = 54;
  const DESKS = [[16, 16], [82, 16], [148, 16], [48, 72], [116, 72]]; // top-left of each desk, 28 x 12
  const TOP_ROW = 3;
  const KITCHEN = 2; // Operations
  const SPOTS = [[10, 96], [88, 98], [166, 78]]; // standing spots on the floor, so five characters can always move
  const SCREEN = ['#7fd6a0', '#7fb6f0', '#f4c27f', '#e8a0c0', '#c9a0f0'];
  const PIGS = [
    { name: 'Red', shirt: '#e63d23' },
    { name: 'Blue', shirt: '#294bd4' },
    { name: 'Yellow', shirt: '#f8cc1a' },
    { name: 'Green', shirt: '#2e8b6e' },
    { name: 'Chef', giraffe: true },
  ];
  const P = { pink: '#f4a6b8', ear: '#e07a95', snout: '#d9607f', ink: '#2b1b1b', boot: '#5a3b2e', collar: '#8a5a3b' };

  function seatOf(i) {
    if (i >= DESKS.length) { const [sx, sy] = SPOTS[i - DESKS.length]; return { seat: [sx, sy], out: [[sx, LANE]], into: [[sx, LANE]] }; }
    const [dx, dy] = DESKS[i];
    const sx = dx + 8, sy = dy + 16;
    if (i < TOP_ROW) return { seat: [sx, sy], out: [[sx, LANE]], into: [[sx, LANE]] };
    const ax = dx - 14;
    return { seat: [sx, sy], out: [[ax, sy], [ax, LANE]], into: [[ax, LANE], [ax, sy]] };
  }
  const STATIONS = [...DESKS, ...SPOTS];
  const SEATS = STATIONS.map((_, i) => seatOf(i));
  function route(from, to) {
    const a = SEATS[from], b = SEATS[to];
    return [...a.out, [b.into[0][0], LANE], ...b.into.slice(1), b.seat];
  }

  // A character is drawn in a 12 x 12 box (the pixel sprite's size), origin top left.
  function pig(shirt) {
    return `
      <rect x="3" y="9" width="2.4" height="3" rx="1.2" fill="${P.boot}"/><rect x="6.6" y="9" width="2.4" height="3" rx="1.2" fill="${P.boot}"/>
      <rect x="2" y="6" width="8" height="5" rx="1.6" fill="${shirt}"/>
      <path d="M1.2 1.8 Q.2 -.6 3 .2 Q3.6 1 3.6 2 Z" fill="${P.ear}"/><path d="M10.8 1.8 Q11.8 -.6 9 .2 Q8.4 1 8.4 2 Z" fill="${P.ear}"/>
      <rect x="1.2" y=".2" width="9.6" height="6.4" rx="3" fill="${P.pink}"/>
      <rect x="2.6" y="5.6" width="6.8" height="1.2" rx=".6" fill="${P.collar}"/>
      <ellipse cx="6" cy="4.2" rx="2" ry="1.4" fill="${P.snout}"/>
      <circle cx="2.8" cy="3.6" r=".9" fill="#f08aa0" opacity=".7"/><circle cx="9.2" cy="3.6" r=".9" fill="#f08aa0" opacity=".7"/>
      <circle cx="4.2" cy="2.6" r=".5" fill="${P.ink}"/><circle cx="7.8" cy="2.6" r=".5" fill="${P.ink}"/>`;
  }
  function giraffe() {
    // Same overall height as before. The neck is 3.6 shorter, the chef's hat 3.6 taller (a tall toque, not a turban),
    // and the body is the same size as a pig's.
    const body = '#f2c46d', spot = '#b9824a';
    return `
      <rect x="3" y="9" width="2.4" height="3" rx="1.2" fill="${P.boot}"/><rect x="6.6" y="9" width="2.4" height="3" rx="1.2" fill="${P.boot}"/>
      <rect x="2" y="6" width="8" height="5" rx="1.6" fill="#ffffff"/>
      <rect x="4.6" y="-5.4" width="2.8" height="12.8" rx="1.4" fill="${body}"/>
      <circle cx="5.4" cy="-2.8" r=".7" fill="${spot}"/><circle cx="6.6" cy="0" r=".7" fill="${spot}"/><circle cx="5.4" cy="2.8" r=".7" fill="${spot}"/><circle cx="6.6" cy="5.4" r=".7" fill="${spot}"/>
      <rect x="1.6" y="-10.6" width="8.8" height="6.4" rx="3" fill="${body}"/>
      <ellipse cx="6" cy="-6.4" rx="2.4" ry="1.5" fill="#f8dfae"/>
      <circle cx="5.2" cy="-6.4" r=".35" fill="${P.ink}"/><circle cx="6.8" cy="-6.4" r=".35" fill="${P.ink}"/>
      <circle cx="4" cy="-8.2" r=".5" fill="${P.ink}"/><circle cx="8" cy="-8.2" r=".5" fill="${P.ink}"/>
      <circle cx="2" cy="-9.4" r=".8" fill="${spot}"/><circle cx="10" cy="-9.4" r=".8" fill="${spot}"/>
      <rect x="3.6" y="-14.6" width="4.8" height="4.2" rx=".8" fill="#ffffff"/>
      <ellipse cx="6" cy="-15.4" rx="3.9" ry="2" fill="#ffffff"/><circle cx="3.2" cy="-14.6" r="1.6" fill="#ffffff"/><circle cx="8.8" cy="-14.6" r="1.6" fill="#ffffff"/>
      <rect x="4.9" y="-14.2" width=".35" height="3.2" fill="#dfe2ea"/><rect x="5.85" y="-14.2" width=".35" height="3.2" fill="#dfe2ea"/><rect x="6.8" y="-14.2" width=".35" height="3.2" fill="#dfe2ea"/>
      <rect x="3.3" y="-11.4" width="5.4" height="1.3" rx=".6" fill="#eceef3"/>`;
  }

  // ---- Themes: costumes for the team and decorations for the room, switched together.
  const heart = (cx, cy, k, fill) => `<path transform="translate(${cx} ${cy}) scale(${k})" d="M0 1.5 C-3.2 -.8 -1.8 -3 0 -1.4 C1.8 -3 3.2 -.8 0 1.5Z" fill="${fill}"/>`;
  const sparkle = (cx, cy, k, fill) => `<path transform="translate(${cx} ${cy}) scale(${k})" d="M0 -2 L.6 -.6 L2 0 L.6 .6 L0 2 L-.6 .6 L-2 0 L-.6 -.6Z" fill="${fill}"/>`;
  const RED = '#d62828', GREEN = '#2e7d4f', POT = '#b5654a', GOLD = '#f8cc1a';
  const PRIDE = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#004dff', '#750787'];
  // One shared gradient for the Pride rainbow (hard stripes), referenced as url(#prideGrad).
  const PRIDE_DEFS = `<defs><linearGradient id="prideGrad" x1="0" y1="0" x2="0" y2="1">${PRIDE.map((c, i) => `<stop offset="${(i / 6) * 100}%" stop-color="${c}"/><stop offset="${((i + 1) / 6) * 100}%" stop-color="${c}"/>`).join('')}</linearGradient></defs>`;
  const prideShirt = () => PRIDE.map((c, i) => `<rect x="2.4" y="${(6.8 + i * 0.64).toFixed(2)}" width="7.2" height=".66" fill="${c}"/>`).join('');
  const sag = (n, f) => Array.from({ length: n }, (_, i) => { const t = (i + 0.5) / n; return f(-14 + 28 * t, 12 * t * (1 - t), i); }).join('');
  const STRING = '<path d="M-14 0 Q0 6 14 0" stroke="#4a4f5c" stroke-width=".3" fill="none"/>';
  const bunting = (cols) => STRING + sag(8, (x, y, i) => `<path d="M${(x - 1.5).toFixed(1)} ${y.toFixed(1)} L${(x + 1.5).toFixed(1)} ${y.toFixed(1)} L${x.toFixed(1)} ${(y + 3.4).toFixed(1)}Z" fill="${cols[i % cols.length]}"/>`);
  const balloon = (x, y, c) => `<ellipse cx="${x}" cy="${y}" rx="2.4" ry="3" fill="${c}"/><path d="M${x} ${y + 3} L0 0" stroke="#7d8492" stroke-width=".3" fill="none"/>`;
  const egg = (x, y, c, s) => `<ellipse cx="${x}" cy="${y}" rx="${2.4 * s}" ry="${3.1 * s}" fill="${c}"/><rect x="${x - 2.2 * s}" y="${y - 0.3 * s}" width="${4.4 * s}" height="${0.8 * s}" fill="#fff" opacity=".7"/>`;

  function costume(theme, g) {
    switch (theme) {
      case 'christmas':
        return g
          ? `<rect x="3.8" y="5" width="4.4" height="1.6" rx=".8" fill="${RED}"/><rect x="6.8" y="6" width="1.3" height="3" rx=".6" fill="${GREEN}"/><circle cx="4.6" cy="-11.8" r=".6" fill="${GREEN}"/><circle cx="5.8" cy="-11.8" r=".6" fill="${GREEN}"/><circle cx="5.2" cy="-12.3" r=".5" fill="${RED}"/>`
          : `<path d="M2 1.6 Q4.2 -3.8 9 -3.2 Q10.4 -1.2 10.2 1.6 Z" fill="${RED}"/><rect x="1.4" y=".3" width="9.2" height="1.7" rx=".85" fill="#fff"/><circle cx="9.4" cy="-3.3" r="1.1" fill="#fff"/>`;
      case 'festive':
        return g
          ? `<path d="M3.8 5.6 L6 5.8 L3.8 7 Z" fill="#e8c25a"/><path d="M8.2 5.6 L6 5.8 L8.2 7 Z" fill="#e8c25a"/><circle cx="6" cy="5.8" r=".7" fill="#c99a2e"/>${sparkle(10.6, -17, 0.9, '#ffd98a')}${sparkle(1.4, -13, 0.6, '#ffd98a')}`
          : `<path d="M6 -4.8 L3.6 .7 L8.4 .7 Z" fill="#e8c25a"/><path d="M4.4 -1.4 L7.6 -1.4 M3.9 -.1 L8.1 -.1" stroke="#fff4c4" stroke-width=".35"/><circle cx="6" cy="-5" r=".75" fill="#fff4c4"/>${sparkle(10.6, -1.6, 0.7, '#ffd98a')}`;
      case 'valentines':
        return g
          ? `<path d="M6 5.8 L3.6 4.6 L3.6 7 Z" fill="#e63d23"/><path d="M6 5.8 L8.4 4.6 L8.4 7 Z" fill="#e63d23"/><circle cx="6" cy="5.8" r=".7" fill="#b02a1a"/>${heart(6, 9, 0.7, '#e63d23')}${heart(6, -19.8, 1, '#e63d23')}`
          : `${heart(6, 8.6, 0.75, '#fff')}${heart(6, -2.4, 1, '#e63d23')}`;
      case 'lunar':
        return g
          ? `<rect x="3.8" y="5" width="4.4" height="1.6" rx=".8" fill="${RED}"/><circle cx="6" cy="5.8" r=".85" fill="${GOLD}"/><rect x="5.7" y="6.4" width=".6" height="2.8" rx=".3" fill="${GOLD}"/><circle cx="10.4" cy="-14.4" r=".9" fill="${GOLD}"/>`
          : `<path d="M1.8 1.8 Q6 -3.2 10.2 1.8 Z" fill="${RED}"/><rect x="1.6" y=".9" width="8.8" height="1.1" rx=".5" fill="${GOLD}"/><circle cx="6" cy="-1.6" r=".8" fill="${GOLD}"/>`;
      case 'easter': {
        const ear = (cx, cy, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="1.3" ry="${ry}" fill="#fff" stroke="#f0d6e0" stroke-width=".25"/><ellipse cx="${cx}" cy="${cy + 0.2}" rx=".6" ry="${ry - 1}" fill="#f4a6b8"/>`;
        return g
          ? `${ear(4.4, -20.4, 3.2)}${ear(7.6, -20.4, 3.2)}<path d="M6 5.8 L3.6 4.6 L3.6 7 Z" fill="#c9a0f0"/><path d="M6 5.8 L8.4 4.6 L8.4 7 Z" fill="#c9a0f0"/><circle cx="6" cy="5.8" r=".6" fill="#a47fd0"/>`
          : `${ear(4, -2.4, 3.4)}${ear(8, -2.4, 3.4)}`;
      }
      case 'songkran':
        return g
          ? `${[4.2, 5.1, 6, 6.9, 7.8].map((x, i) => `<circle cx="${x}" cy="5.8" r=".75" fill="${i % 2 ? GOLD : '#f08a2b'}"/>`).join('')}<rect x="2.8" y="-9.1" width="2.6" height="1.7" rx=".7" fill="#1b2559"/><rect x="6.6" y="-9.1" width="2.6" height="1.7" rx=".7" fill="#1b2559"/><path d="M6 -22 Q7.4 -20 6 -18.8 Q4.6 -20 6 -22Z" fill="#63cbc6"/>`
          : `<rect x="2" y="6.8" width="8" height="4.2" rx="1.4" fill="#f08a2b"/><circle cx="4" cy="8.4" r=".8" fill="#fff"/><circle cx="7.4" cy="9.6" r=".8" fill="${GOLD}"/><circle cx="8.8" cy="7.8" r=".7" fill="#fff"/><circle cx="4.8" cy="10.2" r=".6" fill="${GOLD}"/><rect x="2.9" y="1.9" width="3.2" height="1.6" rx=".7" fill="#1b2559"/><rect x="5.9" y="1.9" width="3.2" height="1.6" rx=".7" fill="#1b2559"/><path d="M6 -3.6 Q7.4 -1.6 6 -.4 Q4.6 -1.6 6 -3.6Z" fill="#63cbc6"/>`;
      case 'unicorn':
        return g
          ? `<path d="M6 -23.6 L4.8 -17.4 L7.2 -17.4 Z" fill="${GOLD}"/>${sparkle(10.8, -17, 0.9, '#c9a0f0')}${PRIDE.map((c, i) => `<rect x="3.8" y="${(5 + i * 0.27).toFixed(2)}" width="4.4" height=".28" fill="${c}"/>`).join('')}`
          : `<path d="M6 -4.8 L4.9 .5 L7.1 .5 Z" fill="${GOLD}"/><path d="M5.4 -1 L6.8 -1.9 M5.1 .1 L7 -.8" stroke="#d6a516" stroke-width=".3"/><path d="M2 1 Q.4 3 1.6 6" stroke="#c9a0f0" stroke-width="1" fill="none" stroke-linecap="round"/><path d="M10 1 Q11.6 3 10.4 6" stroke="#8fd3e8" stroke-width="1" fill="none" stroke-linecap="round"/>${sparkle(11, -2, 0.8, '#c9a0f0')}`;
      case 'pride':
        return g ? `${prideShirt()}${heart(6, -19.8, 1, 'url(#prideGrad)')}` : `${prideShirt()}${heart(6, -2.4, 1, 'url(#prideGrad)')}`;
      default: return '';
    }
  }

  // Every decoration is drawn around (0, 0), the middle of its bottom edge, so a tap places the base of the item.
  const DECOR = {
    // everyday
    plant: { label: 'Plant', group: 'general', draw: () => `<rect x="-2" y="-4" width="4" height="4" rx="1" fill="${POT}"/><rect x="-3" y="-12" width="6" height="9" rx="3" fill="#4c6b4f"/><ellipse cx="-1" cy="-8" rx="1.4" ry="2.4" fill="#5fae4a"/>` },
    flowers: { label: 'Flowers', group: 'general', draw: () => `<rect x="-2.5" y="-4" width="5" height="4" rx="1" fill="${POT}"/><rect x="-2.2" y="-9" width=".5" height="5.4" fill="#4c6b4f"/><rect x="-.2" y="-11" width=".5" height="7.4" fill="#4c6b4f"/><rect x="1.8" y="-9" width=".5" height="5.4" fill="#4c6b4f"/><circle cx="-1.9" cy="-9.6" r="1.5" fill="#f4a6b8"/><circle cx=".1" cy="-11.6" r="1.5" fill="${GOLD}"/><circle cx="2.1" cy="-9.6" r="1.5" fill="#fff"/>` },
    lamp: { label: 'Lamp', group: 'general', draw: () => `<circle cx="0" cy="-10" r="6" fill="${GOLD}" opacity=".22"/><ellipse cx="0" cy="-.8" rx="3" ry="1" fill="#5c3f28"/><rect x="-.4" y="-8" width=".8" height="7.4" fill="#5c3f28"/><path d="M-3 -12 L3 -12 L4.2 -8 L-4.2 -8 Z" fill="#f6d88a"/>` },
    rug: { label: 'Rug', group: 'general', draw: () => `<ellipse cx="0" cy="-2" rx="10" ry="3.4" fill="#e63d23" opacity=".7"/><ellipse cx="0" cy="-2" rx="6.5" ry="2" fill="${GOLD}" opacity=".8"/>` },
    balloons: { label: 'Balloons', group: 'general', draw: () => `${balloon(-4, -14, '#e63d23')}${balloon(0, -16, '#294bd4')}${balloon(4, -14, GOLD)}` },
    // Christmas
    tree: { label: 'Christmas tree', group: 'christmas', draw: () => `<rect x="-1" y="-3" width="2" height="3" fill="#7c5c3e"/><path d="M-7 -3 L0 -12 L7 -3 Z" fill="${GREEN}"/><path d="M-6 -9 L0 -17 L6 -9 Z" fill="#3a9a5f"/><path d="M-4.5 -14 L0 -21 L4.5 -14 Z" fill="${GREEN}"/><circle cx="0" cy="-21.6" r="1.3" fill="${GOLD}"/><circle cx="-2.6" cy="-6" r=".9" fill="#e63d23"/><circle cx="3" cy="-7" r=".9" fill="${GOLD}"/><circle cx="-1" cy="-11.6" r=".9" fill="#294bd4"/><circle cx="2" cy="-14" r=".8" fill="#e63d23"/>` },
    gift: { label: 'Gift', group: 'christmas', draw: () => `<rect x="-3" y="-5" width="6" height="5" rx=".6" fill="${RED}"/><rect x="-.5" y="-5" width="1" height="5" fill="${GOLD}"/><rect x="-3" y="-3" width="6" height=".9" fill="${GOLD}"/><circle cx="-1" cy="-5.8" r="1" fill="${GOLD}"/><circle cx="1" cy="-5.8" r="1" fill="${GOLD}"/>` },
    wreath: { label: 'Wreath', group: 'christmas', draw: () => `<circle cx="0" cy="-4" r="3.2" fill="none" stroke="${GREEN}" stroke-width="1.8"/><circle cx="-2" cy="-5.6" r=".45" fill="${RED}"/><circle cx="2.2" cy="-3" r=".45" fill="${RED}"/><circle cx="0" cy="-.9" r="1" fill="${RED}"/>` },
    snowman: { label: 'Snowman', group: 'christmas', draw: () => `<circle cx="0" cy="-3" r="3" fill="#fff" stroke="#c8d2e0" stroke-width=".3"/><circle cx="0" cy="-8" r="2.3" fill="#fff" stroke="#c8d2e0" stroke-width=".3"/><circle cx="0" cy="-11.6" r="1.8" fill="#fff" stroke="#c8d2e0" stroke-width=".3"/><circle cx="-.7" cy="-12" r=".25" fill="#2b1b1b"/><circle cx=".7" cy="-12" r=".25" fill="#2b1b1b"/><path d="M0 -11.4 L1.8 -11.1 L0 -10.8 Z" fill="#f08a2b"/><rect x="-2" y="-10" width="4" height=".9" fill="${RED}"/>` },
    lights: { label: 'String lights', group: 'christmas', draw: () => { const c = ['#e63d23', GOLD, '#63cbc6', '#294bd4']; return STRING + sag(8, (x, y, i) => `<circle cx="${x.toFixed(1)}" cy="${(y + 1).toFixed(1)}" r=".9" fill="${c[i % 4]}"/>`); } },
    candycane: { label: 'Candy cane', group: 'christmas', draw: () => `<path d="M0 0 L0 -8 Q0 -11 -2.6 -10.4" stroke="${RED}" stroke-width="1.6" fill="none"/><path d="M0 0 L0 -8 Q0 -11 -2.6 -10.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-dasharray="1 1.2"/>` },
    // Festive glow (New Year)
    fairy: { label: 'Fairy lights', group: 'festive', draw: () => STRING + sag(10, (x, y) => `<circle cx="${x.toFixed(1)}" cy="${(y + 1).toFixed(1)}" r="1.9" fill="#ffd98a" opacity=".3"/><circle cx="${x.toFixed(1)}" cy="${(y + 1).toFixed(1)}" r=".7" fill="#fff4c4"/>`) },
    candles: { label: 'Candles', group: 'festive', draw: () => [[-2.6, 5], [0, 7], [2.6, 4.4]].map(([x, h]) => `<circle cx="${x}" cy="${-h - 1.6}" r="2.2" fill="#ffd98a" opacity=".3"/><rect x="${x - 0.8}" y="${-h}" width="1.6" height="${h}" rx=".3" fill="#fff4dc"/><path d="M${x} ${-h - 2.6} Q${x + 0.9} ${-h - 1.2} ${x} ${-h - 0.2} Q${x - 0.9} ${-h - 1.2} ${x} ${-h - 2.6}Z" fill="#ffb347"/>`).join('') },
    glow: { label: 'Glow lamp', group: 'festive', draw: () => `<circle cx="0" cy="-8" r="7.5" fill="#ffd98a" opacity=".25"/><circle cx="0" cy="-8" r="3.2" fill="#ffe3a0"/><circle cx="-.8" cy="-8.8" r="1" fill="#fff9e0"/><rect x="-1.6" y="-4.8" width="3.2" height="1.4" rx=".5" fill="#c99a2e"/><rect x="-1.2" y="-3.4" width="2.4" height="3.4" rx=".5" fill="#8a6a2e"/>` },
    goldstars: { label: 'Gold stars', group: 'festive', draw: () => `${sparkle(-3, -8, 1.7, '#e8c25a')}${sparkle(2.6, -4, 1.1, '#ffd98a')}${sparkle(4, -10.6, 1.3, '#f6e3b0')}${sparkle(-4.4, -2.4, .9, '#e8c25a')}` },
    goldballoons: { label: 'Gold balloons', group: 'festive', draw: () => `${balloon(-4, -14, '#e8c25a')}${balloon(0, -16, '#f6e3b0')}${balloon(4, -14, '#c99a2e')}` },
    // Valentine's
    heart: { label: 'Big heart', group: 'valentines', draw: () => `${heart(0, -6, 3.2, '#e63d23')}<circle cx="-3" cy="-9.8" r=".9" fill="#fff" opacity=".6"/>` },
    hballoons: { label: 'Heart balloons', group: 'valentines', draw: () => `<path d="M0 0 L-3 -9 M0 0 L3 -11" stroke="#7d8492" stroke-width=".3" fill="none"/>${heart(-3, -11, 1.6, '#e63d23')}${heart(3, -13.4, 1.6, '#f4a6b8')}` },
    roses: { label: 'Roses', group: 'valentines', draw: () => `<path d="M-2.4 -5 L2.4 -5 L1.8 0 L-1.8 0 Z" fill="#8fa3b8"/><rect x="-1.6" y="-9" width=".5" height="4.2" fill="#4c6b4f"/><rect x="-.2" y="-11" width=".5" height="6.2" fill="#4c6b4f"/><rect x="1.2" y="-9" width=".5" height="4.2" fill="#4c6b4f"/><circle cx="-1.4" cy="-9.6" r="1.3" fill="#e63d23"/><circle cx=".1" cy="-11.6" r="1.3" fill="#c9202a"/><circle cx="1.5" cy="-9.6" r="1.3" fill="#e63d23"/>` },
    garland: { label: 'Heart garland', group: 'valentines', draw: () => { const c = ['#e63d23', '#f4a6b8']; return `<path d="M-14 0 Q0 6 14 0" stroke="#7d8492" stroke-width=".3" fill="none"/>${sag(6, (x, y, i) => heart(x.toFixed(1), (y + 1.6).toFixed(1), 0.8, c[i % 2]))}`; } },
    hgift: { label: 'Gift', group: 'valentines', draw: () => `<rect x="-3" y="-5" width="6" height="5" rx=".6" fill="#f4a6b8"/><rect x="-.5" y="-5" width="1" height="5" fill="#e63d23"/>${heart(0, -6.6, 1, '#e63d23')}` },
    // Lunar New Year
    lantern: { label: 'Lantern', group: 'lunar', draw: () => `<path d="M0 -15 L0 -11" stroke="#7d8492" stroke-width=".4"/><rect x="-1.6" y="-11.6" width="3.2" height="1.2" rx=".5" fill="${GOLD}"/><ellipse cx="0" cy="-7.2" rx="4.2" ry="3.6" fill="${RED}"/><ellipse cx="0" cy="-7.2" rx="1.8" ry="3.6" fill="#b01c1c"/><rect x="-1.6" y="-4" width="3.2" height="1.1" rx=".5" fill="${GOLD}"/><path d="M0 -2.9 L0 0" stroke="${GOLD}" stroke-width=".5"/><circle cx="0" cy=".2" r=".6" fill="${GOLD}"/>` },
    lanterns: { label: 'Lantern string', group: 'lunar', draw: () => STRING + sag(6, (x, y) => `<ellipse cx="${x.toFixed(1)}" cy="${(y + 2.4).toFixed(1)}" rx="1.7" ry="1.5" fill="${RED}"/><rect x="${(x - 0.7).toFixed(1)}" y="${(y + 0.6).toFixed(1)}" width="1.4" height=".6" fill="${GOLD}"/><rect x="${(x - 0.7).toFixed(1)}" y="${(y + 3.6).toFixed(1)}" width="1.4" height=".5" fill="${GOLD}"/>`) },
    orangetree: { label: 'Mandarin tree', group: 'lunar', draw: () => `<rect x="-2.4" y="-4" width="4.8" height="4" rx="1" fill="${RED}"/><rect x="-2.4" y="-4" width="4.8" height=".8" fill="${GOLD}"/><circle cx="0" cy="-9.4" r="5" fill="#3a9a5f"/>${[[-2.6, -10.4], [2.4, -11], [0, -8], [-1, -12.4], [3, -8]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="#f08a2b"/>`).join('')}` },
    envelope: { label: 'Red envelope', group: 'lunar', draw: () => `<rect x="-2.2" y="-6.4" width="4.4" height="6.4" rx=".5" fill="${RED}"/><path d="M-2.2 -6.4 L0 -3.8 L2.2 -6.4" stroke="${GOLD}" stroke-width=".4" fill="none"/><circle cx="0" cy="-3.2" r=".9" fill="${GOLD}"/>` },
    ingot: { label: 'Gold ingot', group: 'lunar', draw: () => `<path d="M-3.4 0 L3.4 0 L4.4 -2.6 L-4.4 -2.6 Z" fill="#e0a416"/><ellipse cx="0" cy="-3" rx="3" ry="1.5" fill="${GOLD}"/>` },
    // Easter
    egg: { label: 'Easter egg', group: 'easter', draw: () => egg(0, -3.4, '#c9a0f0', 1) },
    basket: { label: 'Egg basket', group: 'easter', draw: () => `<path d="M-4 -7 Q0 -12 4 -7" stroke="#8a5a3b" stroke-width=".7" fill="none"/>${egg(-1.8, -6.6, '#f4a6b8', 0.7)}${egg(1.8, -6.6, '#8fd3e8', 0.7)}${egg(0, -7.4, GOLD, 0.7)}<path d="M-4.4 -5.4 L4.4 -5.4 L3.4 0 L-3.4 0 Z" fill="#c9985a"/><path d="M-4 -3.4 L4 -3.4 M-3.7 -1.6 L3.7 -1.6" stroke="#a87a42" stroke-width=".4"/>` },
    bunny: { label: 'Bunny', group: 'easter', draw: () => `<ellipse cx="-.4" cy="-3" rx="3.4" ry="3" fill="#fff" stroke="#e6dde2" stroke-width=".3"/><circle cx="-5" cy="-3.6" r="1.2" fill="#fff" stroke="#e6dde2" stroke-width=".3"/><circle cx="2.6" cy="-6.8" r="2.4" fill="#fff" stroke="#e6dde2" stroke-width=".3"/><ellipse cx="1.8" cy="-11.2" rx=".9" ry="2.6" fill="#fff" stroke="#e6dde2" stroke-width=".3"/><ellipse cx="3.8" cy="-11" rx=".9" ry="2.5" fill="#fff" stroke="#e6dde2" stroke-width=".3"/><ellipse cx="1.8" cy="-11.2" rx=".4" ry="1.8" fill="#f4a6b8"/><circle cx="3.4" cy="-7.2" r=".3" fill="#2b1b1b"/><circle cx="4.8" cy="-6.4" r=".5" fill="#f08aa0"/>` },
    chick: { label: 'Chick', group: 'easter', draw: () => `<circle cx="0" cy="-3" r="3" fill="#ffe066"/><circle cx="2" cy="-6.4" r="2" fill="#ffe066"/><path d="M3.8 -6.4 L5.4 -6 L3.8 -5.6 Z" fill="#f08a2b"/><circle cx="2.4" cy="-6.8" r=".3" fill="#2b1b1b"/><path d="M-1 0 L-1 .8 M1 0 L1 .8" stroke="#f08a2b" stroke-width=".4"/>` },
    tulips: { label: 'Tulips', group: 'easter', draw: () => `<rect x="-2.5" y="-4" width="5" height="4" rx="1" fill="#c9a0f0"/>${[[-2, '#f4a6b8'], [0, GOLD], [2, '#c9a0f0']].map(([x, c], i) => `<rect x="${x - 0.2}" y="${-9 - (i === 1 ? 2 : 0)}" width=".5" height="${5.4 + (i === 1 ? 2 : 0)}" fill="#4c6b4f"/><path d="M${x - 1.3} ${-9.4 - (i === 1 ? 2 : 0)} Q${x} ${-7.6 - (i === 1 ? 2 : 0)} ${x + 1.3} ${-9.4 - (i === 1 ? 2 : 0)} L${x + 0.8} ${-11.4 - (i === 1 ? 2 : 0)} L${x} ${-10.2 - (i === 1 ? 2 : 0)} L${x - 0.8} ${-11.4 - (i === 1 ? 2 : 0)} Z" fill="${c}"/>`).join('')}` },
    bunting: { label: 'Pastel bunting', group: 'easter', draw: () => bunting(['#f4a6b8', '#ffe066', '#8fd3e8', '#c9a0f0', '#a8e0b8']) },
    // Songkran
    bucket: { label: 'Water bucket', group: 'songkran', draw: () => `<path d="M-3.6 -7 Q0 -11.4 3.6 -7" stroke="#7d8492" stroke-width=".5" fill="none"/><path d="M-4 -6.4 L4 -6.4 L3 0 L-3 0 Z" fill="#8fa3b8"/><ellipse cx="0" cy="-6.4" rx="4" ry="1.1" fill="#63cbc6"/><circle cx="-2.4" cy="-8.4" r=".5" fill="#63cbc6"/><circle cx="2.6" cy="-9" r=".5" fill="#63cbc6"/><circle cx=".4" cy="-10" r=".4" fill="#63cbc6"/>` },
    watergun: { label: 'Water gun', group: 'songkran', draw: () => `<rect x="-5" y="-6" width="8.4" height="3" rx="1.2" fill="#e8588c"/><rect x="3.2" y="-5.4" width="3" height="1.6" rx=".5" fill="#294bd4"/><rect x="-3.6" y="-8.4" width="4.4" height="3" rx="1.2" fill="#63cbc6"/><rect x="-3" y="-3.2" width="1.8" height="3.2" rx=".6" fill="#c43c70"/>` },
    marigolds: { label: 'Marigolds', group: 'songkran', draw: () => `<path d="M-2.4 -5 L2.4 -5 L1.8 0 L-1.8 0 Z" fill="#c9985a"/>${[[-2, -9, '#f08a2b'], [0, -11, GOLD], [2, -9, '#f08a2b'], [-.8, -7.6, GOLD], [1, -8, '#e07a1a']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="1.5" fill="${c}"/>`).join('')}` },
    splash: { label: 'Water splash', group: 'songkran', draw: () => `<ellipse cx="0" cy="-1.4" rx="7" ry="2" fill="#63cbc6" opacity=".6"/><ellipse cx="-1" cy="-1.6" rx="4" ry="1.1" fill="#8fd3e8" opacity=".8"/><circle cx="-4" cy="-4.6" r=".7" fill="#63cbc6"/><circle cx="3.6" cy="-5.4" r=".8" fill="#63cbc6"/><circle cx="0" cy="-6.6" r=".6" fill="#8fd3e8"/>` },
    mgarland: { label: 'Marigold garland', group: 'songkran', draw: () => `<path d="M-14 0 Q0 6 14 0" stroke="#4c6b4f" stroke-width=".4" fill="none"/>${sag(9, (x, y, i) => `<circle cx="${x.toFixed(1)}" cy="${(y + 0.6).toFixed(1)}" r="1.1" fill="${i % 2 ? GOLD : '#f08a2b'}"/>`)}` },
    // Unicorn
    unicorn: { label: 'Unicorn', group: 'unicorn', draw: () => `<rect x="-5.4" y="-7.4" width="9.6" height="5" rx="2.5" fill="#fff" stroke="#e5d9f2" stroke-width=".3"/><rect x="-4.6" y="-3" width="1.4" height="3" rx=".7" fill="#fff" stroke="#e5d9f2" stroke-width=".3"/><rect x="1.8" y="-3" width="1.4" height="3" rx=".7" fill="#fff" stroke="#e5d9f2" stroke-width=".3"/><circle cx="4.2" cy="-9.6" r="2.4" fill="#fff" stroke="#e5d9f2" stroke-width=".3"/><ellipse cx="5.8" cy="-8.6" rx="1.3" ry="1" fill="#f4d0e0"/><path d="M4.6 -11.8 L5.6 -15.8 L6.2 -11.6 Z" fill="${GOLD}"/><circle cx="4.2" cy="-10" r=".35" fill="#2b1b1b"/><path d="M2.6 -11.4 Q.4 -10 1.4 -6.6" stroke="#c9a0f0" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M1.8 -11.8 Q-.6 -9.6 .4 -6" stroke="#f4a6b8" stroke-width=".9" fill="none" stroke-linecap="round"/><path d="M-5.4 -6 Q-8 -4.4 -6.6 -1.6" stroke="#f4a6b8" stroke-width="1.3" fill="none" stroke-linecap="round"/>` },
    rainbow: { label: 'Rainbow', group: 'unicorn', draw: () => `${['#e63d23', '#f08a2b', GOLD, '#5fae4a', '#4a8de0', '#a47fd0'].map((c, i) => `<path d="M${-11 + i * 1.5} 0 A${11 - i * 1.5} ${11 - i * 1.5} 0 0 1 ${11 - i * 1.5} 0" stroke="${c}" stroke-width="1.6" fill="none"/>`).join('')}<circle cx="-11" cy="-.6" r="1.8" fill="#fff"/><circle cx="-8.8" cy="-.4" r="1.4" fill="#fff"/><circle cx="11" cy="-.6" r="1.8" fill="#fff"/><circle cx="8.8" cy="-.4" r="1.4" fill="#fff"/>` },
    cloud: { label: 'Cloud', group: 'unicorn', draw: () => `<ellipse cx="-2.4" cy="-3" rx="3" ry="2.2" fill="#fff" stroke="#d9e4f2" stroke-width=".3"/><ellipse cx="1.6" cy="-4" rx="3.4" ry="2.8" fill="#fff" stroke="#d9e4f2" stroke-width=".3"/><ellipse cx="4.4" cy="-2.6" rx="2.6" ry="1.8" fill="#fff" stroke="#d9e4f2" stroke-width=".3"/><rect x="-5" y="-3" width="12" height="1.8" fill="#fff"/>` },
    sparkles: { label: 'Sparkles', group: 'unicorn', draw: () => `${sparkle(-3, -8, 1.6, GOLD)}${sparkle(2.4, -4, 1.1, '#f4a6b8')}${sparkle(4, -10.6, 1.3, '#8fd3e8')}${sparkle(-4.4, -2.4, .9, '#c9a0f0')}` },
    ubal: { label: 'Pastel balloons', group: 'unicorn', draw: () => `${balloon(-4, -14, '#f4a6b8')}${balloon(0, -16, '#c9a0f0')}${balloon(4, -14, '#a8e0b8')}` },
    // Pride
    flag: { label: 'Pride flag', group: 'pride', draw: () => `<rect x="-.4" y="-14" width=".8" height="14" fill="#7d8492"/><path d="M.4 -13.6 Q4.6 -15 8.6 -13.6 L8.6 -7.8 Q4.6 -9.2 .4 -7.8 Z" fill="url(#prideGrad)"/>` },
    pheart: { label: 'Rainbow heart', group: 'pride', draw: () => heart(0, -6, 3.2, 'url(#prideGrad)') },
    pbanner: { label: 'Rainbow banner', group: 'pride', draw: () => bunting(PRIDE) },
    pballoons: { label: 'Rainbow balloons', group: 'pride', draw: () => `${balloon(-5, -13, PRIDE[0])}${balloon(-2.6, -15.4, PRIDE[1])}${balloon(0, -13.4, PRIDE[2])}${balloon(2.6, -15.6, PRIDE[3])}${balloon(5, -13, PRIDE[4])}` },
  };
  const GROUPS = { general: 'Everyday', christmas: 'Christmas', festive: 'Festive glow', valentines: "Valentine's", lunar: 'Lunar New Year', easter: 'Easter', songkran: 'Songkran', unicorn: 'Unicorn', pride: 'Pride' };

  // What a theme adds on its own, before anything Lily places.
  const WALL = [14, 42, 70, 98, 126, 154, 182];
  const PRESETS = {
    christmas: [...WALL.map((x) => ['lights', x, 12]), ['wreath', 48, 11], ['tree', 22, 116], ['gift', 34, 117], ['gift', 41, 116], ['snowman', 176, 117]],
    festive: [...WALL.map((x) => ['fairy', x, 12]), ['glow', 22, 116], ['glow', 172, 116], ['candles', 36, 117], ['candles', 150, 116], ['goldstars', 96, 110], ['goldballoons', 60, 116]],
    valentines: [...WALL.map((x) => ['garland', x, 12]), ['heart', 96, 113], ['hballoons', 22, 116], ['hballoons', 172, 116], ['roses', 34, 117]],
    lunar: [...WALL.map((x) => ['lanterns', x, 12]), ['lantern', 48, 24], ['orangetree', 22, 116], ['orangetree', 172, 116], ['envelope', 36, 117], ['envelope', 42, 117], ['ingot', 100, 113]],
    easter: [...WALL.map((x) => ['bunting', x, 12]), ['bunny', 22, 116], ['basket', 36, 117], ['tulips', 172, 116], ['chick', 100, 114], ['egg', 56, 117], ['egg', 150, 116]],
    songkran: [...WALL.map((x) => ['mgarland', x, 12]), ['splash', 96, 114], ['splash', 40, 112], ['bucket', 22, 116], ['watergun', 160, 116], ['marigolds', 34, 117], ['marigolds', 172, 116]],
    unicorn: [['rainbow', 127, 13], ['cloud', 81, 9], ['unicorn', 30, 116], ['ubal', 172, 116], ['sparkles', 60, 112], ['sparkles', 140, 114], ['sparkles', 100, 108]],
    pride: [...WALL.map((x) => ['pbanner', x, 12]), ['flag', 22, 116], ['flag', 172, 116], ['pheart', 96, 113], ['pballoons', 36, 116], ['pballoons', 150, 116]],
  };
  const at = (x, y, body) => `<g transform="translate(${x} ${y})">${body}</g>`;
  const visible = (it, theme) => { const d = DECOR[it.t]; return d && (d.group === 'general' || d.group === theme); };

  // "08/11/2026" -> the look to use today when Automatic is chosen. Unicorn is never automatic.
  const LUNAR = { 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3], 2031: [1, 23], 2032: [2, 11] };
  function easterOf(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mo = Math.floor((h + l - 7 * m + 114) / 31), dd = ((h + l - 7 * m + 114) % 31) + 1;
    return [mo, dd];
  }
  function autoTheme(dmy) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dmy || ''));
    if (!m) return 'normal';
    const d = +m[1], mo = +m[2], y = +m[3];
    const day = (yy, mm, dd) => Date.UTC(yy, mm - 1, dd) / 86400000;
    const today = day(y, mo, d);
    if (mo === 11 || (mo === 12 && d <= 26)) return 'christmas';
    if ((mo === 12 && d >= 27) || (mo === 1 && d <= 15)) return 'festive';
    if (mo === 2 && d >= 12 && d <= 14) return 'valentines';
    if (mo === 2) return 'lunar';
    const ny = LUNAR[y];
    if (ny && today >= day(y, ny[0], ny[1]) - 7 && today <= day(y, ny[0], ny[1]) + 14) return 'lunar';
    const [em, ed] = easterOf(y); const easter = day(y, em, ed);
    if (today >= easter - 9 && today <= easter + 1) return 'easter';
    if (mo === 4 && d >= 10 && d <= 16) return 'songkran';
    if (mo === 6) return 'pride';
    return 'normal';
  }

  function room() {
    let s = `<rect width="${W}" height="${H}" fill="#e3e4e8"/>`;
    for (let y = 12; y < H; y += 8) for (let x = ((y / 8) % 2) * 8; x < W; x += 16) s += `<rect x="${x}" y="${y}" width="8" height="8" rx="1.2" fill="#cfd1d8"/>`;
    s += `<rect width="${W}" height="12" fill="#e63d23"/><rect y="10" width="${W}" height="2" fill="#f8cc1a"/>`;
    [30, 90, 150].forEach((x) => { s += `<rect x="${x}" y="2" width="14" height="7" rx="1.4" fill="#bfe1ee"/><rect x="${x + 6}" y="2" width="1" height="7" fill="#8fc0d4"/>`; });
    [[184, 98], [184, 80], [2, 98], [2, 74], [2, 50]].forEach(([x, y]) => { s += `<rect x="${x}" y="${y}" width="6" height="8" rx="2.4" fill="#4c6b4f"/><rect x="${x + 1}" y="${y + 8}" width="4" height="5" rx="1" fill="#7c5c3e"/>`; });
    // Herbs next to the kitchen counter, the same height as the other plants: rosemary (dark, needly, a few pale blue flowers) and basil (bright, broad leaves).
    s += `<rect x="185" y="64" width="6" height="8" rx="2.4" fill="#3b5e45"/><rect x="186.2" y="65" width=".5" height="6" fill="#6f9a7a"/><rect x="187.6" y="64.6" width=".5" height="6.4" fill="#6f9a7a"/><rect x="189" y="65" width=".5" height="6" fill="#6f9a7a"/><circle cx="186" cy="65.6" r=".6" fill="#a9c7ee"/><circle cx="190" cy="66.4" r=".6" fill="#a9c7ee"/><rect x="186" y="72" width="4" height="5" rx="1" fill="#b5654a"/>`;
    s += `<rect x="177" y="64" width="6" height="8" rx="2.8" fill="#5fae4a"/><ellipse cx="178.6" cy="67" rx="1.7" ry="2.3" fill="#7cc864"/><ellipse cx="181.4" cy="66" rx="1.7" ry="2.4" fill="#4a9a3a"/><rect x="178" y="72" width="4" height="5" rx="1" fill="#b5654a"/>`;
    // A picture frame on the back wall: the pig and giraffe drawing on a dark mat.
    s += `<rect x="62.6" y=".6" width="10.8" height="11.4" rx="1" fill="#a06c47"/><rect x="63.6" y="1.6" width="8.8" height="9.4" rx=".5" fill="#1b2559"/><image href="/pig-giraffe.png" x="64.2" y="2.1" width="7.6" height="8.4" preserveAspectRatio="xMidYMid meet"/><rect x="62.6" y=".6" width="10.8" height="1" rx=".5" fill="#c08a60"/>`;
    s += `<rect x="70" y="100" width="52" height="14" rx="5" fill="#294bd4" opacity=".18"/>`;
    return s;
  }
  // Operations is the cooking corner, an L shape tucked into the top right corner: a steel counter along the wall with the
  // hob and red pot, and a second run down the right hand side with a sink and a second pot.
  function kitchen() {
    return `<rect x="132" y="26" width="60" height="2" rx="1" fill="#8d939e"/><rect x="190" y="26" width="2" height="38" fill="#8d939e"/>
      <rect x="132" y="12" width="60" height="14" rx="2" fill="#c4c9d2"/><rect x="172" y="12" width="20" height="50" rx="2" fill="#c4c9d2"/>
      <rect x="132" y="12" width="60" height="2" rx="1" fill="#e8ebf0"/><rect x="172" y="12" width="2" height="50" fill="#e8ebf0"/>
      <rect x="136" y="17" width="11" height="7" rx="1.4" fill="#3a3f4a"/><rect x="150" y="17" width="11" height="7" rx="1.4" fill="#3a3f4a"/>
      <rect x="137" y="13" width="9" height="7" rx="2" fill="#e63d23"/><rect x="137" y="13" width="9" height="1.4" rx=".7" fill="#a82a2a"/>
      <rect x="151" y="13" width="9" height="7" rx="2" fill="#294bd4"/><rect x="151" y="13" width="9" height="1.4" rx=".7" fill="#1d3699"/>
      <rect x="177" y="14" width="8" height="5.5" rx="1" fill="#c9985a"/><rect x="177" y="14" width="8" height="1" rx=".5" fill="#dcb27a"/><path d="M178.2 17.2 L182.4 16.6 L182.4 17.8 Z" fill="#f7f9fc" stroke="#7d8492" stroke-width=".25"/><rect x="182.4" y="16.5" width="2" height="1.4" rx=".6" fill="#2f333d"/>
      <rect x="164" y="15" width="6" height="9" rx="1" fill="#8fa3b8"/>
      <rect x="176" y="32" width="12" height="9" rx="2" fill="#8d939e"/><rect x="178" y="34" width="8" height="5" rx="1.4" fill="#e8ebf0"/><rect x="181" y="29" width="2" height="4" rx="1" fill="#6b7080"/>
      <rect x="177" y="46" width="10" height="9" rx="2" fill="#2f6f6a"/><rect x="177" y="46" width="10" height="1.4" rx=".7" fill="#235552"/>
      <circle cx="141" cy="9" r="1.2" fill="#fff" opacity=".8"/><circle cx="143" cy="6" r="1.2" fill="#fff" opacity=".8"/>`;
  }
  function desk([x, y], i) {
    if (i === KITCHEN) return kitchen();
    // a chair in front of every desk except the kitchen
    const chair = `<rect x="${x + 6.5}" y="${y + 16}" width="15" height="10" rx="3" fill="#4a5568"/><rect x="${x + 7}" y="${y + 24}" width="14" height="3.4" rx="1.7" fill="#5f6b80"/>`;
    return chair + `<rect x="${x}" y="${y + 12}" width="28" height="2" rx="1" fill="#5c3f28"/><rect x="${x}" y="${y}" width="28" height="12" rx="2" fill="#8a5a3b"/><rect x="${x}" y="${y}" width="28" height="2" rx="1" fill="#a06c47"/>
      <rect x="${x + 9}" y="${y + 1}" width="10" height="7" rx="1.2" fill="#2a2622"/><rect x="${x + 10}" y="${y + 2}" width="8" height="5" rx=".8" fill="${SCREEN[i % 5]}"/><rect x="${x + 13}" y="${y + 8}" width="2" height="2" fill="#2a2622"/>
      <rect x="${x + 21}" y="${y + 6}" width="4" height="3" rx=".6" fill="#d9d2c4"/>`;
  }

  window.PigOffice = function (box, teams, onPick) {
    const state = { theme: 'normal', items: [], editing: false, palette: null, sel: null };
    let listener = null;
    const notify = () => { if (listener) listener({ editing: state.editing, palette: state.palette, selected: state.sel, count: state.items.length }); };
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="An office with five team desks, four pigs in t shirts and a giraffe chef walking between them" xmlns="http://www.w3.org/2000/svg"></svg>`;
    const svg = box.querySelector('svg');
    const pigs = PIGS.map((p, n) => { const at0 = n % STATIONS.length; return { at: at0, x: SEATS[at0].seat[0], y: SEATS[at0].seat[1], path: [], wait: 1 + n * 1.3, step: 0, t: 0, el: null }; });
    const paint = () => [...pigs].sort((a, b) => a.y - b.y).forEach((p) => { p.el.setAttribute('transform', `translate(${p.x.toFixed(2)} ${(p.y + (p.step ? -0.8 : 0)).toFixed(2)})`); p.el.parentNode.appendChild(p.el); });

    function render() {
      const preset = (PRESETS[state.theme] || []).map(([t, x, y]) => at(x, y, DECOR[t].draw())).join('');
      const placed = state.items.map((it, i) => ({ it, i })).filter(({ it }) => state.editing || visible(it, state.theme)).map(({ it, i }) => {
        const sel = state.editing && state.sel === i;
        const hit = state.editing ? '<rect x="-8" y="-24" width="16" height="27" fill="transparent"/>' : '';
        const ring = sel ? '<rect x="-8" y="-24" width="16" height="27" rx="2" fill="none" stroke="#294bd4" stroke-width=".7" stroke-dasharray="2 1.4"/>' : '';
        const dim = state.editing && !visible(it, state.theme) ? ' opacity=".5"' : '';
        return `<g data-di="${i}" transform="translate(${it.x} ${it.y})"${dim}>${hit}${DECOR[it.t].draw()}${ring}</g>`;
      }).join('');
      const chars = PIGS.map((p, n) => `<g class="ch" data-n="${n}"><g transform="scale(1.1)">${p.giraffe ? giraffe() : pig(p.shirt)}${costume(state.theme, Boolean(p.giraffe))}</g></g>`).join('');
      svg.innerHTML = `${PRIDE_DEFS}${room()}${DESKS.map(desk).join('')}${state.theme === 'festive' ? `<rect width="${W}" height="${H}" fill="#ffb347" opacity=".10"/>` : ''}<g>${preset}</g><g>${placed}</g>${chars}`;
      const els = [...svg.querySelectorAll('.ch')];
      pigs.forEach((p, n) => { p.el = els[n]; });
      paint();
    }
    render();

    svg.addEventListener('click', (e) => {
      if (!state.editing) return;
      const hit = e.target.closest && e.target.closest('[data-di]');
      if (hit) { state.sel = Number(hit.getAttribute('data-di')); state.palette = null; render(); notify(); return; }
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const m = svg.getScreenCTM(); if (!m) return;
      const p = pt.matrixTransform(m.inverse());
      const x = Math.round(Math.min(W, Math.max(0, p.x)) * 10) / 10, y = Math.round(Math.min(H, Math.max(0, p.y)) * 10) / 10;
      if (state.palette) {
        if (state.items.length >= 80) return;
        state.items.push({ t: state.palette, x, y }); state.sel = state.items.length - 1;
      } else if (state.sel !== null && state.items[state.sel]) { state.items[state.sel].x = x; state.items[state.sel].y = y; } else return;
      render(); notify();
    });

    teams.slice(0, DESKS.length).forEach((t, i) => {
      const [x, y] = DESKS[i];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'plate';
      b.style.left = `${((x + 14) / W) * 100}%`;
      b.style.top = `${((y - 1) / H) * 100}%`;
      const n = (t.open || []).length;
      b.innerHTML = `${String(t.name).replace(/[&<>"]/g, '')}${n ? `<span class="n">${n}</span>` : ''}`;
      b.addEventListener('click', () => onPick(i));
      box.appendChild(b);
    });

    const copy = (a) => a.map((x) => ({ t: x.t, x: x.x, y: x.y }));
    const controller = {
      setTheme(t) { state.theme = t; render(); },
      setItems(a) { state.items = copy(a || []); state.sel = null; render(); notify(); },
      getItems() { return copy(state.items); },
      setEditing(on) { state.editing = Boolean(on); state.sel = null; state.palette = null; box.classList.toggle('editing', state.editing); render(); notify(); },
      setPalette(id) { state.palette = DECOR[id] ? id : null; state.sel = null; render(); notify(); },
      removeSelected() { if (state.sel === null) return; state.items.splice(state.sel, 1); state.sel = null; render(); notify(); },
      clear() { state.items = []; state.sel = null; render(); notify(); },
      onChange(fn) { listener = fn; },
    };

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return controller;
    let last = performance.now();
    function tick(now) {
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      pigs.forEach((p) => {
        if (!p.path.length) {
          p.step = 0; p.wait -= dt;
          if (p.wait <= 0) {
            const taken = new Set(pigs.map((q) => q.at));
            const options = STATIONS.map((_, i) => i).filter((i) => i !== p.at && !taken.has(i));
            const to = options[Math.floor(Math.random() * options.length)];
            p.path = route(p.at, to); p.at = to; p.wait = 3 + Math.random() * 4;
          }
          return;
        }
        const [tx, ty] = p.path[0];
        const move = 22 * dt;
        const dx = tx - p.x, dy = ty - p.y;
        if (Math.abs(dx) <= move && Math.abs(dy) <= move) { p.x = tx; p.y = ty; p.path.shift(); }
        else if (Math.abs(dx) > 0.01) p.x += Math.sign(dx) * move;
        else p.y += Math.sign(dy) * move;
        p.t += dt; p.step = Math.floor(p.t * 6) % 2;
      });
      paint();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return controller;
  };
  window.PigOffice.TYPES = Object.keys(DECOR).map((id) => ({ id, label: DECOR[id].label, group: DECOR[id].group }));
  window.PigOffice.GROUPS = GROUPS;
  window.PigOffice.THEMES = Object.keys(GROUPS).filter((g) => g !== 'general').map((id) => ({ id, label: GROUPS[id] }));
  window.PigOffice.autoTheme = autoTheme;
  window.PigOffice.preview = (id) => `<svg viewBox="-14 -26 28 30" xmlns="http://www.w3.org/2000/svg">${PRIDE_DEFS}${DECOR[id].draw()}</svg>`;
})();
