import { randomUUID } from 'node:crypto';
import express from 'express';
import { createLogger } from './logger.js';
import { createErrorHandler } from './middleware/error-handler.js';

export function createApp({
  logger = createLogger(),
  instanceId = 'local',
  trustProxyHops = 0,
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops);
  app.locals.instanceId = instanceId;

  app.use((request, response, next) => {
    request.id = randomUUID();
    response.setHeader('X-Request-ID', request.id);
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

  app.use(createErrorHandler({ logger }));

  return app;
}
