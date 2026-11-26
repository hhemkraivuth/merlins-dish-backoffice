const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// A syntax error in a page script leaves the page stuck on "Loading...", so every public script must at least parse.
const dir = path.join(__dirname, '..', '..', 'public');
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
  test(`public/${f} parses`, () => {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f }));
  });
}
