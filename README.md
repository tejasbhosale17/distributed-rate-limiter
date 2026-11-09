# Distributed Rate Limiter

A Node.js and Express service scaffold for a Redis-backed distributed rate limiter. The implementation is built in phases; this initial phase provides validated configuration, service startup, structured logging, a Redis connection, a liveness endpoint, and local development tooling.

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

## Development checks

```powershell
npm test
npm run lint
```

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

`TRUST_PROXY_HOPS` is intentionally explicit. Do not increase it unless the service is only reachable through the corresponding trusted proxy topology.

## Project status

See [docs/progress.md](docs/progress.md) for the phase plan, completed checks, and known limitations.
