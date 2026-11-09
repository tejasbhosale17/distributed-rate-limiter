import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { createRedisClient } from '../../src/redis/client.js';
import { createSlidingWindowLimiter } from '../../src/services/sliding-window-limiter.js';

const logger = createLogger({ level: 'silent' });
const apiKeys = {
  'demo-key-alice': 'user-alice',
  'demo-key-bob': 'user-bob',
};

test('Express rate-limit middleware integration', async (t) => {
  const redisClient = createRedisClient({
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    logger,
  });
  await redisClient.connect();
  t.after(() => redisClient.quit());

  async function createTestApp(overrides = {}, limiterOverride) {
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_ENV: `http-${randomUUID()}`,
      DEMO_API_KEYS: JSON.stringify(apiKeys),
      ...overrides,
    });
    const limiter = limiterOverride ?? await createSlidingWindowLimiter({
      redisClient,
      appEnv: config.appEnv,
    });
    return createApp({ config, limiter, logger });
  }

  await t.test('limits public traffic by IP and returns complete 429 metadata', async () => {
    const app = await createTestApp({ IP_RATE_LIMIT: '2', IP_RATE_WINDOW_MS: '10000' });
    const first = await request(app).get('/api/public');
    const second = await request(app).get('/api/public');
    const rejected = await request(app).get('/api/public');

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(rejected.status, 429);
    assert.equal(rejected.body.error.code, 'RATE_LIMIT_EXCEEDED');
    assert.equal(rejected.body.requestId, rejected.headers['x-request-id']);
    assert.equal(rejected.body.instanceId, rejected.headers['x-instance-id']);
    assert.equal(rejected.headers['ratelimit-limit'], '2');
    assert.equal(rejected.headers['ratelimit-remaining'], '0');
    assert.equal(rejected.headers['ratelimit-policy'], 'ip');
    assert.equal(rejected.headers['ratelimit-window'], '10000ms');
    assert.ok(Number(rejected.headers['ratelimit-reset']) > 0);
    assert.equal(rejected.headers['retry-after'], String(rejected.body.retryAfterSeconds));
  });

  await t.test('authenticates stable users and ignores arbitrary X-User-ID values', async () => {
    const app = await createTestApp({ USER_RATE_LIMIT: '1', USER_RATE_WINDOW_MS: '10000' });

    const spoofed = await request(app)
      .get('/api/account')
      .set('X-User-ID', 'user-alice');
    assert.equal(spoofed.status, 401);
    assert.equal(spoofed.body.error.code, 'UNAUTHORIZED');

    const alice = await request(app)
      .get('/api/account')
      .set('Authorization', 'Bearer demo-key-alice');
    assert.equal(alice.status, 200);
    assert.equal(alice.body.userId, 'user-alice');

    const sameUserWithSpoofedHeader = await request(app)
      .get('/api/account')
      .set('Authorization', 'Bearer demo-key-alice')
      .set('X-User-ID', 'user-bob');
    assert.equal(sameUserWithSpoofedHeader.status, 429);

    const bob = await request(app)
      .get('/api/account')
      .set('Authorization', 'Bearer demo-key-bob');
    assert.equal(bob.status, 200);
    assert.equal(bob.body.userId, 'user-bob');
  });

  await t.test('enforces both IP and user policies and retries after the latest blocker', async () => {
    const app = await createTestApp({
      IP_RATE_LIMIT: '1',
      IP_RATE_WINDOW_MS: '1000',
      USER_RATE_LIMIT: '1',
      USER_RATE_WINDOW_MS: '3000',
    });

    assert.equal((await request(app)
      .get('/api/account')
      .set('Authorization', 'Bearer demo-key-alice')).status, 200);

    const userAndIpBlocked = await request(app)
      .get('/api/account')
      .set('Authorization', 'Bearer demo-key-alice');
    assert.equal(userAndIpBlocked.status, 429);
    assert.equal(userAndIpBlocked.headers['ratelimit-policy'], 'user');
    assert.equal(userAndIpBlocked.headers['retry-after'], userAndIpBlocked.headers['ratelimit-reset']);

    const otherUserStillSharesIpQuota = await request(app)
      .get('/api/account')
      .set('Authorization', 'Bearer demo-key-bob');
    assert.equal(otherUserStillSharesIpQuota.status, 429);
    assert.equal(otherUserStillSharesIpQuota.headers['ratelimit-policy'], 'ip');
  });

  await t.test('rejects invalid API keys without authenticating a supplied user ID', async () => {
    const app = await createTestApp();
    const response = await request(app)
      .get('/api/public')
      .set('Authorization', 'Bearer invalid-demo-key')
      .set('X-User-ID', 'user-alice');

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHORIZED');
  });

  await t.test('does not trust forwarded client addresses by default', async () => {
    const app = await createTestApp({
      IP_RATE_LIMIT: '1',
      IP_RATE_WINDOW_MS: '10000',
      TRUST_PROXY_HOPS: '0',
    });
    const first = await request(app)
      .get('/api/public')
      .set('X-Forwarded-For', '203.0.113.10');
    const second = await request(app)
      .get('/api/public')
      .set('X-Forwarded-For', '198.51.100.20');

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
  });

  await t.test('applies an additional route-specific policy', async () => {
    const app = await createTestApp({
      IP_RATE_LIMIT: '100',
      SCOPED_RATE_LIMIT: '1',
      SCOPED_RATE_WINDOW_MS: '10000',
    });
    assert.equal((await request(app).get('/api/scoped')).status, 200);
    const rejected = await request(app).get('/api/scoped');
    assert.equal(rejected.status, 429);
    assert.equal(rejected.headers['ratelimit-policy'], 'scoped');
    assert.equal(rejected.headers['ratelimit-remaining'], '0');
  });

  await t.test('forwards limiter failures to centralized error handling', async () => {
    const app = await createTestApp({}, {
      async consume() {
        throw new Error('test Redis failure');
      },
    });
    const response = await request(app).get('/api/public');

    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, 'INTERNAL_SERVER_ERROR');
    assert.equal(response.body.requestId, response.headers['x-request-id']);
  });
});
