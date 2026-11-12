const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../../public/commands.html'), 'utf8');
const copies = [...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);

test('Marketing links card is on the Index with a jump link', () => {
  assert.ok(html.includes('id="marketingLinks"'));
  assert.ok(html.includes('href="#marketingLinks"'));
  assert.ok(html.indexOf('id="marketingLinks"') < html.indexOf('id="commands"'));
});

test('all six links are present and each copy button matches its shown link', () => {
  assert.deepStrictEqual(copies, [
    'https://tinyurl.com/MerlinsNew',
    'https://tinyurl.com/MerlinsBack',
    'https://tinyurl.com/MerlinsDishIG',
    'https://merlins-dish-bot-production.up.railway.app/?src=ad',
    'https://liff.line.me/2011487934-vA458ABe?src=rich',
    'https://lin.ee/YVdEqyn',
  ]);
  for (const c of copies) assert.ok(html.includes(`<code>${c}</code>`), `${c} shown`);
});

test('every src tag is one the order app keeps (lowercase a-z 0-9 _ -, max 12)', () => {
  const tags = [...html.matchAll(/<span class="tag">src=([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepStrictEqual(tags, ['gnew', 'gback', 'ig', 'ad', 'rich']);
  for (const t of tags) assert.match(t, /^[a-z0-9_-]{1,12}$/);
});
