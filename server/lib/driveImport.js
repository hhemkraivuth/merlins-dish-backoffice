// Drive handover for the Grab CSV. The nightly task saves each finished CSV into the "Ready for BOH" Drive folder.
// This module picks up every file there, imports it through the same importGrabCsv the Numbers page uses, then moves
// the file to the "Imported" folder. A file that fails stays where it is, so nothing is lost and nothing is hidden.
// Importing is safe to repeat: a Grab CSV replaces only its own days, so a file read twice never doubles up.
//
// Needs: GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY (already set), DRIVE_READY_FOLDER_ID, DRIVE_IMPORTED_FOLDER_ID,
// and both folders shared with the service account as Editor.

const { google } = require('googleapis');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

function driveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY environment variables');
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

function folderIds(env = process.env) {
  const readyId = String(env.DRIVE_READY_FOLDER_ID || '').trim();
  const importedId = String(env.DRIVE_IMPORTED_FOLDER_ID || '').trim();
  if (!readyId || !importedId) throw new Error('Set DRIVE_READY_FOLDER_ID and DRIVE_IMPORTED_FOLDER_ID in Railway first.');
  return { readyId, importedId };
}

const isCsvLike = (f) => /\.csv$/i.test(f.name || '') || f.mimeType === 'text/csv' || f.mimeType === SHEET_MIME;

async function listReady(drive, readyId) {
  const out = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${readyId}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      orderBy: 'name',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    out.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return out.filter(isCsvLike);
}

async function readText(drive, f) {
  const res = f.mimeType === SHEET_MIME
    ? await drive.files.export({ fileId: f.id, mimeType: 'text/csv' }, { responseType: 'arraybuffer' })
    : await drive.files.get({ fileId: f.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data).toString('utf8');
}

async function moveFile(drive, f, readyId, importedId) {
  await drive.files.update({ fileId: f.id, addParents: importedId, removeParents: readyId, fields: 'id', supportsAllDrives: true });
}

// importCsv is importGrabCsv from ledgerService. It is passed in so tests can run without Google.
async function runDriveImport({ drive, importCsv, readyId, importedId, log = console }) {
  const files = await listReady(drive, readyId);
  const results = [];
  for (const f of files) {
    const r = { name: f.name, ok: false, moved: false };
    try {
      const out = await importCsv(await readText(drive, f));
      if (!out.imported) {
        r.error = (out.problems && out.problems[0]) || 'Nothing could be read from that file.';
      } else {
        Object.assign(r, { ok: true, imported: out.imported, replaced: out.replaced, orders: out.orders, flagged: out.flagged, days: out.days, problems: out.problems || [] });
        try { await moveFile(drive, f, readyId, importedId); r.moved = true; } catch (err) { r.moveError = err.message; }
      }
    } catch (err) {
      r.error = err.message;
      log.error(`Drive import failed for ${f.name}:`, err.message);
    }
    results.push(r);
  }
  return { checked: files.length, files: results };
}

// One short message for the BOH LINE group. Empty when there was nothing to do.
function summaryText(run) {
  if (!run.files.length) return '';
  const lines = run.files.map((r) => {
    if (!r.ok) return `Could not import ${r.name}: ${r.error} It is still in "Ready for BOH".`;
    const days = r.days.length === 1 ? r.days[0] : `${r.days[0]} to ${r.days[r.days.length - 1]}`;
    const bits = [`${r.orders} orders, ${r.imported} rows for ${days}`];
    if (r.replaced) bits.push(`replaced ${r.replaced} rows already there`);
    if (r.flagged) bits.push(`${r.flagged} rows carry XXXXXX or a missing figure, please check`);
    if (!r.moved) bits.push('imported, but the file could not be moved to "Imported"');
    return `Imported ${r.name}: ${bits.join(', ')}.`;
  });
  return `Grab handover\n${lines.join('\n')}`;
}

let running = false;

// The real run, with the real Drive and the real Ledger. One run at a time.
async function importFromDrive() {
  if (running) return { checked: 0, files: [], busy: true };
  running = true;
  try {
    const { readyId, importedId } = folderIds();
    const { importGrabCsv } = require('./ledgerService');
    return await runDriveImport({ drive: driveClient(), importCsv: importGrabCsv, readyId, importedId });
  } finally { running = false; }
}

module.exports = { driveClient, FOLDER_MIME, importFromDrive, runDriveImport, summaryText, listReady, folderIds, isCsvLike };
