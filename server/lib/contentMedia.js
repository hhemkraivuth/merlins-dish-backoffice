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

const isHeic = (meta) => /^image\/(heic|heif)/i.test(meta.mimeType || '') || /\.(heic|heif)$/i.test(meta.name || '');

// iPhone photos arrive as HEIC. Browsers and Instagram cannot read them, so BOH turns them into JPEG on the way out.
async function toJpeg(buffer, quality = 0.9) {
  const convert = require('heic-convert');
  return Buffer.from(await convert({ buffer, format: 'JPEG', quality }));
}

async function fileOf(drive, fileId) {
  const meta = (await drive.files.get({ fileId, fields: 'id,name,mimeType,size,thumbnailLink', supportsAllDrives: true })).data;
  return meta;
}
async function bytesOf(drive, fileId) {
  const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

// The picture the page shows. Returns { type, body } where body is a Buffer, or null when there is nothing to show.
async function preview(fileId) {
  const auth = authClient();
  const drive = google.drive({ version: 'v3', auth });
  const meta = await fileOf(drive, fileId);
  if (/^image\//.test(meta.mimeType || '') && Number(meta.size || 0) <= MAX_IMAGE) {
    const body = await bytesOf(drive, fileId);
    if (isHeic(meta)) return { type: 'image/jpeg', body: await toJpeg(body, 0.7) };
    return { type: meta.mimeType, body };
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

// The picture that goes to Instagram and Facebook: JPEG or PNG at full size. A HEIC original becomes a JPEG.
async function postImage(fileId) {
  const auth = authClient();
  const drive = google.drive({ version: 'v3', auth });
  const meta = await fileOf(drive, fileId);
  if (!/^image\//.test(meta.mimeType || '') || Number(meta.size || 0) > MAX_IMAGE) return null;
  const body = await bytesOf(drive, fileId);
  if (isHeic(meta)) return { type: 'image/jpeg', body: await toJpeg(body, 0.92) };
  return { type: meta.mimeType, body };
}

module.exports = { preview, postImage, toJpeg, isHeic };
