import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../../src/config.js';

test('loads defaults and valid explicit configuration', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '4321',
    REDIS_URL: 'rediss://cache.example.com:6380',
    TRUST_PROXY_HOPS: '2',
    DEMO_API_KEYS: '{"demo-key-alice":"user-alice"}',
  });

  assert.equal(config.nodeEnv, 'test');
  assert.equal(config.port, 4321);
  assert.equal(config.redisUrl, 'rediss://cache.example.com:6380');
  assert.equal(config.trustProxyHops, 2);
  assert.deepEqual(config.rateLimits, {
    ip: { limit: 100, windowMs: 60_000 },
    user: { limit: 20, windowMs: 60_000 },
    scoped: { limit: 5, windowMs: 60_000 },
  });
  assert.equal(config.demoApiKeys.get('demo-key-alice'), 'user-alice');
  assert.equal(loadConfig({}).appEnv, 'development');
});

test('reports invalid configuration with field names', () => {
  assert.throws(
    () => loadConfig({
      PORT: '70000',
      REDIS_URL: 'https://cache.example.com',
      USER_RATE_LIMIT: '0',
      DEMO_API_KEYS: '{not-json}',
    }),
    (error) => {
      assert.match(error.message, /Invalid environment configuration/);
      assert.match(error.message, /PORT/);
      assert.match(error.message, /REDIS_URL/);
      assert.match(error.message, /USER_RATE_LIMIT/);
      assert.match(error.message, /DEMO_API_KEYS/);
      return true;
    },
  );
});
