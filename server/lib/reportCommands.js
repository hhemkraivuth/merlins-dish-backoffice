// LINE group commands for the numbers. "huddle" refreshes everything and shows the daily summary.
// deps: { huddle(), period(type), sync() }  Returns an array of replies, or null when the text is not a report command.

async function processReports(text, deps) {
  const t = String(text || '').trim().toLowerCase();
  if (/^(huddle|team huddle)$/.test(t)) return [(await deps.huddle()).text];
  if (/^(week|this week|weekly)$/.test(t)) return [await deps.period('week')];
  if (/^(month|this month|monthly)$/.test(t)) return [await deps.period('month')];
  if (/^(sync|sync orders|sync line)$/.test(t)) {
    const s = await deps.sync();
    return [`LINE orders synced: ${s.added} new ledger rows (${s.read} read).${s.problems.length ? `\nChecks:\n${s.problems.slice(0, 5).map((p) => `• ${p}`).join('\n')}` : ''}`];
  }
  return null;
}

module.exports = { processReports };
