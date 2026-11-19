const { bangkokToday } = require('../lib/dates');
const { loadCustomers } = require('../lib/customers');

// Read only: the Customers page lists what is in the Customers tab of the order app's sheet.
async function customersJson(req, res) {
  try {
    const t = bangkokToday();
    const out = await loadCustomers(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    res.json(out);
  } catch (err) { console.error(err); res.status(500).json({ error: String((err && err.message) || err) }); }
}
module.exports = { customersJson };
