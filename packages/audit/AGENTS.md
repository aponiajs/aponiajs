# @aponiajs/audit — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The audit module, service, store contract, and bounded memory store. It is a
leaf: nothing in the framework depends on it.

| Domain     | Owns                                                 |
| ---------- | ---------------------------------------------------- |
| `module/`  | `AuditModule.register`, options, and event contracts |
| `service/` | `AuditService` and metadata redaction                |
| `store/`   | `AuditStore` and `MemoryAuditStore`                  |

`src/index.ts` is the only public barrel.

## Invariants

- **Events are immutable.** Copy, recursively redact, and freeze the metadata
  tree before returning; a nested object the caller still holds must not be able
  to change a stored event. Break cycles with `[circular]` and cap depth.
- **Redact by key, never by guessing at values.** The default pattern covers
  secret/token/password/authorization/api-key/cookie; extra keys are explicit.
- **The memory store is bounded.** A new event evicts the oldest insertion.
- **Recording is data, not authorization.** This package never mounts a route or
  decides who may read the events; a durable store and a reader are separate.
- **An empty action is a programming error.** Answer `INVALID_AUDIT_OPTIONS`.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. The Bun
lane covers redaction, freezing, ordering, eviction, clearing, and invalid bounds.
