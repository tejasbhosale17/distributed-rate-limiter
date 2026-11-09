# Implementation progress

## Phase plan

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Scaffold and configuration | Complete |
| 2 | Atomic Redis sliding-window engine | Complete |
| 3 | Express middleware and demo API | Complete |
| 4 | Distributed Docker demonstration | Pending |
| 5 | Failure handling and observability | Pending |
| 6 | Load testing and CI | Pending |
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
- The service still runs as one local process; the multi-instance Docker topology is the next phase.

### Next

- Add a non-root application image, two shared-quota instances, Nginx proxy, and a cross-instance concurrency test.
