import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createRedisClient } from './redis/client.js';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
const redis = createRedisClient({ url: config.redisUrl, logger });

try {
  await redis.connect();
  const app = createApp({
    logger,
    instanceId: config.instanceId,
    trustProxyHops: config.trustProxyHops,
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
