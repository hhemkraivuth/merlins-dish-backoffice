const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { parseNote } = require('../lib/noteParser');
const { defaultShorthand } = require('../lib/aliases');
const { utc } = require('../lib/dates');

const parse = (t) => parseNote(t, defaultShorthand(), utc(2026, 11, 4));

test('"yielded 20 portions" is a yield', () => {
  const { batches, problems } = parse('6/10\nRagu\nMeat 1600\nyielded 20 portions');
  assert.strictEqual(batches[0].yield, 20);
  assert.deepStrictEqual(problems, []);
});

test('an amount typed as a sum is added up', () => {
  const { batches } = parse('28/10\nTpb\nC 309+115\nO 280\n9 portions');
  assert.strictEqual(batches[0].lines[0].qty, 424);
  assert.strictEqual(batches[0].lines[1].qty, 280);
});

test('stew sizes in every order the note uses', () => {
  for (const [line, want] of [['4l 7r portions', { Large: 4, Regular: 7 }], ['R6 l5 portions', { Regular: 6, Large: 5 }], ['7r 4l portions', { Regular: 7, Large: 4 }], ['R7 l4 portions', { Regular: 7, Large: 4 }], ['6r 5l', { Regular: 6, Large: 5 }]]) {
    const { batches, problems } = parse(`20/10\nDbs\nMeat 1605\n${line}`);
    const got = Object.fromEntries(batches[0].sizeCounts.map((z) => [z.name, z.count]));
    assert.deepStrictEqual(got, want, line);
    assert.deepStrictEqual(problems, [], line);
  }
});

test('a lone "G 60" or "R 7" ingredient is not read as a size', () => {
  const { batches } = parse('20/10\nDbs\nMeat 1605\nG 60\n21 portions');
  assert.deepStrictEqual(batches[0].sizeCounts, []);
  assert.strictEqual(batches[0].lines.length, 2);
});

test('typo dish words from the October note resolve', () => {
  const { batches, problems } = parse('6/10\nTucan\nPork 1150\n9 portions\n14/10\nRsw\nMeat 1600\n7r 4l portions');
  assert.deepStrictEqual(batches.map((b) => b.dishTab), ['Tuscan Pork Braise', 'Red Wine Beef Stew']);
  assert.deepStrictEqual(problems, []);
});

test('an unknown dish word does not push its lines into the batch above', () => {
  const { batches, problems } = parse('19/10\nBolo\nMeat 1000\n20 portions\nzzz\nbacon 8\npelati 1300\n8 portions');
  assert.strictEqual(batches.length, 1);
  assert.strictEqual(batches[0].lines.length, 1);
  assert.ok(problems.some((p) => /"zzz" is not a dish word/.test(p)));
  assert.ok(problems.some((p) => /bacon 8/.test(p) && /no dish above/.test(p)));
});

test('the Sheets client waits and retries when Google says the quota is used up', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (hits <= 2) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 429, message: 'Quota exceeded' } })); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ values: [['ok']] }));
  });
  await new Promise((r) => server.listen(0, r));
  const { google } = require('googleapis');
  const retryConfig = { ...require('../lib/sheetsRetry').SHEETS_RETRY, retryDelay: 10, retryDelayMultiplier: 2, maxRetryDelay: 50 };
  const sheets = google.sheets({ version: 'v4', retryConfig, rootUrl: `http://127.0.0.1:${server.address().port}/` });
  const out = await sheets.spreadsheets.values.get({ spreadsheetId: 'x', range: 'A:A' });
  server.close();
  assert.strictEqual(hits, 3);
  assert.deepStrictEqual(out.data.values, [['ok']]);
});
