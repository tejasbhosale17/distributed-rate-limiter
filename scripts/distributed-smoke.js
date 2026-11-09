import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const projectName = `rate-limit-smoke-${randomUUID().slice(0, 8)}`;
const limit = 12;
const requestCount = limit + 20;
const apiKey = randomBytes(24).toString('hex');
const userId = `smoke-user-${randomUUID()}`;
const spoofCredentials = Array.from({ length: requestCount }, () => ({
  apiKey: randomBytes(24).toString('hex'),
  userId: `spoof-user-${randomUUID()}`,
}));
const demoApiKeys = Object.fromEntries([
  [apiKey, userId],
  ...spoofCredentials.map(({ apiKey: key, userId: id }) => [key, id]),
]);
const composeArgs = ['compose', '--project-name', projectName];
const env = {
  ...process.env,
  APP_ENV: `distributed-${randomUUID()}`,
  IP_RATE_LIMIT: String(limit),
  IP_RATE_WINDOW_MS: '120000',
  USER_RATE_LIMIT: String(limit),
  USER_RATE_WINDOW_MS: '120000',
  DEMO_API_KEYS: JSON.stringify(demoApiKeys),
};

function compose(args) {
  execFileSync('docker', [...composeArgs, ...args], {
    env,
    stdio: 'inherit',
  });
}

async function waitForProxy() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:8080/health/live');
      if (response.ok) {
        return;
      }
    } catch {
      // The service may still be starting.
    }
    await delay(1000);
  }

  throw new Error('The Docker proxy did not become ready in 60 seconds');
}

try {
  compose(['up', '-d', '--build']);
  await waitForProxy();

  const responses = await Promise.all(
    Array.from({ length: requestCount }, () => fetch('http://127.0.0.1:8080/api/account', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })),
  );
  const statuses = responses.map(({ status }) => status);
  const admitted = statuses.filter((status) => status === 200).length;
  const rejected = statuses.filter((status) => status === 429).length;
  const instances = new Set(responses.map((response) => response.headers.get('x-instance-id')));

  if (admitted !== limit || rejected !== requestCount - limit || statuses.some((status) => status !== 200 && status !== 429)) {
    throw new Error(`Unexpected distributed results: ${JSON.stringify({ statuses, admitted, rejected })}`);
  }
  if (instances.size !== 2 || instances.has(null)) {
    throw new Error(`Expected traffic to reach both app instances; observed ${JSON.stringify([...instances])}`);
  }

  const spoofedResponses = await Promise.all(
    spoofCredentials.map(({ apiKey: key }, index) => fetch('http://127.0.0.1:8080/api/account', {
      headers: {
        Authorization: `Bearer ${key}`,
        'X-Forwarded-For': `198.51.100.${index + 1}`,
      },
    })),
  );
  const spoofedAdmissions = spoofedResponses.filter(({ status }) => status === 200).length;
  const spoofedRejections = spoofedResponses.filter(({ status }) => status === 429).length;
  if (spoofedAdmissions !== 0 || spoofedRejections !== requestCount) {
    throw new Error(`Proxy forwarding headers were not safely overwritten: ${JSON.stringify({ spoofedAdmissions, spoofedRejections })}`);
  }

  console.log(JSON.stringify({
    namespace: env.APP_ENV,
    offered: requestCount,
    admitted,
    rejected,
    spoofedForwardedRequestsRejected: spoofedRejections,
    instances: [...instances].sort(),
    windowMs: Number(env.USER_RATE_WINDOW_MS),
  }, null, 2));
} finally {
  compose(['down', '--volumes', '--remove-orphans']);
}
