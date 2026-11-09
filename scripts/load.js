import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';

function readPositiveInteger(name, defaultValue, maximum) {
  const rawValue = process.env[name];
  const value = rawValue === undefined ? defaultValue : Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function percentile(sortedValues, fraction) {
  return sortedValues[Math.max(0, Math.ceil(sortedValues.length * fraction) - 1)];
}

const requestCount = readPositiveInteger('LOAD_REQUESTS', 500, 10_000);
const concurrency = readPositiveInteger('LOAD_CONCURRENCY', 50, 1_000);
const projectName = `rate-limit-load-${randomUUID().slice(0, 8)}`;
const apiKey = randomBytes(24).toString('hex');
const userId = `load-user-${randomUUID()}`;
const baseUrl = 'http://127.0.0.1:8080';
const composeArgs = ['compose', '--project-name', projectName];
const env = {
  ...process.env,
  APP_ENV: `load-${randomUUID()}`,
  IP_RATE_LIMIT: String(requestCount + 1),
  IP_RATE_WINDOW_MS: '300000',
  USER_RATE_LIMIT: String(requestCount + 1),
  USER_RATE_WINDOW_MS: '300000',
  REDIS_COMMAND_TIMEOUT_MS: '5000',
  DEMO_API_KEYS: JSON.stringify({ [apiKey]: userId }),
};

function compose(args) {
  execFileSync('docker', [...composeArgs, ...args], { env, stdio: 'inherit' });
}

async function waitForProxy() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health/ready`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The service may still be starting.
    }
    await delay(1_000);
  }

  throw new Error('The Docker proxy did not become ready in 120 seconds');
}

try {
  compose(['up', '-d', '--build']);
  await waitForProxy();

  const latenciesMs = [];
  const errors = [];
  const statusCounts = {};
  const startedAt = performance.now();
  let nextRequest = 0;

  async function sendRequests() {
    while (nextRequest < requestCount) {
      nextRequest += 1;
      const requestStartedAt = performance.now();
      try {
        const response = await fetch(`${baseUrl}/api/account`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        await response.arrayBuffer();
        latenciesMs.push(performance.now() - requestStartedAt);
        statusCounts[response.status] = (statusCounts[response.status] ?? 0) + 1;
      } catch (error) {
        statusCounts.error = (statusCounts.error ?? 0) + 1;
        if (errors.length < 5) {
          errors.push(error.message);
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, requestCount) }, () => sendRequests()),
  );
  const elapsedMs = performance.now() - startedAt;
  const sortedLatencies = latenciesMs.toSorted((left, right) => left - right);
  const summary = {
    offered: requestCount,
    concurrency: Math.min(concurrency, requestCount),
    completed: Object.values(statusCounts).reduce((total, count) => total + count, 0),
    statusCounts,
    errors,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    throughputRequestsPerSecond: Number((requestCount * 1000 / elapsedMs).toFixed(2)),
    latencyMs: latenciesMs.length === 0 ? null : {
      p50: Number(percentile(sortedLatencies, 0.50).toFixed(2)),
      p95: Number(percentile(sortedLatencies, 0.95).toFixed(2)),
      p99: Number(percentile(sortedLatencies, 0.99).toFixed(2)),
      max: Number(sortedLatencies.at(-1).toFixed(2)),
    },
  };
  console.log(JSON.stringify(summary, null, 2));

  if (summary.completed !== requestCount || statusCounts[200] !== requestCount) {
    throw new Error('Load test expected every offered request to complete with HTTP 200');
  }
} finally {
  compose(['down', '--volumes', '--remove-orphans']);
}
