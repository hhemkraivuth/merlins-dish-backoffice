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
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="An office with five team desks, four pigs in t shirts and a giraffe chef walking between them" xmlns="http://www.w3.org/2000/svg">${room()}${DESKS.map(desk).join('')}${PIGS.map((p, n) => `<g class="ch" data-n="${n}"><g transform="scale(1.1)">${p.giraffe ? giraffe() : pig(p.shirt)}</g></g>`).join('')}</svg>`;
    const els = [...box.querySelectorAll('.ch')];
    const pigs = PIGS.map((p, n) => { const at = n % STATIONS.length; return { at, x: SEATS[at].seat[0], y: SEATS[at].seat[1], path: [], wait: 1 + n * 1.3, step: 0, t: 0, el: els[n] }; });
    const paint = () => [...pigs].sort((a, b) => a.y - b.y).forEach((p) => { p.el.setAttribute('transform', `translate(${p.x.toFixed(2)} ${(p.y + (p.step ? -0.8 : 0)).toFixed(2)})`); p.el.parentNode.appendChild(p.el); });
    paint();

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

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
  };
})();
