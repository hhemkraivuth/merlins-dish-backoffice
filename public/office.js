// The office: a soft, flat illustration (no pixels). One desk per team, three pigs in t shirts and a giraffe chef
// who stroll between the desks. Plain SVG, so it stays sharp on any screen. Desk name plates are HTML on top so they stay tappable.
(function () {
  const W = 400, H = 275;
  // Desk centres. The first three sit along the top, the last two lower down.
  const DESKS = [[75, 78], [200, 78], [325, 78], [137, 168], [263, 168]];
  const SEAT_DY = 56; // the seat is just below the desk
  const C = { wall: '#aebfd3', floor: '#c4d1e1', desk: '#f3e6d6', deskTop: '#fbf3e8', shade: '#8fa3bb', screen: '#7f97b4', pink: '#f6d5cf', ear: '#eaa3ae', cheek: '#f2a9ae', collar: '#8a5a3c', line: '#6d5a52' };

  const TEES = ['#e8604c', '#4f78d6', '#f2c14e'];

  function pig(shirt) {
    return `
      <ellipse cx="0" cy="30" rx="15" ry="3.5" fill="#000" opacity=".08"/>
      <rect x="-10" y="19" width="6" height="11" rx="3" fill="${C.pink}"/>
      <rect x="4" y="19" width="6" height="11" rx="3" fill="${C.pink}"/>
      <path d="M-14 4 Q-14 -2 -8 -2 H8 Q14 -2 14 4 V21 Q14 24 11 24 H-11 Q-14 24 -14 21 Z" fill="${shirt}"/>
      <path d="M-14 6 q-5 4 -3 11" stroke="${C.pink}" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path d="M14 6 q5 4 3 11" stroke="${C.pink}" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path d="M-13 -9 Q-20 -22 -9 -21 Q-5 -17 -5 -14 Z" fill="${C.ear}"/>
      <path d="M13 -9 Q20 -22 9 -21 Q5 -17 5 -14 Z" fill="${C.ear}"/>
      <ellipse cx="0" cy="-8" rx="15" ry="13" fill="${C.pink}"/>
      <rect x="-11" y="-1" width="22" height="4.5" rx="2.2" fill="${C.collar}"/>
      <circle cx="-8.5" cy="-5" r="3" fill="${C.cheek}" opacity=".75"/>
      <circle cx="8.5" cy="-5" r="3" fill="${C.cheek}" opacity=".75"/>
      <ellipse cx="0" cy="-5" rx="6" ry="4.4" fill="${C.ear}"/>
      <circle cx="-2" cy="-5" r="1" fill="${C.line}"/><circle cx="2" cy="-5" r="1" fill="${C.line}"/>
      <circle cx="-6" cy="-12" r="1.7" fill="${C.line}"/><circle cx="6" cy="-12" r="1.7" fill="${C.line}"/>`;
  }

  function giraffe() {
    const sp = '#b9824a';
    return `
      <ellipse cx="0" cy="30" rx="16" ry="3.5" fill="#000" opacity=".08"/>
      <rect x="-9" y="19" width="6" height="11" rx="3" fill="#f0c779"/>
      <rect x="3" y="19" width="6" height="11" rx="3" fill="#f0c779"/>
      <rect x="-5" y="-30" width="10" height="26" rx="5" fill="#f0c779"/>
      <circle cx="-1.5" cy="-24" r="2" fill="${sp}"/><circle cx="2" cy="-15" r="2.2" fill="${sp}"/><circle cx="-2" cy="-8" r="1.8" fill="${sp}"/>
      <path d="M-14 4 Q-14 -2 -8 -2 H8 Q14 -2 14 4 V21 Q14 24 11 24 H-11 Q-14 24 -14 21 Z" fill="#f7f2ea"/>
      <path d="M-14 6 q-5 4 -3 11" stroke="#f0c779" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path d="M14 6 q5 4 3 11" stroke="#f0c779" stroke-width="5" stroke-linecap="round" fill="none"/>
      <rect x="-3" y="-2" width="6" height="5" rx="2" fill="${C.collar}"/>
      <rect x="-3" y="-44" width="1.8" height="8" rx=".9" fill="${sp}"/><circle cx="-2.1" cy="-45" r="2" fill="${sp}"/>
      <rect x="1.2" y="-44" width="1.8" height="8" rx=".9" fill="${sp}"/><circle cx="2.1" cy="-45" r="2" fill="${sp}"/>
      <ellipse cx="-8" cy="-34" rx="4" ry="2.4" fill="#e6b365" transform="rotate(-25 -8 -34)"/>
      <ellipse cx="8" cy="-34" rx="4" ry="2.4" fill="#e6b365" transform="rotate(25 8 -34)"/>
      <ellipse cx="0" cy="-33" rx="10" ry="8.5" fill="#f0c779"/>
      <ellipse cx="0" cy="-29" rx="6.5" ry="4.4" fill="#f8dfae"/>
      <circle cx="-2.2" cy="-29.5" r=".9" fill="${C.line}"/><circle cx="2.2" cy="-29.5" r=".9" fill="${C.line}"/>
      <circle cx="-4.5" cy="-35" r="1.5" fill="${C.line}"/><circle cx="4.5" cy="-35" r="1.5" fill="${C.line}"/>
      <circle cx="-7" cy="-31" r="2" fill="${C.cheek}" opacity=".6"/><circle cx="7" cy="-31" r="2" fill="${C.cheek}" opacity=".6"/>
      <path d="M-9 -38 q-3 -9 4 -9 q2 -5 5 -2 q3 -3 5 2 q7 0 4 9 Z" fill="#fff"/>
      <rect x="-9" y="-39" width="18" height="3.6" rx="1.8" fill="#f1ebe0"/>`;
  }

  function desk([x, y]) {
    return `<g>
      <rect x="${x - 38}" y="${y + 4}" width="76" height="30" rx="7" fill="${C.desk}"/>
      <rect x="${x - 38}" y="${y + 2}" width="76" height="9" rx="4.5" fill="${C.deskTop}"/>
      <rect x="${x - 12}" y="${y - 20}" width="24" height="17" rx="3" fill="${C.screen}"/>
      <rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="${C.shade}"/>
      <rect x="${x + 18}" y="${y - 6}" width="10" height="9" rx="2" fill="#f6efe6"/>
      <rect x="${x - 30}" y="${y + 34}" width="5" height="10" rx="2.5" fill="${C.shade}"/><rect x="${x + 25}" y="${y + 34}" width="5" height="10" rx="2.5" fill="${C.shade}"/>
    </g>`;
  }

  const CHARS = [pig(TEES[0]), pig(TEES[1]), pig(TEES[2]), giraffe()];

  function scene() {
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="An office with five team desks, three pigs in t shirts and a giraffe chef strolling between them" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="${C.wall}"/>
      <rect y="${H * 0.52}" width="${W}" height="${H * 0.48}" fill="${C.floor}"/>
      <circle cx="340" cy="26" r="9" fill="#eef3f8" opacity=".7"/><circle cx="50" cy="34" r="6" fill="#eef3f8" opacity=".55"/>
      ${DESKS.map(desk).join('')}
      ${CHARS.map((c, i) => `<g class="ch" data-i="${i}" style="transition:transform 2.6s ease-in-out"><g class="bob"><g transform="scale(1.35)">${c}</g></g></g>`).join('')}
    </svg>`;
  }

  const seat = (i) => [DESKS[i][0], DESKS[i][1] + SEAT_DY];

  // teams: [{name, open:[]}]  onPick(index)
  window.PigOffice = function (box, teams, onPick) {
    box.innerHTML = scene();
    const place = (el, i) => { const [x, y] = seat(i); el.style.transform = `translate(${x}px, ${y}px)`; };
    const chars = [...box.querySelectorAll('.ch')];
    const at = chars.map((_, n) => n % DESKS.length);
    chars.forEach((el, n) => { el.style.transition = 'none'; place(el, at[n]); void el.getBoundingClientRect(); el.style.transition = 'transform 2.6s ease-in-out'; });

    teams.slice(0, DESKS.length).forEach((t, i) => {
      const [x, y] = DESKS[i];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'plate';
      b.style.left = `${(x / W) * 100}%`;
      b.style.top = `${((y - 24) / H) * 100}%`;
      const n = (t.open || []).length;
      b.innerHTML = `${String(t.name).replace(/[&<>"]/g, '')}${n ? `<span class="n">${n}</span>` : ''}`;
      b.addEventListener('click', () => onPick(i));
      box.appendChild(b);
    });

    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    setInterval(() => {
      const n = Math.floor(Math.random() * chars.length);
      const taken = new Set(at);
      const options = DESKS.map((_, i) => i).filter((i) => !taken.has(i));
      if (!options.length) return;
      const to = options[Math.floor(Math.random() * options.length)];
      at[n] = to; place(chars[n], to);
      const bob = chars[n].querySelector('.bob');
      if (bob.animate) bob.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }], { duration: 650, iterations: 4 });
    }, 3200);
  };
})();
