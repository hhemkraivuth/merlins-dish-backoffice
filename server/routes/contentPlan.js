const lib = require('../lib/contentPlan');
const fail = (res, err) => { console.error(err); res.status((err && err.status) || 500).json({ error: String((err && err.message) || err) }); };
module.exports = {
  get: async (req, res) => { try { res.json(await lib.load()); } catch (e) { fail(res, e); } },
  status: async (req, res) => { try { res.json(await lib.setStatus(req.body || {})); } catch (e) { fail(res, e); } },
  week: async (req, res) => { try { res.json(await lib.addWeek(req.body || {})); } catch (e) { fail(res, e); } },
  save: async (req, res) => { try { res.json(await lib.savePlan(req.body || {})); } catch (e) { fail(res, e); } },
};
