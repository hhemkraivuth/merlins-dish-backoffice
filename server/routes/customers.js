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
const send = (res, err) => { if (!err.status) console.error(err); res.status(err.status || 500).json({ error: String((err && err.message) || err) }); };
async function customerSave(req, res) { try { res.json(await require('../lib/customers').saveCustomer(req.body || {})); } catch (err) { send(res, err); } }
async function customerMerge(req, res) { try { res.json(await require('../lib/customers').mergeCustomers(req.body || {})); } catch (err) { send(res, err); } }
module.exports = { customersJson, customerSave, customerMerge };
