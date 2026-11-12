# @aponiajs/store-redis — Agent Guide

Read the [repository guide](../../AGENTS.md) and [RULES.md](../../RULES.md) first. This file covers only what is specific to this package.

## What this package owns

The Redis storage implementations for cache, rate-limit, session, idempotency, and auth token tracking.

| Domain    | Owns                                                 |
| --------- | ---------------------------------------------------- |
| `stores/` | Redis-backed stores implementing framework contracts |
| `common/` | Redis client interfaces and option normalization     |

`src/index.ts` is the only public barrel.

## Invariants

- `clear()` and family cleanup page with `SCAN` and delete with `UNLINK`; the
  client interface declares both as optional, and `KEYS`/`DEL` is only the
  fallback for a minimal client. Never call `KEYS` on a path a shared instance
  can hit when `scan` is available.
- `RedisRateLimitStore` derives `resetAt` from the live `PTTL`; it must not
  return `Date.now() + windowMs`, which slides the header forward on every hit.
- `RedisIdempotencyStore` claims with `SET NX PX` and releases with `DEL`.
- `RedisRefreshTokenStore.consume` is one Lua round trip: read, delete, and keep
  a family tombstone so a replay revokes the family.
