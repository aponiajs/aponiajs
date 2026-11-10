# @aponiajs/store-redis — Agent Guide

Read the [repository guide](../../AGENTS.md) and [RULES.md](../../RULES.md) first. This file covers only what is specific to this package.

## What this package owns

The Redis storage implementations for cache, rate-limit, session, idempotency, and auth token tracking.

| Domain    | Owns                                                 |
| --------- | ---------------------------------------------------- |
| `stores/` | Redis-backed stores implementing framework contracts |
| `common/` | Redis client interfaces and option normalization     |

`src/index.ts` is the only public barrel.
