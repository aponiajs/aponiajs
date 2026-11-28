# @aponiajs/core — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The runtime that consumes descriptors: the module graph, visibility rules, and
the dependency injection container. It depends on `@aponiajs/common` only.

| Domain         | Owns                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| `scanner/`     | `ModuleGraph`, graph compilation, dependency checks, and diagnostics   |
| `injector/`    | `createContainer`, `AponiaContainer`, instance and controller caching  |
| `hooks/`       | The request-context strategy the container and platforms share         |
| `interfaces/`  | The type-only graph contract                                           |
| `constants.ts` | The `APP_*` pseudo-provider tokens re-exported from `@aponiajs/common` |

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
  module class stay distinct through `instanceId`; the platform mints one stable
  symbol per decorated class, so two classes that share a name are also distinct.
- `ModuleGraph.modules` holds every module reachable from the root through
  `imports`, once each, in post-order. It is the set a platform mounts, so a
  validation that must agree with mounting reads it instead of a compiler's
  working map.
- `ModuleGraph.locate` resolves the module's own providers first, then imports
  that **export** the token, then predefined providers as a final fallback. A provider
  left out of `exports` is invisible to importers, and two imports that resolve the token
  to different modules raise `AMBIGUOUS_PROVIDER` instead of picking a winner, while two
  that re-export one shared provider agree on it. Resolutions are memoized per module.
- `AponiaContainer` manages singleton, request, and transient lifetimes:
  singleton caches per module, request caches per active request context, and
  transient instantiates fresh on each resolution. Provider and controller cycles
  are detected during resolution, with cyclic dependencies declared via
  `forwardRef` resolved transparently via lazy proxies. Request scope bubbles
  outward along the injection chain: a provider or controller that reaches a
  request-scoped dependency is instantiated per request whatever it declares,
  and a request-scoped controller is constructed once per request context.
- An optional dependency resolves to `undefined` only when the graph answers
  `MISSING_PROVIDER`; an ambiguous optional dependency still fails. The
  container treats `ModuleRef`, `REQUEST`, `CONTEXT`, and `INQUIRER` as
  predefined tokens. `REQUEST` answers the active request, `CONTEXT` the active
  context, and `INQUIRER` a lazy reference to the provider that asked for the
  dependency. `ModuleRef` is bound to the module that received it, never to the
  root unless that module is the root. `ModuleRef.get` takes
  `{ strict?: boolean; each?: boolean }`; `strict: false` resolves from the
  whole graph, and `each` returns every instance. `resolve` creates a fresh
  sub-tree unless a context id is passed, and `create` instantiates without
  caching. `registerRequestByContextId` records the request `REQUEST` answers
  under that id. The platform SPI behind `create` is `createInModule`, marked
  `@internal`.
- `ContextIdFactory` owns context ids: `create`, `getByRequest` (reading the
  `REQUEST_CONTEXT_ID` property and `raw` by default), and `apply` for a
  `ContextIdStrategy`. A durable provider caches under the parent id the
  strategy returns for it, so two requests mapped to one parent share its
  instance. `ModuleGraph.lifecycleModules` is the one distance ordering: deepest
  imports and globals first, root last.
- `ModuleGraph.providersFor` keeps every provider declared under one token,
  because the four `APP_*` tokens are exempt from the duplicate-token rule and a
  module may declare the same one more than once. `container.resolveProvider`
  resolves one record directly; token lookup alone remains for ordinary
  providers.
- `get()` enforces root-module visibility on purpose. `resolveModuleProvider()`
  is the platform SPI for resolving inside an arbitrary module and is not
  application API; keep it marked `@internal`.
- `getProviderDependencies()` is exported for the same reason: a platform adapter
  that describes a graph without building one must read the container's own
  dependency rule rather than restate it. It stays `@internal`.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. Assert on
`AponiaError.code`, never on message text.
