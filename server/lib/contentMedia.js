// Preview of the Drive file a post uses. The page asks for /api/content-plan/media/<fileId>.
// Only a file that a post in the plan names is served, so this can never open the rest of the Drive.
// Needs the Raw shoots folder shared with the service account (Viewer is enough).

const { google } = require('googleapis');

const MAX_IMAGE = 12 * 1024 * 1024;

function authClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !privateKey) throw Object.assign(new Error('Drive is not set up on this server.'), { status: 503 });
  return new google.auth.GoogleAuth({ credentials: { client_email: email, private_key: privateKey }, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
}

// Returns { type, body } where body is a Buffer, or null when there is nothing to show.
async function preview(fileId) {
  const auth = authClient();
  const drive = google.drive({ version: 'v3', auth });
  const meta = (await drive.files.get({ fileId, fields: 'id,name,mimeType,size,thumbnailLink', supportsAllDrives: true })).data;
  if (/^image\//.test(meta.mimeType || '') && Number(meta.size || 0) <= MAX_IMAGE) {
    const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    return { type: meta.mimeType, body: Buffer.from(res.data) };
  }
  if (meta.thumbnailLink) {
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    const url = String(meta.thumbnailLink).replace(/=s\d+$/, '=s640');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return { type: res.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await res.arrayBuffer()) };
  }
  return null;
}

module.exports = { preview };
