import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const scriptUrl = new URL('../redis/scripts/sliding-window.lua', import.meta.url);
const script = await readFile(scriptUrl, 'utf8');

export function buildPolicyKey(appEnv, policy) {
  const identityHash = createHash('sha256')
    .update(`${policy.scope ?? 'global'}\0${policy.identity}`)
    .digest('hex');
  return `rate-limiter:${appEnv}:${policy.name}:${identityHash}`;
}

function validatePolicies(policies) {
  if (!Array.isArray(policies) || policies.length === 0) {
    throw new TypeError('At least one rate-limit policy is required');
  }

  const names = new Set();
  for (const policy of policies) {
    if (
      typeof policy.name !== 'string'
      || !/^[a-zA-Z0-9_-]+$/.test(policy.name)
      || typeof policy.identity !== 'string'
      || policy.identity.length === 0
      || !Number.isSafeInteger(policy.limit)
      || policy.limit < 1
      || !Number.isSafeInteger(policy.windowMs)
      || policy.windowMs < 1
      || (policy.scope !== undefined
        && (typeof policy.scope !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(policy.scope)))
  ) {
      throw new TypeError('Each policy requires a valid name, identity, positive limit, and positive windowMs');
    }

    if (names.has(policy.name)) {
      throw new TypeError(`Policy names must be unique within a request: ${policy.name}`);
    }
    names.add(policy.name);
  }
}

export async function createSlidingWindowLimiter({ redisClient, appEnv }) {
  if (!redisClient || typeof redisClient.evalSha !== 'function') {
    throw new TypeError('A connected Redis client is required');
  }
  if (typeof appEnv !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(appEnv)) {
    throw new TypeError('appEnv must contain only letters, numbers, underscores, or hyphens');
  }

  let scriptSha = await redisClient.scriptLoad(script);

  async function evaluate(keys, policyArgs, eventId) {
    try {
      return await redisClient.evalSha(scriptSha, {
        keys,
        arguments: [JSON.stringify(policyArgs), eventId],
      });
    } catch (error) {
      if (!error.message.startsWith('NOSCRIPT')) {
        throw error;
      }

      scriptSha = await redisClient.scriptLoad(script);
      return redisClient.evalSha(scriptSha, {
        keys,
        arguments: [JSON.stringify(policyArgs), eventId],
      });
    }
  }

  return {
    async consume(policies) {
      validatePolicies(policies);

      const keys = policies.map((policy) => buildPolicyKey(appEnv, policy));
      const policyArgs = policies.map(({ name, limit, windowMs }) => ({
        name,
        limit,
        windowMs,
      }));
      const result = await evaluate(keys, policyArgs, randomUUID());
      return JSON.parse(result);
    },
  };
}

export function retryAfterSeconds(retryAfterMs) {
  if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) {
    throw new RangeError('retryAfterMs must be a non-negative number');
  }
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}
