const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { toJpeg, isHeic } = require('../lib/contentMedia');

test('an iPhone HEIC photo becomes a real JPEG', async () => {
  const heic = fs.readFileSync(path.join(__dirname, 'fixtures', 'tiny.heic'));
  const jpg = await toJpeg(heic, 0.9);
  assert.strictEqual(jpg.slice(0, 3).toString('hex'), 'ffd8ff');
  assert.ok(jpg.length > 100);
});

test('HEIC is spotted by mime type or file name', () => {
  assert.ok(isHeic({ mimeType: 'image/heic', name: 'a.bin' }));
  assert.ok(isHeic({ mimeType: 'image/heif', name: 'a' }));
  assert.ok(isHeic({ mimeType: 'application/octet-stream', name: 'IMG_4153.HEIC' }));
  assert.ok(!isHeic({ mimeType: 'image/jpeg', name: 'IMG_4202.JPG' }));
});
