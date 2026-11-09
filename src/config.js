import os from 'node:os';
import { z } from 'zod';

const positiveLimit = z.coerce.number().int().min(1).max(1_000_000);
const positiveWindow = z.coerce.number().int().min(1).max(86_400_000);

function isValidDemoApiKeys(value) {
  try {
    const keys = JSON.parse(value);
    return keys !== null
      && typeof keys === 'object'
      && !Array.isArray(keys)
      && Object.entries(keys).every(([apiKey, userId]) => (
        apiKey.length >= 8
        && apiKey.length <= 256
        && !/\s/.test(apiKey)
        && typeof userId === 'string'
        && /^[a-zA-Z0-9._:-]{1,128}$/.test(userId)
      ));
  } catch {
    return false;
  }
}

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
  IP_RATE_LIMIT: positiveLimit.default(100),
  IP_RATE_WINDOW_MS: positiveWindow.default(60_000),
  USER_RATE_LIMIT: positiveLimit.default(20),
  USER_RATE_WINDOW_MS: positiveWindow.default(60_000),
  SCOPED_RATE_LIMIT: positiveLimit.default(5),
  SCOPED_RATE_WINDOW_MS: positiveWindow.default(60_000),
  DEMO_API_KEYS: z.preprocess(
    (value) => value === '' ? '{}' : value,
    z.string().default('{}').refine(
      isValidDemoApiKeys,
      'must be a JSON object mapping API keys (8-256 non-whitespace characters) to valid user IDs',
    ),
  ),
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
    rateLimits: {
      ip: { limit: result.data.IP_RATE_LIMIT, windowMs: result.data.IP_RATE_WINDOW_MS },
      user: { limit: result.data.USER_RATE_LIMIT, windowMs: result.data.USER_RATE_WINDOW_MS },
      scoped: {
        limit: result.data.SCOPED_RATE_LIMIT,
        windowMs: result.data.SCOPED_RATE_WINDOW_MS,
      },
    },
    demoApiKeys: new Map(Object.entries(JSON.parse(result.data.DEMO_API_KEYS))),
  };
}
