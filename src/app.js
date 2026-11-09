import { randomUUID } from 'node:crypto';
import express from 'express';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createDemoApiKeyAuth, requireAuthentication } from './middleware/demo-api-key-auth.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { createRateLimitMiddleware } from './middleware/rate-limit.js';

export function createApp({
  logger = createLogger(),
  config = loadConfig(),
  limiter,
  instanceId = config.instanceId,
  trustProxyHops = config.trustProxyHops,
} = {}) {
  if (!limiter || typeof limiter.consume !== 'function') {
    throw new TypeError('A rate limiter implementation is required');
  }

  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops);
  app.locals.instanceId = instanceId;

  app.use((request, response, next) => {
    request.id = randomUUID();
    response.setHeader('X-Request-ID', request.id);
    response.setHeader('X-Instance-ID', instanceId);
    next();
  });
  app.use(express.json());

  app.get('/health/live', (request, response) => {
    response.json({
      status: 'ok',
      requestId: request.id,
      instanceId,
    });
  });

  app.use('/api', createDemoApiKeyAuth(config.demoApiKeys));

  app.get('/api/public', createRateLimitMiddleware({ limiter, config }), (request, response) => {
    response.json({
      message: 'Public API response',
      requestId: request.id,
      instanceId,
      ...(request.auth ? { userId: request.auth.userId } : {}),
    });
  });

  app.get(
    '/api/account',
    requireAuthentication,
    createRateLimitMiddleware({ limiter, config }),
    (request, response) => {
      response.json({
        message: 'Authenticated API response',
        userId: request.auth.userId,
        requestId: request.id,
        instanceId,
      });
    },
  );

  app.get(
    '/api/scoped',
    createRateLimitMiddleware({
      limiter,
      config,
      routePolicy: {
        name: 'scoped',
        scope: 'strict-route',
        ...config.rateLimits.scoped,
      },
    }),
    (request, response) => {
      response.json({
        message: 'Route-scoped API response',
        requestId: request.id,
        instanceId,
        ...(request.auth ? { userId: request.auth.userId } : {}),
      });
    },
  );

  app.use(createErrorHandler({ logger }));

  return app;
}
