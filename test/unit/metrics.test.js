import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetrics } from '../../src/services/metrics.js';

test('records outcomes and decision latency using fixed-cardinality metrics', () => {
  const metrics = createMetrics();
  metrics.recordDecision('allowed', 4);
  metrics.recordDecision('rejected', 12);
  metrics.recordDecision('errored', 30, { error: true });
  metrics.recordDecision('bypassed', 40, { error: true });

  const output = metrics.renderPrometheus();
  assert.match(output, /decision="allowed"\} 1/);
  assert.match(output, /decision="rejected"\} 1/);
  assert.match(output, /decision="errored"\} 2/);
  assert.match(output, /decision="bypassed"\} 1/);
  assert.match(output, /rate_limiter_errors_total 2/);
  assert.match(output, /decision_duration_milliseconds_count 4/);
  assert.doesNotMatch(output, /userId|clientIp|apiKey/);
});
