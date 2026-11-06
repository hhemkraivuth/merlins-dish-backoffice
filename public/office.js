// The office: the same layout, size and colours as the original pixel office, redrawn as soft flat shapes (no pixels).
// One desk per team, three pigs in red, blue and yellow t shirts and a giraffe chef who walk between the desks.
// Plain SVG. Desk name plates are HTML on top so they stay sharp and tappable.
(function () {
  const W = 192, H = 120, LANE = 54;
  const DESKS = [[16, 16], [82, 16], [148, 16], [48, 72], [116, 72]]; // top-left of each desk, 28 x 12
  const TOP_ROW = 3;
  const KITCHEN = 2; // Operations
  const SCREEN = ['#7fd6a0', '#7fb6f0', '#f4c27f', '#e8a0c0', '#c9a0f0'];
  const PIGS = [
    { name: 'Red', shirt: '#e63d23' },
    { name: 'Blue', shirt: '#294bd4' },
    { name: 'Yellow', shirt: '#f8cc1a' },
    { name: 'Chef', giraffe: true },
  ];
  const P = { pink: '#f4a6b8', ear: '#e07a95', snout: '#d9607f', ink: '#2b1b1b', boot: '#5a3b2e', collar: '#8a5a3b' };

  function seatOf(i) {
    const [dx, dy] = DESKS[i];
    const sx = dx + 8, sy = dy + 16;
    if (i < TOP_ROW) return { seat: [sx, sy], out: [[sx, LANE]], into: [[sx, LANE]] };
    const ax = dx - 14;
    return { seat: [sx, sy], out: [[ax, sy], [ax, LANE]], into: [[ax, LANE], [ax, sy]] };
  }
  const SEATS = DESKS.map((_, i) => seatOf(i));
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
    const body = '#f2c46d', spot = '#b9824a';
    return `
      <rect x="3" y="9" width="2.4" height="3" rx="1.2" fill="${P.boot}"/><rect x="6.6" y="9" width="2.4" height="3" rx="1.2" fill="${P.boot}"/>
      <rect x="2" y="6" width="8" height="5" rx="1.6" fill="#ffffff"/>
      <rect x="4.6" y="-5" width="2.8" height="8" rx="1.4" fill="${body}"/>
      <circle cx="5.4" cy="-2.6" r=".7" fill="${spot}"/><circle cx="6.6" cy="-.2" r=".7" fill="${spot}"/>
      <rect x="1.6" y="-.2" width="8.8" height="6.4" rx="3" fill="${body}"/>
      <ellipse cx="6" cy="4.2" rx="2.4" ry="1.5" fill="#f8dfae"/>
      <circle cx="5.2" cy="4.2" r=".35" fill="${P.ink}"/><circle cx="6.8" cy="4.2" r=".35" fill="${P.ink}"/>
      <circle cx="4" cy="2.4" r=".5" fill="${P.ink}"/><circle cx="8" cy="2.4" r=".5" fill="${P.ink}"/>
      <circle cx="2" cy="1.2" r=".8" fill="${spot}"/><circle cx="10" cy="1.2" r=".8" fill="${spot}"/>
      <rect x="3" y="-3.2" width="6" height="3.2" rx="1.2" fill="#ffffff"/><rect x="2.4" y="-.8" width="7.2" height="1.4" rx=".7" fill="#ffffff"/>`;
  }

  function room() {
    let s = `<rect width="${W}" height="${H}" fill="#e3e4e8"/>`;
    for (let y = 12; y < H; y += 8) for (let x = ((y / 8) % 2) * 8; x < W; x += 16) s += `<rect x="${x}" y="${y}" width="8" height="8" rx="1.2" fill="#cfd1d8"/>`;
    s += `<rect width="${W}" height="12" fill="#e63d23"/><rect y="10" width="${W}" height="2" fill="#f8cc1a"/>`;
    [30, 90, 150].forEach((x) => { s += `<rect x="${x}" y="2" width="14" height="7" rx="1.4" fill="#bfe1ee"/><rect x="${x + 6}" y="2" width="1" height="7" fill="#8fc0d4"/>`; });
    s += `<rect x="184" y="98" width="6" height="8" rx="2.4" fill="#4c6b4f"/><rect x="185" y="106" width="4" height="5" rx="1" fill="#7c5c3e"/>`;
    s += `<rect x="70" y="100" width="52" height="14" rx="5" fill="#294bd4" opacity=".18"/>`;
    return s;
  }
  function kitchen(x, y) {
    return `<rect x="${x}" y="${y + 12}" width="28" height="2" rx="1" fill="#8d939e"/><rect x="${x}" y="${y}" width="28" height="12" rx="2" fill="#c4c9d2"/><rect x="${x}" y="${y}" width="28" height="2" rx="1" fill="#e8ebf0"/>
      <rect x="${x + 2}" y="${y + 4}" width="11" height="7" rx="1.4" fill="#3a3f4a"/><rect x="${x + 15}" y="${y + 4}" width="11" height="7" rx="1.4" fill="#3a3f4a"/>
      <rect x="${x + 3}" y="${y + 1}" width="9" height="7" rx="2" fill="#e63d23"/><rect x="${x + 3}" y="${y + 1}" width="9" height="1.4" rx=".7" fill="#a82a2a"/>
      <circle cx="${x + 17}" cy="${y + 10}" r="1" fill="#f8cc1a"/><circle cx="${x + 21}" cy="${y + 10}" r="1" fill="#f8cc1a"/><circle cx="${x + 25}" cy="${y + 10}" r=".8" fill="#f8cc1a"/>
      <circle cx="${x + 7}" cy="${y - 3}" r="1.2" fill="#fff" opacity=".8"/><circle cx="${x + 9}" cy="${y - 6}" r="1.2" fill="#fff" opacity=".8"/>
      <rect x="${x + 19}" y="${y - 5}" width="1" height="5" fill="#6b7080"/><rect x="${x + 18}" y="${y - 5}" width="3" height="1" rx=".5" fill="#6b7080"/>`;
  }
  function desk([x, y], i) {
    if (i === KITCHEN) return kitchen(x, y);
    return `<rect x="${x}" y="${y + 12}" width="28" height="2" rx="1" fill="#5c3f28"/><rect x="${x}" y="${y}" width="28" height="12" rx="2" fill="#8a5a3b"/><rect x="${x}" y="${y}" width="28" height="2" rx="1" fill="#a06c47"/>
      <rect x="${x + 9}" y="${y + 1}" width="10" height="7" rx="1.2" fill="#2a2622"/><rect x="${x + 10}" y="${y + 2}" width="8" height="5" rx=".8" fill="${SCREEN[i % 5]}"/><rect x="${x + 13}" y="${y + 8}" width="2" height="2" fill="#2a2622"/>
      <rect x="${x + 21}" y="${y + 6}" width="4" height="3" rx=".6" fill="#d9d2c4"/>`;
  }

  window.PigOffice = function (box, teams, onPick) {
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="An office with five team desks, three pigs in t shirts and a giraffe chef walking between them" xmlns="http://www.w3.org/2000/svg">${room()}${DESKS.map(desk).join('')}${PIGS.map((p, n) => `<g class="ch" data-n="${n}">${p.giraffe ? giraffe() : pig(p.shirt)}</g>`).join('')}</svg>`;
    const els = [...box.querySelectorAll('.ch')];
    const pigs = PIGS.map((p, n) => { const at = n % DESKS.length; return { at, x: SEATS[at].seat[0], y: SEATS[at].seat[1], path: [], wait: 1 + n * 1.3, step: 0, t: 0, el: els[n] }; });
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
            const options = DESKS.map((_, i) => i).filter((i) => i !== p.at && !taken.has(i));
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
