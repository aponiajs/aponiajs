# @aponiajs/core — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The runtime that consumes descriptors: the module graph, visibility rules, and
the dependency injection container. It depends on `@aponiajs/common` only.

| Domain       | Owns                                                                  |
| ------------ | --------------------------------------------------------------------- |
| `graph/`     | Graph types, `ModuleGraph`, compilation, dependency and export checks |
| `container/` | `createContainer`, `AponiaContainer`, instance and controller caching |

`src/index.ts` is the only public barrel. Keep graph compilation separate from
graph lookup so each can evolve without turning one file into a second
container.

## Invariants

- This package never imports `reflect-metadata` or decorator logic. It sees
  frozen descriptors and nothing else, which is what keeps the hand-written
  descriptor API a first-class path.
- `compileModuleGraph` validates eagerly, before any instance exists: duplicate
  module identity, import cycles, duplicate tokens inside a module, provider
  entries that are not one of the four kinds, exports of tokens the module cannot
  resolve, unresolvable provider dependencies, and unresolvable controller
  dependencies. The shape check runs before any field of an entry is read, because
  a provider can arrive from JavaScript or from a build's descriptor artifact and
  every read below it assumes a provider. `getProviderDependencies` answers a
  kind it does not know with `INVALID_PROVIDER` rather than `undefined`, since it
  is exported for adapters that read a graph without building one.
- Modules are identified by `instanceId ?? id`. Two configured instances of one
  module class stay distinct through `instanceId`.
- `ModuleGraph.modules` holds every module reachable from the root through
  `imports`, once each, in post-order. It is the set a platform mounts, so a
  validation that must agree with mounting reads it instead of a compiler's
  working map.
- `ModuleGraph.locate` resolves the module's own providers first, then imports
  that **export** the token, then predefined providers as a final fallback. A provider
  left out of `exports` is invisible to importers, and two imports that resolve the token
  to different modules raise `AMBIGUOUS_PROVIDER` instead of picking a winner, while two
  that re-export one shared provider agree on it. Resolutions are memoized per module.
- `AponiaContainer` caches one instance per provider per module — singleton is
  the only scope that instantiates, and detects provider cycles during resolution.
  `"request"` and `"transient"` are reserved lifetimes a declaration can state;
  resolving one fails with `UNSUPPORTED_PROVIDER_SCOPE` from both the eager and
  lazy paths, and lifecycle collection skips scoped entries.
- `get()` enforces root-module visibility on purpose. `resolveModuleProvider()`
  is the platform SPI for resolving inside an arbitrary module and is not
  application API; keep it marked `@internal`.
- `getProviderDependencies()` is exported for the same reason: a platform adapter
  that describes a graph without building one must read the container's own
  dependency rule rather than restate it. It stays `@internal`.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. Assert on
`AponiaError.code`, never on message text.
