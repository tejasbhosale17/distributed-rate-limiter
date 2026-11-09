import { createClient } from 'redis';

export function createRedisClient({ url, logger }) {
  const client = createClient({ url });

  client.on('error', (error) => {
    logger.error({ err: error }, 'Redis client error');
  });

  return client;
}
