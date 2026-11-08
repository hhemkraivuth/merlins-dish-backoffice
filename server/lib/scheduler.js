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


// Weekly Drive export timer. Off unless WEEKLY_EXPORT_AUTO=on. WEEKLY_EXPORT_TIME is Bangkok time, HH:MM (default 20:00).
// Runs once every Sunday and saves the week that just finished (Sunday to Saturday). Catches up if the app was down or
// restarting then: it exports for the most recent Sunday that has passed its time and was not saved yet.
// "Already exported" lives in `store` (App State tab), so a deploy never repeats it.
// run(sunday) gets "YYYY-MM-DD" of that Sunday. A failed run is tried again up to 3 times, at least 10 minutes apart.
const WEEKLY_KEY = 'weekly_export_last';
const RETRY_GAP_MS = 10 * 60000;

function startWeeklyExportTimer(run, { now = () => Date.now(), every = 60000, log = console, store = memoryStore() } = {}) {
  if (String(process.env.WEEKLY_EXPORT_AUTO || '').toLowerCase() !== 'on') return null;
  const at = /^\d{1,2}:\d{2}$/.test(process.env.WEEKLY_EXPORT_TIME || '') ? process.env.WEEKLY_EXPORT_TIME : '20:00';
  const [h, m] = at.split(':').map(Number);
  let doneDay = null;
  let busy = false;
  const tries = new Map(); // sunday -> { n, last }
  const tick = async () => {
    if (busy) return;
    const b = new Date(now() + 7 * 3600 * 1000);
    let back = b.getUTCDay(); // days since the last Sunday
    if (back === 0 && b.getUTCHours() * 60 + b.getUTCMinutes() < h * 60 + m) back = 7; // today is Sunday but not time yet
    const due = new Date(b.getTime() - back * 86400000).toISOString().slice(0, 10);
    if (doneDay === due) return;
    const t = tries.get(due) || { n: 0, last: 0 };
    if (t.n >= 3 || now() - t.last < RETRY_GAP_MS) return;
    busy = true;
    try {
      let last;
      try { last = await store.get(WEEKLY_KEY); } catch (err) { log.error('Weekly export: could not check the last export, not running.', err.message); return; }
      if (last >= due) { doneDay = due; return; }
      tries.set(due, { n: t.n + 1, last: now() });
      try { await run(due); await store.set(WEEKLY_KEY, due); doneDay = due; log.log(`Weekly export saved for ${due}`); }
      catch (err) { log.error('Weekly export failed:', err.message); }
    } finally { busy = false; }
  };
  return setInterval(tick, every);
}

// Daily stock snapshot from the customer bot. Off unless BOT_URL is set. Runs at STOCK_SNAPSHOT_TIME (Bangkok, default 03:00,
// the same hour as the nightly Grab task), once a day. "Already done" lives in `store`, so a restart never repeats it.
const STOCK_KEY = 'stock_snapshot_last';
function startStockSnapshotTimer(run, { now = () => Date.now(), every = 60000, log = console, store = memoryStore() } = {}) {
  if (!String(process.env.BOT_URL || process.env.BOT_MENU_URL || '').trim()) return null;
  const at = /^\d{1,2}:\d{2}$/.test(process.env.STOCK_SNAPSHOT_TIME || '') ? process.env.STOCK_SNAPSHOT_TIME : '03:00';
  const [h, m] = at.split(':').map(Number);
  let doneDay = null; let busy = false; let lastTry = 0;
  const tick = async () => {
    if (busy) return;
    const b = new Date(now() + 7 * 3600 * 1000);
    if (b.getUTCHours() * 60 + b.getUTCMinutes() < h * 60 + m) return;
    const day = b.toISOString().slice(0, 10);
    if (doneDay === day || now() - lastTry < RETRY_GAP_MS) return;
    busy = true;
    try {
      let last; try { last = await store.get(STOCK_KEY); } catch (err) { log.error('Stock snapshot: could not check the last run.', err.message); return; }
      if (last === day) { doneDay = day; return; }
      lastTry = now();
      try { await run(); await store.set(STOCK_KEY, day); doneDay = day; log.log(`Stock snapshot saved for ${day}`); }
      catch (err) { log.error('Stock snapshot failed:', err.message); }
    } finally { busy = false; }
  };
  return setInterval(tick, every);
}

// Monthly overheads. On by default, MONTHLY_OVERHEADS_AUTO=off turns it off. Checks once a day from MONTHLY_OVERHEADS_TIME
// (Bangkok, default 06:00) and logs every monthly item not yet logged for this month, dated the 1st. A missed 1st is caught
// up the next day the app is running. "Already logged" is kept per item in App State, so a restart never doubles a row.
function startMonthlyOverheadsTimer(run, { now = () => Date.now(), every = 60000, log = console } = {}) {
  if (String(process.env.MONTHLY_OVERHEADS_AUTO || '').toLowerCase() === 'off') return null;
  const at = /^\d{1,2}:\d{2}$/.test(process.env.MONTHLY_OVERHEADS_TIME || '') ? process.env.MONTHLY_OVERHEADS_TIME : '06:00';
  const [h, m] = at.split(':').map(Number);
  let doneDay = null; let busy = false; let lastTry = 0;
  const tick = async () => {
    if (busy) return;
    const b = new Date(now() + 7 * 3600 * 1000);
    if (b.getUTCHours() * 60 + b.getUTCMinutes() < h * 60 + m) return;
    const day = b.toISOString().slice(0, 10);
    if (doneDay === day || now() - lastTry < RETRY_GAP_MS) return;
    busy = true; lastTry = now();
    try { const out = await run(); doneDay = day; if (out && out.logged && out.logged.length) log.log(`Monthly overheads logged: ${out.logged.map((x) => x.name).join(', ')}`); }
    catch (err) { log.error('Monthly overheads failed:', err.message); }
    finally { busy = false; }
  };
  return setInterval(tick, every);
}

module.exports = { startHuddleTimer, startDriveImportTimer, startWeeklyExportTimer, startStockSnapshotTimer, startMonthlyOverheadsTimer };
