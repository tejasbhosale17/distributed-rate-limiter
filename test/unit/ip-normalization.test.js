import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeIpAddress } from '../../src/middleware/rate-limit.js';

test('normalizes equivalent IPv6 forms and IPv4-mapped IPv6 addresses', () => {
  assert.equal(normalizeIpAddress('2001:0db8:0:0:0:0:0:1'), '2001:db8::1');
  assert.equal(normalizeIpAddress('::ffff:192.0.2.10'), '192.0.2.10');
  assert.equal(normalizeIpAddress('192.0.2.10'), '192.0.2.10');
});

test('rejects invalid client IP strings', () => {
  assert.throws(
    () => normalizeIpAddress('not-an-ip'),
    (error) => error.status === 400 && error.code === 'INVALID_CLIENT_IP',
  );
});
