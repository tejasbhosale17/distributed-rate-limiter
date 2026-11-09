import assert from 'node:assert/strict';
import test from 'node:test';
import { retryAfterSeconds } from '../../src/services/sliding-window-limiter.js';

test('rounds retry durations up to whole seconds and never returns zero', () => {
  assert.equal(retryAfterSeconds(0), 1);
  assert.equal(retryAfterSeconds(1), 1);
  assert.equal(retryAfterSeconds(1000), 1);
  assert.equal(retryAfterSeconds(1001), 2);
});

test('rejects invalid retry durations', () => {
  assert.throws(() => retryAfterSeconds(-1), RangeError);
  assert.throws(() => retryAfterSeconds(Number.NaN), RangeError);
});
