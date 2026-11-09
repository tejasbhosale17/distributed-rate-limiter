import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createRedisClient } from '../../src/redis/client.js';
import {
  buildPolicyKey,
  createSlidingWindowLimiter,
} from '../../src/services/sliding-window-limiter.js';

const logger = {
  error(fields, message) {
    console.error(message, fields.err);
  },
};

test('Redis sliding-window integration', async (t) => {
  const redisClient = createRedisClient({
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    logger,
  });
  await redisClient.connect();
  t.after(() => redisClient.quit());

  const appEnv = `test-${randomUUID()}`;
  const limiter = await createSlidingWindowLimiter({ redisClient, appEnv });
  const policy = (name, identity, limit, windowMs, scope = 'global') => ({
    name,
    identity,
    limit,
    windowMs,
    scope,
  });

  await t.test('admits requests below and at the exact limit, then rejects', async () => {
    const requestPolicy = policy('exact', 'client-1', 3, 10_000);
    assert.equal((await limiter.consume([requestPolicy])).allowed, true);
    assert.equal((await limiter.consume([requestPolicy])).allowed, true);
    const finalAdmission = await limiter.consume([requestPolicy]);
    assert.equal(finalAdmission.allowed, true);
    assert.equal(finalAdmission.policies[0].remaining, 0);

    const rejected = await limiter.consume([requestPolicy]);
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.policies[0].remaining, 0);
    assert.ok(rejected.retryAfterMs > 0);
  });

  await t.test('enforces rolling-window expiry and its inclusive cutoff', async () => {
    const requestPolicy = policy('rolling', 'client-2', 1, 350);
    const first = await limiter.consume([requestPolicy]);
    assert.equal(first.allowed, true);
    const rejected = await limiter.consume([requestPolicy]);
    assert.equal(rejected.allowed, false);

    await new Promise((resolve) => setTimeout(resolve, rejected.retryAfterMs + 20));
    assert.equal((await limiter.consume([requestPolicy])).allowed, true);
  });

  await t.test('isolates identities, policies, scopes, and environments', async () => {
    assert.equal((await limiter.consume([policy('identity', 'one', 1, 10_000)])).allowed, true);
    assert.equal((await limiter.consume([policy('identity', 'two', 1, 10_000)])).allowed, true);
    assert.equal((await limiter.consume([policy('other-policy', 'one', 1, 10_000)])).allowed, true);
    assert.equal((await limiter.consume([policy('identity', 'one', 1, 10_000, 'route-b')])).allowed, true);

    const otherEnvironment = await createSlidingWindowLimiter({
      redisClient,
      appEnv: `${appEnv}-other`,
    });
    assert.equal((await otherEnvironment.consume([policy('identity', 'one', 1, 10_000)])).allowed, true);
  });

  await t.test('uses unique sorted-set members for requests sharing a timestamp', async () => {
    const requestPolicy = policy('unique-events', 'same-time', 40, 10_000);
    const results = await Promise.all(
      Array.from({ length: 40 }, () => limiter.consume([requestPolicy])),
    );
    assert.equal(results.filter((result) => result.allowed).length, 40);

    const eventMembers = await redisClient.zRange(buildPolicyKey(appEnv, requestPolicy), 0, -1);
    assert.equal(eventMembers.length, 40);
    assert.equal(new Set(eventMembers).size, 40);
  });

  await t.test('does not partially record a rejected multi-policy request', async () => {
    const ipPolicy = policy('atomic-ip', 'client-3', 2, 10_000);
    const userPolicy = policy('atomic-user', 'user-3', 1, 10_000);

    assert.equal((await limiter.consume([ipPolicy, userPolicy])).allowed, true);
    const denied = await limiter.consume([ipPolicy, userPolicy]);
    assert.equal(denied.allowed, false);
    assert.equal(denied.policies.find(({ name }) => name === 'atomic-user').blocked, true);

    const ipOnlyAdmission = await limiter.consume([ipPolicy]);
    assert.equal(ipOnlyAdmission.allowed, true);
    assert.equal(ipOnlyAdmission.policies[0].remaining, 0);
  });

  await t.test('expires inactive keys after the configured window', async () => {
    const requestPolicy = policy('expiry', 'client-4', 2, 300);
    await limiter.consume([requestPolicy]);

    const ttl = await redisClient.pTTL(buildPolicyKey(appEnv, requestPolicy));
    assert.ok(ttl > 0 && ttl <= requestPolicy.windowMs);
    await new Promise((resolve) => setTimeout(resolve, requestPolicy.windowMs + 50));
    assert.equal(await redisClient.exists(buildPolicyKey(appEnv, requestPolicy)), 0);
  });

  await t.test('repeated rejections do not extend key lifetime', async () => {
    const requestPolicy = policy('rejected-ttl', 'client-4b', 1, 800);
    const key = buildPolicyKey(appEnv, requestPolicy);
    await limiter.consume([requestPolicy]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal((await limiter.consume([requestPolicy])).allowed, false);

    const ttl = await redisClient.pTTL(key);
    assert.ok(ttl > 0 && ttl < requestPolicy.windowMs - 300);
    await new Promise((resolve) => setTimeout(resolve, ttl + 50));
    assert.equal(await redisClient.exists(key), 0);
  });

  await t.test('admits exactly the shared quota under concurrent calls', async () => {
    const requestPolicy = policy('concurrent', 'shared-client', 12, 10_000);
    const results = await Promise.all(
      Array.from({ length: 48 }, () => limiter.consume([requestPolicy])),
    );
    assert.equal(results.filter((result) => result.allowed).length, 12);
    assert.equal(results.filter((result) => !result.allowed).length, 36);
  });

  await t.test('reloads a script after Redis loses its script cache', async () => {
    await redisClient.scriptFlush();
    const result = await limiter.consume([policy('script-reload', 'client-5', 1, 10_000)]);
    assert.equal(result.allowed, true);
  });
});
