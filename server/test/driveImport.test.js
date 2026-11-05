const test = require('node:test');
const assert = require('node:assert');
const { runDriveImport, summaryText, isCsvLike, folderIds } = require('../lib/driveImport');
const { startDriveImportTimer } = require('../lib/scheduler');

// A fake Drive: files sit in "ready"; moving one changes its parent.
function fakeDrive(files, { moveFails = false } = {}) {
  const parents = new Map(files.map((f) => [f.id, 'ready']));
  const moved = [];
  return {
    moved,
    files: {
      list: async () => ({ data: { files: files.filter((f) => parents.get(f.id) === 'ready').map(({ id, name, mimeType }) => ({ id, name, mimeType })) } }),
      get: async ({ fileId }) => ({ data: Buffer.from(files.find((f) => f.id === fileId).text, 'utf8') }),
      export: async ({ fileId }) => ({ data: Buffer.from(files.find((f) => f.id === fileId).text, 'utf8') }),
      update: async ({ fileId, addParents }) => { if (moveFails) throw new Error('cannot move'); parents.set(fileId, addParents); moved.push(fileId); return { data: {} }; },
    },
  };
}
const quiet = { log() {}, error() {} };
const okImport = async (text) => (text.startsWith('bad') ? { imported: 0, problems: ['This does not look like the Claude Log CSV.'] } : { imported: 79, replaced: 0, orders: 12, flagged: 1, days: ['02/09/2026'], problems: [] });

test('a good CSV is imported and moved; a bad one stays put with its reason', async () => {
  const drive = fakeDrive([
    { id: 'a', name: 'merlins_dish_claude_log_02_09_2026.csv', mimeType: 'text/csv', text: 'Date,x' },
    { id: 'b', name: 'broken.csv', mimeType: 'text/csv', text: 'bad file' },
    { id: 'c', name: 'notes.txt', mimeType: 'text/plain', text: 'ignore me' },
  ]);
  const run = await runDriveImport({ drive, importCsv: okImport, readyId: 'ready', importedId: 'done', log: quiet });
  assert.strictEqual(run.checked, 2);                                  // notes.txt is not a CSV
  assert.deepStrictEqual(drive.moved, ['a']);
  assert.strictEqual(run.files[0].ok, true);
  assert.strictEqual(run.files[0].moved, true);
  assert.strictEqual(run.files[1].ok, false);
  assert.match(run.files[1].error, /does not look like/);
  assert.match(summaryText(run), /Imported merlins_dish_claude_log_02_09_2026\.csv: 12 orders, 79 rows for 02\/09\/2026.*1 rows carry XXXXXX/s);
  assert.match(summaryText(run), /Could not import broken\.csv.*still in "Ready for BOH"/s);
});

test('an import that throws leaves the file in place and does not stop the next file', async () => {
  const drive = fakeDrive([
    { id: 'a', name: 'a.csv', mimeType: 'text/csv', text: 'boom' },
    { id: 'b', name: 'b.csv', mimeType: 'text/csv', text: 'Date,x' },
  ]);
  const importCsv = async (t) => { if (t === 'boom') throw new Error('Sheets was unreachable'); return okImport(t); };
  const run = await runDriveImport({ drive, importCsv, readyId: 'ready', importedId: 'done', log: quiet });
  assert.deepStrictEqual(drive.moved, ['b']);
  assert.strictEqual(run.files[0].error, 'Sheets was unreachable');
});

test('if the move fails the import still counts and the summary says so', async () => {
  const drive = fakeDrive([{ id: 'a', name: 'a.csv', mimeType: 'text/csv', text: 'Date,x' }], { moveFails: true });
  const run = await runDriveImport({ drive, importCsv: okImport, readyId: 'ready', importedId: 'done', log: quiet });
  assert.strictEqual(run.files[0].ok, true);
  assert.strictEqual(run.files[0].moved, false);
  assert.match(summaryText(run), /could not be moved/);
});

test('Google Sheets files are accepted, empty folder gives no message', async () => {
  assert.ok(isCsvLike({ name: 'x', mimeType: 'application/vnd.google-apps.spreadsheet' }));
  assert.ok(isCsvLike({ name: 'X.CSV', mimeType: 'application/octet-stream' }));
  assert.ok(!isCsvLike({ name: 'x.txt', mimeType: 'text/plain' }));
  const run = await runDriveImport({ drive: fakeDrive([]), importCsv: okImport, readyId: 'ready', importedId: 'done', log: quiet });
  assert.strictEqual(summaryText(run), '');
});

test('folder ids must be set; timer is off unless asked', () => {
  assert.throws(() => folderIds({}), /DRIVE_READY_FOLDER_ID/);
  assert.deepStrictEqual(folderIds({ DRIVE_READY_FOLDER_ID: ' r ', DRIVE_IMPORTED_FOLDER_ID: 'i' }), { readyId: 'r', importedId: 'i' });
  delete process.env.DRIVE_IMPORT_AUTO;
  assert.strictEqual(startDriveImportTimer(async () => {}), null);
});
