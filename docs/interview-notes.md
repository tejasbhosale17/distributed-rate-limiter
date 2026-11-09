# Interview notes

## Short project summary

This project demonstrates a horizontally scaled Express API that enforces shared sliding-window quotas through Redis. Two stateless app instances sit behind Nginx and use one Redis Lua script to check and record IP, authenticated-user, and route-specific policies atomically.

## Design choices to explain

### Why a sliding window?

A fixed window can allow nearly twice the configured quota around a boundary. This implementation keeps one timestamped sorted-set member per admitted request, giving exact rolling-window behavior at the cost of retaining event-level state until expiration.

### Why Lua in Redis?

Reading counts and writing admissions in separate client commands would allow concurrent app instances to over-admit. The script uses Redis server time, prunes expired events, checks every policy, and records the request in one atomic operation. Redis time also avoids clock skew between app containers.

### What happens when multiple policies apply?

The IP, user, and optional route policies are sent together. If any policy blocks, the script adds no new admission event to any policy. For a rejection, the client-facing retry duration accounts for the latest reset time among blockers.

### What are the failure tradeoffs?

Fail-closed returns 503 when Redis cannot decide, preserving quota enforcement at the expense of availability. Fail-open preserves request availability but explicitly bypasses quotas. A timed-out command may still have executed, so the app does not retry an uncertain admission.

### How is client identity protected?

The demo API-key adapter derives user IDs from a configured map rather than trusting a user-supplied identity header. The proxy overwrites forwarding headers and app trust is configured for the known proxy hop. Redis keys contain a digest rather than a raw identity, but the digest is not encryption.

## Tradeoffs and next production steps

- Sorted sets provide exact sliding windows but consume more Redis memory than approximate counters. Key expiry bounds inactive state; high request volume and high-cardinality identities still require capacity planning.
- All rate-limit state currently resides on one Redis primary. Redis Cluster key placement, failover behavior, and persistence guarantees need a separate design.
- Metrics are low-cardinality but in-memory and per-process; production monitoring should scrape each instance or export metrics to a shared telemetry system.
- Replace demo API-key authentication, configure managed secrets and TLS, restrict Redis network access, and define an explicit availability and recovery strategy before production use.

## How to demonstrate it

1. Start the Compose deployment and show liveness, readiness, and metrics.
2. Run `npm run test:distributed` to demonstrate one shared quota across both app instance IDs and the proxy's forwarding-header boundary.
3. Run `npm run test:failure` to show fail-closed, fail-open, bounded command waits, and recovery.
4. Run `npm run test:load` to report a repeatable workload configuration and environment-specific latency/throughput measurements.
