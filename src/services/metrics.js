const decisions = ['allowed', 'rejected', 'errored', 'bypassed'];
const bucketsMs = [5, 10, 25, 50, 100, 250, 500, 1000];

export function createMetrics() {
  const counts = Object.fromEntries(decisions.map((decision) => [decision, 0]));
  const bucketCounts = new Map(bucketsMs.map((bucket) => [bucket, 0]));
  let observationCount = 0;
  let durationSumMs = 0;

  return {
    recordDecision(decision, durationMs, { error = false } = {}) {
      if (!decisions.includes(decision)) {
        throw new TypeError(`Unsupported limiter decision: ${decision}`);
      }
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new RangeError('Decision duration must be a non-negative number');
      }

      counts[decision] += 1;
      if (error && decision !== 'errored') {
        counts.errored += 1;
      }

      observationCount += 1;
      durationSumMs += durationMs;
      for (const bucket of bucketsMs) {
        if (durationMs <= bucket) {
          bucketCounts.set(bucket, bucketCounts.get(bucket) + 1);
        }
      }
    },

    renderPrometheus() {
      const lines = [
        '# HELP rate_limiter_decisions_total Limiter decisions by outcome.',
        '# TYPE rate_limiter_decisions_total counter',
        ...decisions.map((decision) => (
          `rate_limiter_decisions_total{decision="${decision}"} ${counts[decision]}`
        )),
        '# HELP rate_limiter_errors_total Limiter decision errors, including fail-open bypasses.',
        '# TYPE rate_limiter_errors_total counter',
        `rate_limiter_errors_total ${counts.errored}`,
        '# HELP rate_limiter_decision_duration_milliseconds Limiter decision latency in milliseconds.',
        '# TYPE rate_limiter_decision_duration_milliseconds histogram',
        ...bucketsMs.map((bucket) => (
          `rate_limiter_decision_duration_milliseconds_bucket{le="${bucket}"} ${bucketCounts.get(bucket)}`
        )),
        `rate_limiter_decision_duration_milliseconds_bucket{le="+Inf"} ${observationCount}`,
        `rate_limiter_decision_duration_milliseconds_sum ${durationSumMs}`,
        `rate_limiter_decision_duration_milliseconds_count ${observationCount}`,
      ];

      return `${lines.join('\n')}\n`;
    },
  };
}
