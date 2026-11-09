import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';

test('liveness endpoint returns instance and request identifiers', async () => {
  const app = createApp({
    instanceId: 'test-instance',
    limiter: { consume: async () => ({ allowed: true, policies: [] }) },
    readinessCheck: async () => true,
  });
  const response = await request(app).get('/health/live');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.instanceId, 'test-instance');
  assert.equal(response.body.requestId, response.headers['x-request-id']);
  assert.match(response.body.requestId, /^[0-9a-f-]{36}$/);
});
