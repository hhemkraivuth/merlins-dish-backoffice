// Date helpers. Everything is DD/MM/YYYY (Bangkok), stored as midnight UTC Date objects
// so comparisons never drift with the server's timezone.

function utc(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

// Google Sheets serial date (days since 1899-12-30) -> Date
function fromSerial(n) {
  return new Date(Math.round((n - 25569) * 86400000));
}

// Today's calendar date in Bangkok (UTC+7), as a midnight-UTC Date
function bangkokToday(nowMs = Date.now()) {
  const b = new Date(nowMs + 7 * 3600 * 1000);
  return utc(b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate());
}

// Accepts: Date, Sheets serial number, "DD/MM/YYYY", "D/M/YY", "D/M" (year inferred), "YYYY-MM-DD".
// A year-less date that would land in the future is taken as last year.
function parseDate(value, today = bangkokToday()) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return utc(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  if (typeof value === 'number') return value >= 20000 ? fromSerial(value) : null;

  const s = String(value).trim().replace(/^~/, '');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return utc(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (!m) return null;
  const d = +m[1];
  const mo = +m[2];
  let y = m[3] ? +m[3] : null;
  if (y !== null && y < 100) y += 2000;
  if (y === null) {
    y = today.getUTCFullYear();
    const candidate = utc(y, mo, d);
    if (candidate && candidate.getTime() > today.getTime() + 86400000) y -= 1;
  }
  return utc(y, mo, d);
}

function formatDMY(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getUTCDate())}/${p(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

function daysBetween(later, earlier) {
  return Math.round((later.getTime() - earlier.getTime()) / 86400000);
}

// "2026-10-15T15:26:02.325Z" -> "15/10/2026 22:26" (Bangkok time). Anything unreadable is returned as given.
function formatBangkokStamp(value) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return String(value || '');
  const b = new Date(d.getTime() + 7 * 3600 * 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(b.getUTCDate())}/${p2(b.getUTCMonth() + 1)}/${b.getUTCFullYear()} ${p2(b.getUTCHours())}:${p2(b.getUTCMinutes())}`;
}

module.exports = { parseDate, formatDMY, bangkokToday, daysBetween, utc, formatBangkokStamp };
