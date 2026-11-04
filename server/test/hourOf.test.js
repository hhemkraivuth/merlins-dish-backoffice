const test = require('node:test');
const assert = require('node:assert');
const { hourOf } = require('../lib/reports');

test('order hour reads 12 hour Grab times and 24 hour LINE times', () => {
  assert.strictEqual(hourOf('8:15PM'), '20');
  assert.strictEqual(hourOf('3:51PM'), '15');
  assert.strictEqual(hourOf('12:28PM'), '12');
  assert.strictEqual(hourOf('12:05AM'), '00');
  assert.strictEqual(hourOf('9:30 am'), '09');
  assert.strictEqual(hourOf('15:42'), '15');
  assert.strictEqual(hourOf('05:29:06'), '05');
  assert.strictEqual(hourOf(''), null);
  assert.strictEqual(hourOf('soon'), null);
});
