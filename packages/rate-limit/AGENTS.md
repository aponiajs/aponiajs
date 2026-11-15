# @aponiajs/rate-limit — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The rate-limit module, service, guard, route decorator, store contract, and the
bounded in-memory store. It is a leaf: nothing in the framework depends on it.

| Domain     | Owns                                                     |
| ---------- | -------------------------------------------------------- |
| `module/`  | `RateLimitModule.register`, tokens, and resolved options |
| `guard/`   | `RateLimitGuard` and `@RateLimit()`                      |
| `service/` | `RateLimitService` and the decision contract             |
| `store/`   | `RateLimitStore` and `MemoryRateLimitStore`              |

`src/index.ts` is the only public barrel.

## Invariants

- **The default key is the route identity.** Do not derive it from
  `X-Forwarded-For`, `X-Real-IP`, or any other client-supplied header. A trusted
  proxy is an application decision expressed through the `key` function.
- **The memory store is bounded.** `maxKeys` is required to be a positive
  integer; a new key evicts the oldest insertion. Do not add unbounded maps.
- **One token per request.** `RateLimitService.check` increments exactly once;
  the guard must not retry or increment again on refusal.
- **Refusals are `429` Problem Details.** Do not return `403` for an exhausted
  bucket. The guard sets the three `RateLimit-*` headers before it decides, and
  adds `Retry-After` on the refusal so the client knows the wait.
- **The store is trusted code.** A shared store is the deployment's
  responsibility; this package validates its own options only.
- **Configuration failures are `AponiaError` with `INVALID_RATE_LIMIT`.** Keep
  the code and the frozen issue list; tests assert both.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. The Bun
lane boots a real application through `AponiaFactory.create` and drives it
through `application.handle`; the memory store's clock is injectable, so no case
sleeps for a window.
