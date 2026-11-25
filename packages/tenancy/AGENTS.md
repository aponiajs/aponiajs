# @aponiajs/tenancy — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The tenancy module, tenant service, tenant guard, and identifier policy. It is a
leaf: nothing in the framework depends on it.

| Domain                                              | Owns                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `tenancy.module.ts`, `tenancy.module-definition.ts` | `TenantModule.forRoot`, the builder definition, options, and tokens |
| `tenant.guard.ts`                                   | `TenantGuard`                                                       |
| `tenant.service.ts`                                 | `TenantService` and the request-context token                       |
| `tenancy.constants.ts`, `tenant.constants.ts`       | Tokens and defaults                                                 |
| `interfaces/`                                       | The tenancy option and service contracts                            |

`src/index.ts` is the only public barrel. The registration is a
`ConfigurableModuleBuilder` definition with `MODULE_OPTIONS_TOKEN`
(`TENANCY_MODULE_OPTIONS`) and the `isGlobal` extra; `register`/`registerAsync`
remain as deprecated aliases.

## Invariants

- **The tenant lives in the request context.** Use `RequestContextService`; do
  not hold a module-global tenant.
- **`TenantModule` imports `RequestContextModule.forRoot()`.** The registration
  is shared per normalized header with `AuthModule`; do not add a second header.
- **The default policy is required.** A missing tenant answers `400`; an
  application opts into optional tenancy explicitly.
- **Identifiers are validated before storage.** The default pattern rejects
  whitespace and control characters; a custom pattern is the application's
  declared policy.
- **A tenant source is explicit.** A registration must provide a `resolver`, a
  `principal` token, or an explicit `header`; otherwise it fails with
  `INVALID_TENANCY_OPTIONS`. Resolution order is resolver → principal claim →
  header. The header is selection, not authorization, and is never read unless
  the registration opts in. A resolved value must still match the pattern.
- **This package resolves an id, not a database scope.** Repository filters and
  connection selection belong to the data layer.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. The Bun
lane covers required/optional tenancy, invalid identifiers, resolver precedence,
and registration failures.
