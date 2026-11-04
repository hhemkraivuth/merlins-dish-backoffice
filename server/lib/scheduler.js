// Nightly huddle timer. Off unless HUDDLE_AUTO=on. HUDDLE_TIME is Bangkok time, HH:MM (default 21:30).
// No extra packages: it checks the clock once a minute and runs once per Bangkok day.

function startHuddleTimer(run, { now = () => Date.now(), every = 60000, log = console } = {}) {
  if (String(process.env.HUDDLE_AUTO || '').toLowerCase() !== 'on') return null;
  const at = /^\d{1,2}:\d{2}$/.test(process.env.HUDDLE_TIME || '') ? process.env.HUDDLE_TIME : '21:30';
  const [h, m] = at.split(':').map(Number);
  let lastDay = null;
  const tick = async () => {
    const b = new Date(now() + 7 * 3600 * 1000);
    const day = b.toISOString().slice(0, 10);
    const due = b.getUTCHours() > h || (b.getUTCHours() === h && b.getUTCMinutes() >= m);
    if (!due || lastDay === day) return;
    lastDay = day;
    try { await run(); log.log(`Huddle sent for ${day}`); } catch (err) { log.error('Huddle failed:', err.message); }
  };
  return setInterval(tick, every);
}

module.exports = { startHuddleTimer };
