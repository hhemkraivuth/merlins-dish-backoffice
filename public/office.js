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
  const RED = '#d62828', GREEN = '#2e7d4f', POT = '#b5654a';
  function costume(theme, giraffeOn) {
    if (theme === 'festive') {
      return giraffeOn
        ? `<rect x="3.8" y="5" width="4.4" height="1.6" rx=".8" fill="${RED}"/><rect x="6.8" y="6" width="1.3" height="3" rx=".6" fill="${GREEN}"/><circle cx="4.6" cy="-11.8" r=".6" fill="${GREEN}"/><circle cx="5.8" cy="-11.8" r=".6" fill="${GREEN}"/><circle cx="5.2" cy="-12.3" r=".5" fill="${RED}"/>`
        : `<path d="M2 1.6 Q4.2 -3.8 9 -3.2 Q10.4 -1.2 10.2 1.6 Z" fill="${RED}"/><rect x="1.4" y=".3" width="9.2" height="1.7" rx=".85" fill="#fff"/><circle cx="9.4" cy="-3.3" r="1.1" fill="#fff"/>`;
    }
    if (theme === 'valentines') {
      return giraffeOn
        ? `<path d="M6 5.8 L3.6 4.6 L3.6 7 Z" fill="#e63d23"/><path d="M6 5.8 L8.4 4.6 L8.4 7 Z" fill="#e63d23"/><circle cx="6" cy="5.8" r=".7" fill="#b02a1a"/>${heart(6, 9, 0.7, '#e63d23')}${heart(6, -19.8, 1, '#e63d23')}`
        : `${heart(6, 8.6, 0.75, '#fff')}${heart(6, -2.4, 1, '#e63d23')}`;
    }
    return '';
  }

  // Every decoration is drawn around (0, 0), the middle of its bottom edge, so a tap places the base of the item.
  const DECOR = {
    plant: { label: 'Plant', group: 'general', draw: () => `<rect x="-2" y="-4" width="4" height="4" rx="1" fill="${POT}"/><rect x="-3" y="-12" width="6" height="9" rx="3" fill="#4c6b4f"/><ellipse cx="-1" cy="-8" rx="1.4" ry="2.4" fill="#5fae4a"/>` },
    flowers: { label: 'Flowers', group: 'general', draw: () => `<rect x="-2.5" y="-4" width="5" height="4" rx="1" fill="${POT}"/><rect x="-2.2" y="-9" width=".5" height="5.4" fill="#4c6b4f"/><rect x="-.2" y="-11" width=".5" height="7.4" fill="#4c6b4f"/><rect x="1.8" y="-9" width=".5" height="5.4" fill="#4c6b4f"/><circle cx="-1.9" cy="-9.6" r="1.5" fill="#f4a6b8"/><circle cx=".1" cy="-11.6" r="1.5" fill="#f8cc1a"/><circle cx="2.1" cy="-9.6" r="1.5" fill="#fff"/>` },
    lamp: { label: 'Lamp', group: 'general', draw: () => `<circle cx="0" cy="-10" r="6" fill="#f8cc1a" opacity=".22"/><ellipse cx="0" cy="-.8" rx="3" ry="1" fill="#5c3f28"/><rect x="-.4" y="-8" width=".8" height="7.4" fill="#5c3f28"/><path d="M-3 -12 L3 -12 L4.2 -8 L-4.2 -8 Z" fill="#f6d88a"/>` },
    rug: { label: 'Rug', group: 'general', draw: () => `<ellipse cx="0" cy="-2" rx="10" ry="3.4" fill="#e63d23" opacity=".7"/><ellipse cx="0" cy="-2" rx="6.5" ry="2" fill="#f8cc1a" opacity=".8"/>` },
    balloons: { label: 'Balloons', group: 'general', draw: () => `<path d="M0 0 L-4 -11 M0 0 L0 -13 M0 0 L4 -11" stroke="#7d8492" stroke-width=".3" fill="none"/><ellipse cx="-4" cy="-14" rx="2.4" ry="3" fill="#e63d23"/><ellipse cx="0" cy="-16" rx="2.4" ry="3" fill="#294bd4"/><ellipse cx="4" cy="-14" rx="2.4" ry="3" fill="#f8cc1a"/>` },
    tree: { label: 'Christmas tree', group: 'festive', draw: () => `<rect x="-1" y="-3" width="2" height="3" fill="#7c5c3e"/><path d="M-7 -3 L0 -12 L7 -3 Z" fill="#2e7d4f"/><path d="M-6 -9 L0 -17 L6 -9 Z" fill="#3a9a5f"/><path d="M-4.5 -14 L0 -21 L4.5 -14 Z" fill="#2e7d4f"/><circle cx="0" cy="-21.6" r="1.3" fill="#f8cc1a"/><circle cx="-2.6" cy="-6" r=".9" fill="#e63d23"/><circle cx="3" cy="-7" r=".9" fill="#f8cc1a"/><circle cx="-1" cy="-11.6" r=".9" fill="#294bd4"/><circle cx="2" cy="-14" r=".8" fill="#e63d23"/>` },
    gift: { label: 'Gift', group: 'festive', draw: () => `<rect x="-3" y="-5" width="6" height="5" rx=".6" fill="${RED}"/><rect x="-.5" y="-5" width="1" height="5" fill="#f8cc1a"/><rect x="-3" y="-3" width="6" height=".9" fill="#f8cc1a"/><circle cx="-1" cy="-5.8" r="1" fill="#f8cc1a"/><circle cx="1" cy="-5.8" r="1" fill="#f8cc1a"/>` },
    wreath: { label: 'Wreath', group: 'festive', draw: () => `<circle cx="0" cy="-4" r="3.2" fill="none" stroke="${GREEN}" stroke-width="1.8"/><circle cx="-2" cy="-5.6" r=".45" fill="${RED}"/><circle cx="2.2" cy="-3" r=".45" fill="${RED}"/><circle cx="0" cy="-.9" r="1" fill="${RED}"/>` },
    snowman: { label: 'Snowman', group: 'festive', draw: () => `<circle cx="0" cy="-3" r="3" fill="#fff" stroke="#c8d2e0" stroke-width=".3"/><circle cx="0" cy="-8" r="2.3" fill="#fff" stroke="#c8d2e0" stroke-width=".3"/><circle cx="0" cy="-11.6" r="1.8" fill="#fff" stroke="#c8d2e0" stroke-width=".3"/><circle cx="-.7" cy="-12" r=".25" fill="#2b1b1b"/><circle cx=".7" cy="-12" r=".25" fill="#2b1b1b"/><path d="M0 -11.4 L1.8 -11.1 L0 -10.8 Z" fill="#f08a2b"/><rect x="-2" y="-10" width="4" height=".9" fill="${RED}"/>` },
    lights: { label: 'String lights', group: 'festive', draw: () => { const c = ['#e63d23', '#f8cc1a', '#63cbc6', '#294bd4']; let b = ''; for (let i = 0; i < 8; i++) { const t = (i + 0.5) / 8; b += `<circle cx="${(-14 + 28 * t).toFixed(1)}" cy="${(12 * t * (1 - t) + 1).toFixed(1)}" r=".9" fill="${c[i % 4]}"/>`; } return `<path d="M-14 0 Q0 6 14 0" stroke="#4a4f5c" stroke-width=".3" fill="none"/>${b}`; } },
    candycane: { label: 'Candy cane', group: 'festive', draw: () => `<path d="M0 0 L0 -8 Q0 -11 -2.6 -10.4" stroke="${RED}" stroke-width="1.6" fill="none"/><path d="M0 0 L0 -8 Q0 -11 -2.6 -10.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-dasharray="1 1.2"/>` },
    heart: { label: 'Big heart', group: 'valentines', draw: () => `${heart(0, -6, 3.2, '#e63d23')}<circle cx="-3" cy="-9.8" r=".9" fill="#fff" opacity=".6"/>` },
    hballoons: { label: 'Heart balloons', group: 'valentines', draw: () => `<path d="M0 0 L-3 -9 M0 0 L3 -11" stroke="#7d8492" stroke-width=".3" fill="none"/>${heart(-3, -11, 1.6, '#e63d23')}${heart(3, -13.4, 1.6, '#f4a6b8')}` },
    roses: { label: 'Roses', group: 'valentines', draw: () => `<path d="M-2.4 -5 L2.4 -5 L1.8 0 L-1.8 0 Z" fill="#8fa3b8"/><rect x="-1.6" y="-9" width=".5" height="4.2" fill="#4c6b4f"/><rect x="-.2" y="-11" width=".5" height="6.2" fill="#4c6b4f"/><rect x="1.2" y="-9" width=".5" height="4.2" fill="#4c6b4f"/><circle cx="-1.4" cy="-9.6" r="1.3" fill="#e63d23"/><circle cx=".1" cy="-11.6" r="1.3" fill="#c9202a"/><circle cx="1.5" cy="-9.6" r="1.3" fill="#e63d23"/>` },
    garland: { label: 'Heart garland', group: 'valentines', draw: () => { const c = ['#e63d23', '#f4a6b8']; let b = ''; for (let i = 0; i < 6; i++) { const t = (i + 0.5) / 6; b += heart((-14 + 28 * t).toFixed(1), (12 * t * (1 - t) + 1.6).toFixed(1), 0.8, c[i % 2]); } return `<path d="M-14 0 Q0 6 14 0" stroke="#7d8492" stroke-width=".3" fill="none"/>${b}`; } },
    hgift: { label: 'Gift', group: 'valentines', draw: () => `<rect x="-3" y="-5" width="6" height="5" rx=".6" fill="#f4a6b8"/><rect x="-.5" y="-5" width="1" height="5" fill="#e63d23"/>${heart(0, -6.6, 1, '#e63d23')}` },
  };
  const GROUPS = { general: 'Everyday', festive: 'Festive', valentines: "Valentine's" };

  // What a theme adds on its own, before anything Lily places.
  const PRESETS = {
    festive: [['lights', 14, 12], ['lights', 42, 12], ['lights', 70, 12], ['lights', 98, 12], ['lights', 126, 12], ['lights', 154, 12], ['lights', 182, 12], ['wreath', 48, 11], ['tree', 22, 116], ['gift', 34, 117], ['gift', 41, 116], ['snowman', 176, 117]],
    valentines: [['garland', 14, 12], ['garland', 42, 12], ['garland', 70, 12], ['garland', 98, 12], ['garland', 126, 12], ['garland', 154, 12], ['garland', 182, 12], ['heart', 96, 113], ['hballoons', 22, 116], ['hballoons', 172, 116], ['roses', 34, 117]],
  };
  const at = (x, y, body) => `<g transform="translate(${x} ${y})">${body}</g>`;
  const visible = (it, theme) => { const d = DECOR[it.t]; return d && (d.group === 'general' || d.group === theme); };
  // "08/11/2026" -> the look to use today when Automatic is chosen
  function autoTheme(dmy) {
    const m = /^(\d{1,2})\/(\d{1,2})\//.exec(String(dmy || ''));
    if (!m) return 'normal';
    const d = +m[1], mo = +m[2];
    if (mo === 12 || (mo === 1 && d <= 2)) return 'festive';
    if (mo === 2 && d <= 14) return 'valentines';
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
      svg.innerHTML = `${room()}${DESKS.map(desk).join('')}<g>${preset}</g><g>${placed}</g>${chars}`;
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
  window.PigOffice.autoTheme = autoTheme;
  window.PigOffice.preview = (id) => `<svg viewBox="-14 -26 28 30" xmlns="http://www.w3.org/2000/svg">${DECOR[id].draw()}</svg>`;
})();
