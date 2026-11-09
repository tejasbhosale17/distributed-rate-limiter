import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createRedisClient } from './redis/client.js';
import { createSlidingWindowLimiter } from './services/sliding-window-limiter.js';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
const redis = createRedisClient({ url: config.redisUrl, logger });

try {
  await redis.connect();
  const limiter = await createSlidingWindowLimiter({
    redisClient: redis,
    appEnv: config.appEnv,
  });
  const app = createApp({
    logger,
    config,
    limiter,
  });

  app.listen(config.port, config.host, () => {
    logger.info({
      host: config.host,
      port: config.port,
      instanceId: config.instanceId,
    }, 'Rate limiter service listening');
  });
} catch (error) {
  logger.fatal({ err: error }, 'Service startup failed');
  process.exitCode = 1;
  await redis.destroy();
}
