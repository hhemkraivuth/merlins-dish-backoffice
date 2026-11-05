// Daily huddle timer. Off unless HUDDLE_AUTO=on. HUDDLE_TIME is Bangkok time, HH:MM (default 21:30).
// No extra packages: it checks the clock once a minute and sends at most once per Bangkok day.
//
// "Already sent today" is kept in `store` (the App State tab in production), not in memory, so a deploy or restart
// later in the day never sends it again. It only sends within GRACE_HOURS after the set time, so a restart late in the
// day does not send a huddle that was missed. If the store cannot be read, nothing is sent and the next minute tries again.

const GRACE_HOURS = 3;
const MAX_ATTEMPTS = 3;
const KEY = 'huddle_last_sent';

function memoryStore() { let v = ''; return { get: async () => v, set: async (key, x) => { v = x; } }; }

function startHuddleTimer(run, { now = () => Date.now(), every = 60000, log = console, store = memoryStore() } = {}) {
  if (String(process.env.HUDDLE_AUTO || '').toLowerCase() !== 'on') return null;
  const at = /^\d{1,2}:\d{2}$/.test(process.env.HUDDLE_TIME || '') ? process.env.HUDDLE_TIME : '21:30';
  const [h, m] = at.split(':').map(Number);
  let doneDay = null; // a day we know is finished, so we stop asking the store
  let busy = false;
  const attempts = new Map();
  const tick = async () => {
    if (busy) return;
    const b = new Date(now() + 7 * 3600 * 1000);
    const day = b.toISOString().slice(0, 10);
    if (doneDay === day) return;
    const minutes = b.getUTCHours() * 60 + b.getUTCMinutes();
    const start = h * 60 + m;
    if (minutes < start || minutes >= start + GRACE_HOURS * 60) return;
    busy = true;
    try {
      let last;
      try { last = await store.get(KEY); } catch (err) { log.error('Huddle: could not check the last sent day, not sending.', err.message); return; }
      if (last === day) { doneDay = day; return; }
      if ((attempts.get(day) || 0) >= MAX_ATTEMPTS) { doneDay = day; return; }
      attempts.set(day, (attempts.get(day) || 0) + 1);
      try { await store.set(KEY, day); } catch (err) { log.error('Huddle: could not record the send, not sending.', err.message); return; }
      try { await run(); doneDay = day; log.log(`Huddle sent for ${day}`); }
      catch (err) { log.error('Huddle failed:', err.message); await store.set(KEY, last || '').catch(() => {}); }
    } finally { busy = false; }
  };
  return setInterval(tick, every);
}

// Drive handover timer. Off unless DRIVE_IMPORT_AUTO=on. Checks the "Ready for BOH" folder every
// DRIVE_IMPORT_EVERY_MIN minutes (default 15, never less than 5). Empty checks are silent.
function startDriveImportTimer(run, { every, log = console } = {}) {
  if (String(process.env.DRIVE_IMPORT_AUTO || '').toLowerCase() !== 'on') return null;
  const mins = Math.max(5, Number(process.env.DRIVE_IMPORT_EVERY_MIN) || 15);
  const tick = async () => {
    try {
      const out = await run();
      if (out && out.files && out.files.length) log.log(`Drive import: ${out.files.length} file(s) found`);
    } catch (err) { log.error('Drive import failed:', err.message); }
  };
  return setInterval(tick, every || mins * 60000);
}

module.exports = { startHuddleTimer, startDriveImportTimer };
