import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { connectRedis, createRedisClient } from './redis/client.js';
import { createSlidingWindowLimiter } from './services/sliding-window-limiter.js';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
const redis = createRedisClient({
  url: config.redisUrl,
  logger,
  connectTimeoutMs: config.redisConnectTimeoutMs,
  commandTimeoutMs: config.redisCommandTimeoutMs,
});

try {
  await connectRedis(redis, config.redisStartupTimeoutMs);
  const limiter = await createSlidingWindowLimiter({
    redisClient: redis,
    appEnv: config.appEnv,
    commandTimeoutMs: config.redisCommandTimeoutMs,
  });
  const app = createApp({
    logger,
    config,
    limiter,
    readinessCheck: () => redis.isReady,
  });

  const server = app.listen(config.port, config.host, () => {
    logger.info({
      host: config.host,
      port: config.port,
      instanceId: config.instanceId,
    }, 'Rate limiter service listening');
  });

  server.on('error', (error) => {
    logger.fatal({ err: error }, 'HTTP server failed');
    process.exitCode = 1;
    void redis.destroy();
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown started');

    const shutdownTimeout = setTimeout(() => {
      logger.error('Graceful shutdown timed out');
      server.closeAllConnections();
      void redis.destroy();
      process.exitCode = 1;
    }, 10_000);
    shutdownTimeout.unref();

    server.close(async (error) => {
      clearTimeout(shutdownTimeout);
      if (error) {
        logger.error({ err: error }, 'HTTP server shutdown failed');
        process.exitCode = 1;
      }

      try {
        if (redis.isOpen) {
          await redis.quit();
        }
      } catch (shutdownError) {
        logger.error({ err: shutdownError }, 'Redis shutdown failed');
        process.exitCode = 1;
        await redis.destroy();
      }

      logger.info('Graceful shutdown complete');
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
} catch (error) {
  logger.fatal({ err: error }, 'Service startup failed');
  process.exitCode = 1;
  await redis.destroy();
}
