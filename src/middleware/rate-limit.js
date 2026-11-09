import ipaddr from 'ipaddr.js';
import { performance } from 'node:perf_hooks';
import { retryAfterSeconds } from '../services/sliding-window-limiter.js';

export function normalizeIpAddress(address) {
  try {
    const parsed = ipaddr.parse(address);
    return parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()
      ? parsed.toIPv4Address().toString()
      : parsed.toString();
  } catch {
    const error = new TypeError('The client IP address is invalid');
    error.status = 400;
    error.code = 'INVALID_CLIENT_IP';
    throw error;
  }
}

function selectHeaderPolicy(result) {
  const candidates = result.allowed
    ? result.policies
    : result.policies.filter((policy) => policy.blocked);

  return candidates.toSorted((left, right) => {
    if (!result.allowed && left.resetAtMs !== right.resetAtMs) {
      return right.resetAtMs - left.resetAtMs;
    }

    const leftRatio = left.remaining / left.limit;
    const rightRatio = right.remaining / right.limit;
    return leftRatio - rightRatio
      || left.resetAtMs - right.resetAtMs
      || left.name.localeCompare(right.name);
  })[0];
}

function setRateLimitHeaders(response, result, selectedPolicy) {
  const resetSeconds = Math.max(0, Math.ceil((selectedPolicy.resetAtMs - result.nowMs) / 1000));

  response.setHeader('RateLimit-Limit', selectedPolicy.limit);
  response.setHeader('RateLimit-Remaining', selectedPolicy.remaining);
  response.setHeader('RateLimit-Reset', resetSeconds);
  response.setHeader('RateLimit-Window', `${selectedPolicy.windowMs}ms`);
  response.setHeader('RateLimit-Policy', selectedPolicy.name);
}

export function createRateLimitMiddleware({
  limiter,
  config,
  metrics,
  logger,
  routePolicy,
}) {
  return async (request, response, next) => {
    const clientIp = normalizeIpAddress(request.ip);
    const policies = [
      {
        name: 'ip',
        scope: 'global',
        identity: clientIp,
        ...config.rateLimits.ip,
      },
    ];

    if (request.auth) {
      policies.push({
        name: 'user',
        scope: 'global',
        identity: request.auth.userId,
        ...config.rateLimits.user,
      });
    }

    if (routePolicy) {
      policies.push({
        ...routePolicy,
        identity: clientIp,
      });
    }

    const startedAt = performance.now();
    let result;
    try {
      result = await limiter.consume(policies);
    } catch (error) {
      const durationMs = performance.now() - startedAt;
      const failOpen = config.redisFailureMode === 'open';
      metrics.recordDecision(failOpen ? 'bypassed' : 'errored', durationMs, { error: true });
      logger.error({
        err: error,
        requestId: request.id,
        failureMode: config.redisFailureMode,
      }, 'Rate limiter decision failed');

      if (failOpen) {
        response.setHeader('X-Rate-Limit-Bypassed', 'true');
        next();
        return;
      }

      response.status(503).json({
        error: {
          code: 'RATE_LIMITER_UNAVAILABLE',
          message: 'Rate limiting is temporarily unavailable',
        },
        requestId: request.id,
        instanceId: request.app.locals.instanceId,
      });
      return;
    }

    metrics.recordDecision(result.allowed ? 'allowed' : 'rejected', performance.now() - startedAt);
    const selectedPolicy = selectHeaderPolicy(result);
    setRateLimitHeaders(response, result, selectedPolicy);

    if (!result.allowed) {
      const retryAfter = retryAfterSeconds(result.retryAfterMs);
      response.setHeader('Retry-After', retryAfter);
      response.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Request quota exceeded',
        },
        requestId: request.id,
        instanceId: request.app.locals.instanceId,
        retryAfterSeconds: retryAfter,
        policy: selectedPolicy.name,
      });
      return;
    }

    next();
  };
}
