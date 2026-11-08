# @aponiajs/tenancy — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The tenancy module, tenant service, tenant guard, and identifier policy. It is a
leaf: nothing in the framework depends on it.

| Domain     | Owns                                            |
| ---------- | ----------------------------------------------- |
| `module/`  | `TenantModule.register`, options, and constants |
| `guard/`   | `TenantGuard`                                   |
| `service/` | `TenantService` and the request-context token   |

`src/index.ts` is the only public barrel.

## Invariants

- **The tenant lives in the request context.** Use `RequestContextService`; do
  not hold a module-global tenant.
- **The default policy is required.** A missing tenant answers `400`; an
  application opts into optional tenancy explicitly.
- **Identifiers are validated before storage.** The default pattern rejects
  whitespace and control characters; a custom pattern is the application's
  declared policy.
- **The resolver runs before the header.** It may read an authenticated user
  claim, but must still return a value matching the pattern.
- **This package resolves an id, not a database scope.** Repository filters and
  connection selection belong to the data layer.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. The Bun
lane covers required/optional tenancy, invalid identifiers, resolver precedence,
and registration failures.
