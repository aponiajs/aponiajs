# @aponiajs/core — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The runtime that consumes descriptors: the module graph, visibility rules, and
the dependency injection container. It depends on `@aponiajs/common` only.

| File           | Owns                                                             |
| -------------- | ---------------------------------------------------------------- |
| `graph.ts`     | `compileModuleGraph`, `ModuleGraph`, all compile-time validation |
| `container.ts` | `createContainer`, `AponiaContainer`, instance caching           |

## Invariants

- This package never imports `reflect-metadata` or decorator logic. It sees
  frozen descriptors and nothing else, which is what keeps the hand-written
  descriptor API a first-class path.
- `compileModuleGraph` validates eagerly, before any instance exists: duplicate
  module identity, import cycles, duplicate tokens inside a module, exports of
  tokens the module cannot resolve, unresolvable provider dependencies, and
  unresolvable controller dependencies.
- Modules are identified by `instanceId ?? id`. Two configured instances of one
  module class stay distinct through `instanceId`.
- `ModuleGraph.locate` resolves the module's own providers first, then imports
  that **export** the token. A provider left out of `exports` is invisible to
  importers, and two imports exporting the same token raise
  `AMBIGUOUS_PROVIDER` instead of picking a winner. Resolutions are memoized per
  module.
- `AponiaContainer` caches one instance per provider per module — singleton is
  the only scope — and detects provider cycles during resolution.
- `get()` enforces root-module visibility on purpose. `resolveModuleProvider()`
  is the platform SPI for resolving inside an arbitrary module and is not
  application API; keep it marked `@internal`.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. Assert on
`AponiaError.code`, never on message text.
