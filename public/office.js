// The pig office: a small pixel canvas with one desk per team and four pigs walking between them.
// Drawn with plain rectangles, no images. Desk name plates are HTML on top so they stay sharp and tappable.
(function () {
  const W = 192, H = 120, LANE = 54;
  const DESKS = [[16, 16], [82, 16], [148, 16], [48, 72], [116, 72]]; // top-left of each desk, 28 x 12
  const TOP_ROW = 3;

  const SPRITE = [
    '....hhhh....',
    '...hhhhhh...',
    '.ee.pppp.ee.',
    '.epppppppppe'.slice(0, 12),
    '..pkppppkp..',
    '..pppssppp..',
    '..pppssppp..',
    '...cccccc...',
    '..cccccccc..',
    '..cccccccc..',
    '...cc..cc...',
    '...dd..dd...',
  ];
  const CHEF = ['...wwwwww...', '..wwwwwwww..'].map((r) => r.slice(0, 12));
  const PIGS = [
    { name: 'Red', shirt: '#e63d23', hat: '#a82a2a' },
    { name: 'Blue', shirt: '#294bd4', hat: '#1d368f' },
    { name: 'Yellow', shirt: '#f8cc1a', hat: '#c9a00c' },
    { name: 'Chef', shirt: '#f4f0e8', hat: '#ffffff', chef: true },
  ];
  const BASE = { p: '#f4a6b8', e: '#e07a95', s: '#d9607f', k: '#2b1b1b', d: '#5a3b2e' };

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
    const pts = [...a.out, [b.into[0][0], LANE], ...b.into.slice(1), b.seat];
    return pts;
  }

  function drawSprite(ctx, pig, x, y, step) {
    x = Math.round(x); y = Math.round(y);
    const pal = { ...BASE, c: pig.shirt, h: pig.hat, w: '#ffffff' };
    const rows = SPRITE.map((r, i) => (pig.chef && i < 2 ? CHEF[i] : r));
    const bob = step ? -1 : 0;
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < 12; rx++) {
        const ch = row[rx];
        if (ch === '.' ) continue;
        let px = rx, py = ry;
        if (ry >= 10 && step) px += (rx < 6 ? 1 : -1) * 0; // legs stay, body bobs
        ctx.fillStyle = pal[ch] || '#000';
        ctx.fillRect(x + px, y + py + (ry < 10 ? bob : 0), 1, 1);
      }
    });
    if (pig.chef) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 3, y - 2 + bob, 6, 2); }
  }

  function drawRoom(ctx) {
    ctx.fillStyle = '#bfe6e3'; ctx.fillRect(0, 0, W, H);
    for (let y = 12; y < H; y += 8) for (let x = ((y / 8) % 2) * 8; x < W; x += 16) { ctx.fillStyle = '#9fd6d2'; ctx.fillRect(x, y, 8, 8); }
    ctx.fillStyle = '#e63d23'; ctx.fillRect(0, 0, W, 12);
    ctx.fillStyle = '#f8cc1a'; ctx.fillRect(0, 10, W, 2);
    // windows
    [30, 90, 150].forEach((x) => { ctx.fillStyle = '#bfe1ee'; ctx.fillRect(x, 2, 14, 7); ctx.fillStyle = '#8fc0d4'; ctx.fillRect(x + 6, 2, 1, 7); });
    // plant
    ctx.fillStyle = '#4c6b4f'; ctx.fillRect(184, 98, 6, 8); ctx.fillStyle = '#7c5c3e'; ctx.fillRect(185, 106, 4, 5);
    // rug
    ctx.fillStyle = '#294bd4'; ctx.globalAlpha = 0.18; ctx.fillRect(70, 100, 52, 14); ctx.globalAlpha = 1;
  }

  function drawDesks(ctx) {
    DESKS.forEach(([x, y], i) => {
      ctx.fillStyle = '#5c3f28'; ctx.fillRect(x, y + 12, 28, 2); // shadow edge
      ctx.fillStyle = '#8a5a3b'; ctx.fillRect(x, y, 28, 12);
      ctx.fillStyle = '#a06c47'; ctx.fillRect(x, y, 28, 2);
      ctx.fillStyle = '#2a2622'; ctx.fillRect(x + 9, y + 1, 10, 7); // monitor
      ctx.fillStyle = ['#7fd6a0', '#7fb6f0', '#f4c27f', '#e8a0c0', '#c9a0f0'][i % 5]; ctx.fillRect(x + 10, y + 2, 8, 5);
      ctx.fillStyle = '#2a2622'; ctx.fillRect(x + 13, y + 8, 2, 2);
      ctx.fillStyle = '#d9d2c4'; ctx.fillRect(x + 21, y + 6, 4, 3); // paper
    });
  }

  function start(canvas, reduced) {
    const ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    const pigs = PIGS.map((p, n) => {
      const at = n % DESKS.length;
      return { ...p, at, x: SEATS[at].seat[0], y: SEATS[at].seat[1], path: [], wait: 1 + n * 1.3, step: 0, t: 0 };
    });
    const frame = () => {
      drawRoom(ctx); drawDesks(ctx);
      [...pigs].sort((a, b) => a.y - b.y).forEach((p) => drawSprite(ctx, p, p.x, p.y, p.step));
    };
    frame();
    if (reduced) return;
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
      frame();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // teams: [{name, open:[]}]  onPick(index)
  window.PigOffice = function (box, teams, onPick) {
    box.innerHTML = '<canvas aria-label="Pixel office with four pigs walking between five team desks"></canvas>';
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
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    start(box.querySelector('canvas'), reduced);
  };
  window.PigOffice._sprite = SPRITE;
})();
