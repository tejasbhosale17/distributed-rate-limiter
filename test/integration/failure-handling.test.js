import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { connectRedis, createRedisClient } from '../../src/redis/client.js';
import { createSlidingWindowLimiter } from '../../src/services/sliding-window-limiter.js';

const logger = createLogger({ level: 'silent' });

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(50);
  }
  throw new Error(message);
}

test('bounded Redis outage, fail modes, and recovery', async (t) => {
  const unavailableClient = createRedisClient({
    url: 'redis://127.0.0.1:1',
    logger,
    connectTimeoutMs: 100,
    commandTimeoutMs: 50,
  });
  const startupStartedAt = performance.now();
  await assert.rejects(connectRedis(unavailableClient, 250));
  assert.ok(performance.now() - startupStartedAt < 1000);

  const containerName = `rate-limit-failure-${randomUUID().slice(0, 8)}`;
  const portReservation = createServer();
  portReservation.listen(0, '127.0.0.1');
  await new Promise((resolve) => portReservation.once('listening', resolve));
  const port = portReservation.address().port;
  await new Promise((resolve, reject) => {
    portReservation.close((error) => error ? reject(error) : resolve());
  });

  execFileSync('docker', [
    'run',
    '--detach',
    '--name',
    containerName,
    '--publish',
    `127.0.0.1:${port}:6379`,
    'redis:7.4-alpine',
  ], { stdio: 'ignore' });

  let redisClient;
  t.after(() => {
    redisClient?.destroy();
    execFileSync('docker', ['rm', '--force', containerName], { stdio: 'ignore' });
  });

  const redisUrl = `redis://127.0.0.1:${port}`;
  redisClient = createRedisClient({
    url: redisUrl,
    logger,
    connectTimeoutMs: 200,
    commandTimeoutMs: 200,
  });
  await connectRedis(redisClient, 2_000);

  const appEnv = `failure-${randomUUID()}`;
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ENV: appEnv,
    REDIS_URL: redisUrl,
    REDIS_COMMAND_TIMEOUT_MS: '200',
    REDIS_CONNECT_TIMEOUT_MS: '200',
    DEMO_API_KEYS: '{}',
  });
  const limiter = await createSlidingWindowLimiter({ redisClient, appEnv });
  const readinessCheck = () => redisClient.isReady;
  const closedApp = createApp({ config, limiter, logger, readinessCheck });

  await t.test('reports ready and admits traffic while Redis is healthy', async () => {
    assert.equal((await request(closedApp).get('/health/ready')).status, 200);
    assert.equal((await request(closedApp).get('/api/public')).status, 200);
  });

  await t.test('bounds slow Redis commands and fails closed with 503', async () => {
    const slowAppEnv = `slow-${randomUUID()}`;
    const slowConfig = loadConfig({
      NODE_ENV: 'test',
      APP_ENV: slowAppEnv,
      REDIS_URL: redisUrl,
      REDIS_COMMAND_TIMEOUT_MS: '50',
      IP_RATE_LIMIT: '1',
      DEMO_API_KEYS: '{}',
    });
    const slowRedisClient = {
      scriptLoad: (...args) => redisClient.scriptLoad(...args),
      evalSha: (...args) => redisClient.evalSha(...args).then(
        (result) => new Promise((resolve) => setTimeout(() => resolve(result), 150)),
        (error) => new Promise((resolve, reject) => setTimeout(() => reject(error), 150)),
      ),
    };
    const slowLimiter = await createSlidingWindowLimiter({
      redisClient: slowRedisClient,
      appEnv: slowAppEnv,
      commandTimeoutMs: 50,
    });
    const slowApp = createApp({
      config: slowConfig,
      limiter: slowLimiter,
      logger,
      readinessCheck: () => redisClient.isReady,
    });
    const startedAt = performance.now();
    const response = await request(slowApp).get('/api/public');
    const elapsedMs = performance.now() - startedAt;

    assert.equal(response.status, 503, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'RATE_LIMITER_UNAVAILABLE');
    assert.ok(elapsedMs < 500, `request took ${elapsedMs}ms`);
    await delay(200);

    const normalLimiter = await createSlidingWindowLimiter({
      redisClient,
      appEnv: slowAppEnv,
    });
    const normalApp = createApp({
      config: slowConfig,
      limiter: normalLimiter,
      logger,
      readinessCheck,
    });
    const uncertainAdmission = await request(normalApp).get('/api/public');
    assert.equal(uncertainAdmission.status, 429);
  });

  execFileSync('docker', ['stop', '--timeout', '1', containerName], { stdio: 'ignore' });
  await waitFor(() => !redisClient.isReady, 3_000, 'Redis client did not report the outage');

  await t.test('fails closed as 503 and reports Redis unready', async () => {
    const readiness = await request(closedApp).get('/health/ready');
    const response = await request(closedApp).get('/api/public');

    assert.equal(readiness.status, 503);
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'RATE_LIMITER_UNAVAILABLE');
    assert.notEqual(response.status, 429);
  });

  await t.test('fails open only when configured and records the bypass', async () => {
    const openConfig = loadConfig({
      NODE_ENV: 'test',
      APP_ENV: appEnv,
      REDIS_URL: redisUrl,
      REDIS_FAILURE_MODE: 'open',
      DEMO_API_KEYS: '{}',
    });
    const openApp = createApp({ config: openConfig, limiter, logger, readinessCheck });
    const response = await request(openApp).get('/api/public');

    assert.equal(response.status, 200);
    assert.equal(response.headers['x-rate-limit-bypassed'], 'true');
    const metrics = await request(openApp).get('/metrics');
    assert.match(metrics.text, /decision="bypassed"\} 1/);
    assert.match(metrics.text, /rate_limiter_errors_total 1/);
  });

  execFileSync('docker', ['start', containerName], { stdio: 'ignore' });
  await waitFor(() => redisClient.isReady, 10_000, `Redis client did not recover (open=${redisClient.isOpen})`);

  await t.test('returns to normal limiting after Redis recovers', async () => {
    assert.equal((await request(closedApp).get('/health/ready')).status, 200);
    const response = await request(closedApp).get('/api/public');
    assert.equal(response.status, 200);
    assert.equal(response.headers['x-rate-limit-bypassed'], undefined);
  });
});
