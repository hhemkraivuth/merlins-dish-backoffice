// Reads Lily's Google Doc "Recipe: Mein Hans Edition" straight from Drive and runs every current recipe through recipeSync.
// Used by the Sync button on the Recipes page. The doc must be shared with the service account (Viewer is enough).
const { google } = require('googleapis');
const recipeSync = require('./recipeSync');

const DOC_ID = () => process.env.RECIPE_DOC_ID || '1P2u7f-_8H9llyY8yHZ-rKX_sOu2tUFcFACFt5hGPDlU';

function authClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !privateKey) throw Object.assign(new Error('Drive is not set up on this server.'), { status: 503 });
  return new google.auth.GoogleAuth({ credentials: { client_email: email, private_key: privateKey }, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
}

async function fetchDocText() {
  const drive = google.drive({ version: 'v3', auth: authClient() });
  for (const mimeType of ['text/markdown', 'text/plain']) {
    try {
      const res = await drive.files.export({ fileId: DOC_ID(), mimeType }, { responseType: 'text' });
      return String(res.data || '');
    } catch (err) {
      const code = Number(err && (err.code || (err.response && err.response.status)));
      if (code === 403 || code === 404) {
        const who = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'the BOH service account';
        throw new Error(`BOH cannot open the recipe doc. Share it with ${who} as Viewer, then press Sync again.`);
      }
      if (mimeType === 'text/plain') throw err;
    }
  }
  return '';
}

// Everything above the "Previously" line is current. Each recipe is "Update: D/M", a title line, then its text.
function parseDoc(raw) {
  let text = String(raw || '').replace(/\r\n/g, '\n');
  const cut = text.search(/^[\s*_#>\\]*Previously\b/im);
  if (cut > 0) text = text.slice(0, cut);
  const lines = text.split('\n');
  const isUpdate = (l) => /^[\s*_#>\\]*Update\s*:\s*\d{1,2}\s*\/\s*\d{1,2}/i.test(l);
  const out = []; const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!isUpdate(lines[i])) continue;
    const updated = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(lines[i]); let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const title = recipeSync.cleanTitle(lines[j] || '');
    let k = j + 1; while (k < lines.length && !isUpdate(lines[k])) k++;
    const key = title.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, updated: `${updated[1]}/${updated[2]}`, text: lines.slice(j + 1, k).join('\n') });
  }
  return out;
}

async function syncFromDoc({ fetchText = fetchDocText, sync = recipeSync.sync } = {}) {
  const recipes = parseDoc(await fetchText());
  if (recipes.length < 5) throw new Error(`Only ${recipes.length} recipes could be read from the doc, so nothing was changed. Check that the "Update:" lines and the "Previously" line are still in the doc.`);
  const results = [];
  for (const r of recipes) {
    try { const o = await sync(r); results.push({ title: r.title, dish: o.dish, result: o.result, why: o.why || '' }); }
    catch (err) { results.push({ title: r.title, result: 'error', why: String((err && err.message) || err) }); }
  }
  const count = (re) => results.filter((x) => re.test(x.result)).length;
  return { results, updated: count(/^updated/), added: count(/^new/), unchanged: count(/^unchanged/), kept: count(/^kept/), errors: count(/^error/) };
}

module.exports = { parseDoc, syncFromDoc, fetchDocText };
