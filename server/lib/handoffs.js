// The team inbox. Each row is a note from one team to another, raised automatically from the data.
// Teams: App sales (Grab), Direct sales (LINE), Operations (cooking), Purchasing.
//
// Handoffs tab: Raised | From | To | Message | Status | Reply | Key
// You can type in the Reply column and set Status to Done yourself. A handoff that you closed is never raised again
// for the same situation. A handoff whose situation has cleared (stock sold, batch cooked) closes itself.

const { formatDMY, daysBetween } = require('./dates');

const HANDOFF_TAB = 'Handoffs';
const HANDOFF_HEADERS = ['Raised', 'From', 'To', 'Message', 'Status', 'Reply', 'Key'];
const SALES = 'App sales, Direct sales';
const AGE_LIMIT_DAYS = 5;
const LOW_STOCK = 3;

const portions = (n) => `${n} portion${n === 1 ? '' : 's'}`;

// stock: sellThrough() result. moves: priceMoves() result. Returns [{ from, to, message, key }]
function currentHandoffs({ stock, moves, today, gaps = [] }) {
  const out = [];
  for (const s of stock) {
    for (const b of s.live) {
      if (b.ageDays > AGE_LIMIT_DAYS) {
        out.push({ from: 'Operations', to: SALES, key: `age|${s.dish}|${b.key}`, message: `${s.dish}: ${portions(b.remaining)} from the ${formatDMY(b.date)} batch are ${b.ageDays} days old. Time for a flash sale.` });
      }
    }
    const recentCook = s.latestBatch && daysBetween(today, s.latestBatch.date) <= 14;
    if (s.remaining === 0 && s.cooked > 0 && s.oversold === 0 && recentCook) {
      out.push({ from: 'Operations', to: SALES, key: `out|${s.dish}|${s.latestBatch.key}`, message: `${s.dish} is sold out. Mark it sold out on Grab and in the LINE group.` });
    }
    if (s.remaining > 0 && s.remaining <= LOW_STOCK) {
      out.push({ from: SALES, to: 'Operations', key: `low|${s.dish}|${s.latestBatch.key}`, message: `${s.dish}: only ${portions(s.remaining)} left. Cook another batch?` });
    }
    if (s.oversold > 0) {
      out.push({ from: SALES, to: 'Operations', key: `over|${s.dish}|${s.oversold}`, message: `${s.dish}: ${portions(s.oversold)} sold beyond what the cook notes cover. Send the missing cook note so cost and stock are right.` });
    }
  }
  for (const m of moves || []) {
    if (daysBetween(today, m.date) > 14) continue;
    const pct = Math.round(Math.abs(m.change) * 100);
    out.push({
      from: 'Purchasing', to: 'Operations', key: `price|${m.name}|${m.date.toISOString().slice(0, 10)}`,
      message: `${m.name} is ${m.change > 0 ? 'up' : 'down'} ${pct}% on the ${formatDMY(m.date)} purchase. ${m.change > 0 ? 'Check the margin on dishes that use it.' : 'Margins on dishes that use it improve.'}`,
    });
  }
  for (const g of gaps) {
    out.push({ from: 'Direct sales', to: 'Operations', key: `rider|${g.dmy}|${g.orderNo}`, message: `LINE order ${g.orderNo} on ${g.dmy}${g.customer ? ` (${g.customer})` : ''} has no rider fee yet. Send: rider ${g.orderNo.replace('#', '')} <fee>` });
  }
  return out;
}

// existing: rows from the Handoffs tab (header first). Returns { add: [rows], update: [{ rowIndex, row }] }
function reconcile(existing, current, today) {
  const rows = (existing || []).slice(1);
  const seen = new Set(rows.map((r) => String(r[6] || '').trim()));
  const nowKeys = new Set(current.map((c) => c.key));
  const add = current.filter((c) => !seen.has(c.key)).map((c) => [formatDMY(today), c.from, c.to, c.message, 'Open', '', c.key]);
  const update = [];
  rows.forEach((r, i) => {
    const status = String(r[4] || '').trim().toLowerCase();
    const key = String(r[6] || '').trim();
    if (status === 'open' && key && !nowKeys.has(key)) {
      const row = [r[0] || '', r[1] || '', r[2] || '', r[3] || '', 'Done (cleared)', r[5] || '', key];
      update.push({ rowIndex: i + 2, row });
    }
  });
  return { add, update };
}

function openHandoffs(rows) {
  return (rows || []).slice(1).filter((r) => String(r[4] || '').trim().toLowerCase() === 'open').map((r) => ({ from: r[1], to: r[2], message: r[3] }));
}

module.exports = { HANDOFF_TAB, HANDOFF_HEADERS, currentHandoffs, reconcile, openHandoffs, AGE_LIMIT_DAYS };
