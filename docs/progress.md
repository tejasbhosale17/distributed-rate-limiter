# Implementation progress

## Phase plan

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Scaffold and configuration | Complete |
| 2 | Atomic Redis sliding-window engine | Complete |
| 3 | Express middleware and demo API | Complete |
| 4 | Distributed Docker demonstration | Complete |
| 5 | Failure handling and observability | Complete |
| 6 | Load testing and CI | Complete |
| 7 | Documentation and final verification | Pending |

## Phase 1 — Scaffold and configuration

### Completed

- Initial Express app/server split, validated environment configuration, JSON structured logger, Redis client module, and centralized error handler.
- Liveness endpoint with request and application instance identifiers.
- Local Redis Compose service, npm scripts, ESLint, and Node.js built-in test runner setup.

### Checks run

- `npm test` — 3 tests passed.
- `npm run lint` — passed.
- `npm audit` — 0 vulnerabilities after pinning the patched `minimatch` tree used by ESLint.
- Docker was initially unavailable; Docker Desktop became ready afterward and the Redis Compose service was started for Phase 2 validation.

### Known limitations

- No HTTP rate-limiting behavior or demo API routes are implemented yet.

## Phase 2 — Atomic Redis sliding-window engine

### Completed

- Implemented Redis-server-time sliding-window admission in one Lua script, checking all policies before recording any accepted request.
- Added hashed identity keys, unique UUID event members, inactive-key expiry, and one-time `NOSCRIPT` reload without retrying other command errors.
- Added real-Redis coverage for limits, rolling expiration, policy and identity isolation, unique events, atomic multi-policy admission, expiry, concurrency, and script-cache loss.

### Checks run

- `npm test` — 15 tests passed, including 9 real-Redis integration cases.
- `npm run lint` — passed.
- `npm audit` — 0 vulnerabilities.

### Known limitations

- The engine targets one shared Redis primary; Redis Cluster and automatic failover are not supported.
- HTTP middleware, authentication, and client-facing headers are not implemented yet.

### Next

- Integrate the engine as reusable Express middleware and add the demo API and authentication adapter.

## Phase 3 — Express middleware and demo API

### Completed

- Added IP- and user-based policies, an extra route-scoped IP policy, validated limits/windows, and canonical IP normalization.
- Added the demo bearer-key adapter; identities come only from the configured API-key map, never from `X-User-ID`.
- Added structured 429 responses, quota headers, `Retry-After`, and request/instance identifiers.

### Checks run

- `npm test` — 25 tests passed, including real-Redis and HTTP integration coverage.
- `npm run lint` — passed.
- `npm audit` — 0 vulnerabilities.
- Started the service against Compose Redis and verified `GET /health/live`.

### Known limitations

- The demo API-key adapter is not a substitute for production authentication.
- The Compose topology uses one primary Redis instance and no Redis Cluster/failover.

### Next

- Add a non-root application image, two shared-quota instances, Nginx proxy, and a cross-instance concurrency test.

## Phase 4 — Distributed Docker demonstration

### Completed

- Added a non-root Node image containing runtime dependencies and the Lua script.
- Added Redis, two app instances, and an Nginx proxy; app and Redis traffic is confined to the internal backend network.
- Configured Nginx to replace client-forwarding headers, with only the proxy port published on localhost.
- Added health checks, bounded graceful HTTP/Redis shutdown, and an isolated distributed smoke runner.

### Checks run

- `npm test` — 25 tests passed with local real Redis.
- `npm run lint` — passed.
- `npm audit` — 0 vulnerabilities.
- Both Compose configurations passed `docker compose config --quiet`.
- `npm run test:distributed` — passed: 32 concurrent requests yielded exactly 12 admitted and 20 rejected across `limiter-1` and `limiter-2`; 32 requests with spoofed forwarding headers were also rejected by the shared IP quota.
- Inspected the built image: runtime UID is `1000` (`node`) and the Lua script is present at `/app/src/redis/scripts/sliding-window.lua`.

### Known limitations

- The demo demonstrates a single Redis primary; failover, Redis Cluster, and production credential management remain out of scope.

### Next

- Add explicit Redis outage behavior, bounded command/connect handling, readiness, and low-cardinality metrics.

## Phase 5 — Failure handling and observability

### Completed

- Added configurable fail-closed (503) and fail-open (admit with an explicit bypass header) behavior for Redis decision failures.
- Bounded Redis connection startup and limiter-command waits, disabled offline command queuing, and capped reconnect delays. Timed-out admissions are not retried because Redis may already have executed them.
- Added Redis-aware readiness and low-cardinality decision, error, and latency metrics.
- Added Docker-backed outage, fail-mode, delayed-response, and recovery integration coverage.

### Checks run

- `npm test` — 34 tests passed, including 5 Redis failure/recovery cases.
- `npm run lint` — passed.
- `npm audit` — 0 vulnerabilities.
- Both base and test-overlay Compose configurations passed `docker compose config --quiet`.

### Known limitations

- Fail-open mode intentionally permits requests without a Redis quota decision during an outage.
- A timed-out Redis command may still have been applied; the client returns an unavailable response and does not retry the uncertain admission.
- Redis Cluster, automatic failover, and production credential management remain out of scope.

### Next

- Add reproducible load tests and GitHub Actions validation.

## Phase 6 — Load testing and CI

### Completed

- Added a configurable, bounded concurrent workload against an isolated two-instance Compose deployment; it reports throughput and latency percentiles and requires all requests to succeed.
- Added a GitHub Actions workflow for lint, dependency audit, Redis-backed tests, distributed verification, and the reproducible load test.

### Checks run

- `npm test` — 34 tests passed; the standalone load runner is intentionally excluded from test discovery.
- `npm run lint` — passed.
- `npm audit` — 0 vulnerabilities.
- Both Compose configurations passed `docker compose config --quiet`.
- `npm run test:distributed` — passed with 12 admitted, 20 rejected, and traffic reaching both app instances.
- `npm run test:load` — 500 requests at concurrency 50 all returned HTTP 200; measured 798.70 requests/second with p50 51.34 ms, p95 124.18 ms, and p99 157.60 ms. These measurements are environment-specific, not performance guarantees.
- Added `.github/workflows/ci.yml` to run lint, audit, the Redis-backed test suite, distributed verification, and the load test on pushes and pull requests.

### Next

- Complete architecture and operations documentation, then run final verification from a clean checkout.
