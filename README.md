# Distributed Rate Limiter

A Node.js and Express service for a Redis-backed distributed rate limiter. It includes validated configuration, an atomic exact sliding-window engine using Redis sorted sets and Lua, reusable Express middleware, and a demo API-key authentication adapter.

## Requirements

- Node.js 22.14 or newer (below 25)
- Docker Compose for the local Redis dependency, or a compatible Redis server

## Run locally

```powershell
npm ci
Copy-Item .env.example .env
docker compose up -d redis
npm start
```

The service listens on `http://localhost:3000`. Check liveness at `GET /health/live`. The service requires Redis to be available during startup.

## Demo API

The public route is limited by client IP. Authenticated requests are limited by both IP and stable user ID. `GET /api/scoped` adds a separate IP policy to demonstrate route-specific scopes.

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/api/public
Invoke-RestMethod http://localhost:3000/api/account -Headers @{ Authorization = 'Bearer demo-local-alice' }
Invoke-RestMethod http://localhost:3000/api/scoped
```

`DEMO_API_KEYS` is a JSON object mapping demo API keys to stable user IDs. Unknown or malformed bearer keys receive `401`; an `X-User-ID` header is never used for identity. Replace the illustrative key for local use and do not commit real credentials.

Rate-limited responses include `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds), `RateLimit-Window` (milliseconds), and `RateLimit-Policy`. For admitted requests the advertised policy is the lowest remaining-quota ratio, with reset time and name as tie-breakers. For rejected requests it is the blocking policy with the latest next-admission time. `Retry-After` is rounded up to seconds until all currently blocking policies can admit a request, assuming no intervening traffic. Quota is consumed at admission, regardless of the eventual route response status.

Client IPv4 addresses are kept as-is, IPv4-mapped IPv6 addresses are converted to IPv4, and IPv6 text is canonicalized without reducing addresses to a subnet. Forwarded addresses are ignored unless `TRUST_PROXY_HOPS` is explicitly configured for a trusted proxy topology.

## Development checks

```powershell
docker compose up -d redis
npm test
npm run lint
```

`npm test` includes real-Redis integration tests. The limiter currently targets a single shared Redis primary; Redis Cluster and automatic failover are not supported.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime environment |
| `PORT` | `3000` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP listen address |
| `LOG_LEVEL` | `info` | Structured log verbosity |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL (`redis://` or `rediss://`) |
| `APP_ENV` | `development` | Environment namespace for limiter keys |
| `INSTANCE_ID` | Hostname | Application instance identifier |
| `TRUST_PROXY_HOPS` | `0` | Number of trusted proxy hops; zero means client forwarding headers are not trusted |
| `IP_RATE_LIMIT` | `100` | Accepted requests per IP window |
| `IP_RATE_WINDOW_MS` | `60000` | IP sliding-window duration in milliseconds |
| `USER_RATE_LIMIT` | `20` | Accepted requests per authenticated user window |
| `USER_RATE_WINDOW_MS` | `60000` | User sliding-window duration in milliseconds |
| `SCOPED_RATE_LIMIT` | `5` | Additional accepted requests for `/api/scoped` |
| `SCOPED_RATE_WINDOW_MS` | `60000` | Route-specific sliding-window duration in milliseconds |
| `DEMO_API_KEYS` | `{}` | JSON map of API keys to stable user IDs |

`TRUST_PROXY_HOPS` is intentionally explicit. Do not increase it unless the service is only reachable through the corresponding trusted proxy topology.

## Project status

See [docs/progress.md](docs/progress.md) for the phase plan, completed checks, and known limitations.
