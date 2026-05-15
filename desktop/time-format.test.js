const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatElapsed } = require('./time-format');

test('formatElapsed renders 0 as 0:00', () => {
  assert.equal(formatElapsed(0), '0:00');
});

test('formatElapsed zero-pads seconds below ten', () => {
  assert.equal(formatElapsed(7), '0:07');
});

test('formatElapsed rolls over to minutes at 60s', () => {
  assert.equal(formatElapsed(60), '1:00');
});

test('formatElapsed formats arbitrary larger durations', () => {
  assert.equal(formatElapsed(125), '2:05');
});

test('formatElapsed floors fractional seconds', () => {
  assert.equal(formatElapsed(7.9), '0:07');
});

test('formatElapsed clamps negative input to 0:00', () => {
  assert.equal(formatElapsed(-3), '0:00');
});
