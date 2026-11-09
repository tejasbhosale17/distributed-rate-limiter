import { createClient } from 'redis';

export function createRedisClient({
  url,
  logger,
  connectTimeoutMs = 500,
  commandTimeoutMs = 250,
}) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 100,
    commandOptions: { timeout: commandTimeoutMs },
    socket: {
      connectTimeout: connectTimeoutMs,
      reconnectStrategy: (retries) => Math.min(50 * (2 ** Math.min(retries, 5)), 1_000),
    },
  });

  client.on('error', (error) => {
    logger.error({ err: error }, 'Redis client error');
  });

  return client;
}

export async function connectRedis(client, timeoutMs) {
  let timeout;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`Redis startup connection timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    await Promise.race([client.connect(), timeoutPromise]);
  } catch (error) {
    if (client.isOpen) {
      client.destroy();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
