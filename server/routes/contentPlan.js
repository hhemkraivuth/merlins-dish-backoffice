const lib = require('../lib/contentPlan');
const fail = (res, err) => { console.error(err); res.status((err && err.status) || 500).json({ error: String((err && err.message) || err) }); };
module.exports = {
  get: async (req, res) => { try { res.json(await lib.load()); } catch (e) { fail(res, e); } },
  status: async (req, res) => { try { res.json(await lib.setStatus(req.body || {})); } catch (e) { fail(res, e); } },
  schedule: async (req, res) => { try { res.json(await lib.setSchedule(req.body || {})); } catch (e) { fail(res, e); } },
  media: async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!/^[A-Za-z0-9_-]{10,80}$/.test(id) || !(await lib.mediaAllowed(id))) return res.status(404).end();
      const out = await require('../lib/contentMedia').preview(id);
      if (!out) return res.status(404).end();
      res.set('Content-Type', out.type).set('Cache-Control', 'private, max-age=3600').send(out.body);
    } catch (e) { fail(res, e); }
  },
  mediaPost: async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!/^[A-Za-z0-9_-]{10,80}$/.test(id) || !(await lib.mediaAllowed(id))) return res.status(404).end();
      const out = await require('../lib/contentMedia').postImage(id);
      if (!out) return res.status(404).end();
      res.set('Content-Type', out.type).set('Cache-Control', 'public, max-age=3600').send(out.body);
    } catch (e) { fail(res, e); }
  },
  captionCheck: async (req, res) => { try { res.json(await require('../lib/captionCheck').run((req.body || {}).caption)); } catch (e) { fail(res, e); } },
  caption: async (req, res) => { try { res.json(await lib.setCaption(req.body || {})); } catch (e) { fail(res, e); } },
  footer: async (req, res) => { try { res.json(await lib.setFooter(req.body || {})); } catch (e) { fail(res, e); } },
  brief: async (req, res) => { try { res.json(await lib.addBrief(req.body || {})); } catch (e) { fail(res, e); } },
  briefUpdate: async (req, res) => { try { res.json(await lib.updateBrief(req.body || {})); } catch (e) { fail(res, e); } },
  week: async (req, res) => { try { res.json(await lib.addWeek(req.body || {})); } catch (e) { fail(res, e); } },
  save: async (req, res) => { try { res.json(await lib.savePlan(req.body || {})); } catch (e) { fail(res, e); } },
};
