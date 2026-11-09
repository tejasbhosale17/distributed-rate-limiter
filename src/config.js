import os from 'node:os';
import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REDIS_URL: z.string().url().refine(
    (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
    'must use redis:// or rediss://',
  ).default('redis://localhost:6379'),
  APP_ENV: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('development'),
  INSTANCE_ID: z.string().min(1).default(os.hostname()),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
});

export function loadConfig(env = process.env) {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    const details = result.error.issues
      .map(({ path, message }) => `- ${path.join('.')}: ${message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    host: result.data.HOST,
    logLevel: result.data.LOG_LEVEL,
    redisUrl: result.data.REDIS_URL,
    appEnv: result.data.APP_ENV,
    instanceId: result.data.INSTANCE_ID,
    trustProxyHops: result.data.TRUST_PROXY_HOPS,
  };
}
