# AponiaJS Maximum-Performance & Zero-Waste Execution Research

> **Status**: Completed research dossier (`/research`) aligned with the NestJS 1:1 DI & DX Parity roadmap ([`map.md`](./map.md)).
> **Primary sources**: Installed runtime/framework sources (`elysia@2.0.0-rc.4`, `typebox@1.4.6`, `hono@4.13.17`, `h3@2.0.8`, `rou3@1.0.0`), AponiaJS packages (`platform-elysia`, `platform-core`, `platform-hono`, `platform-h3`, `core`, `common`), official documentation (`bun.com`, `elysiajs.com`, `docs.nestjs.com`, `hono.dev`), and empirical benchmarks executed on `Bun v1.4.5` (`macOS arm64`).

---

## Executive Summary

AponiaJS already achieves strong steady-state soak throughput on its Elysia adapter (`1,253,899 req/s` in `bun scripts/benchmark.ts --soak`), and singleton DI resolution reaches `17,846,257 ops/s` in microbenchmarks. However, direct side-by-side instrumentation reveals massive, avoidable framework tax whenever routes move beyond trivial bare handlers or run on `platform-core` / `platform-hono` / `platform-h3`:

1. **Bare Elysia wrapper & hook tax (~48.6% lost vs raw Elysia bound method)**: `Raw Elysia (precompile + bound .bare())` runs at `4,598,847 ops/s`, whereas `Aponia Elysia NativeApp.handle GET /bare` runs at `2,813,731 ops/s` and `Aponia Elysia (precompile) GET /bare` drops further to `2,362,972 ops/s` (`-16.0%` solely from `AponiaApplication.handle()`'s wrapper).
2. **Async & per-request boxing waterfall on Elysia**: Adding one synchronous guard drops Aponia Elysia to `1,724,832 ops/s` (`-27.0%`); adding one synchronous interceptor drops it to `1,251,519 ops/s` (`-47.0%` vs Aponia bare, `-72.8%` vs raw Elysia bound); a piped `POST` without body validation drops to `751,538 ops/s` (`-30.5%` slower than validated `POST /json` at `1,081,705 ops/s`) because `route-handler-compiler.ts` wraps piped routes in an `async` closure passing the whole `context` to `extractParameterValue`, breaking `sucrose` static analysis; enabling `RequestContextModule` + `Scope.REQUEST` drops throughput to `681,446 ops/s` (`-71.2%` vs Aponia bare).
3. **`platform-hono` & `platform-h3` kernel tax (4.7x–4.9x slower than native)**: `Raw Hono GET /bare` reaches `2,182,016 ops/s` vs `Aponia Hono GET /bare` at `463,524 ops/s` (`-78.8%`); `Raw H3 GET /bare` reaches `2,908,808 ops/s` vs `Aponia H3 GET /bare` at `598,590 ops/s` (`-79.4%`). Eager context materialization (`headers`, `cookies`, `query`, `params`, `peerAddress`), `Object.freeze` per match, per-request guard/interceptor assembly, interpreted `rou3`, and double `Headers`/`Response` construction dominate runtime cost.
4. **TypeBox validation bottleneck (64.3x speedup available)**: `platform-core` uses interpreted `Convert`/`Parse` from `typebox/value` preceded by `structuredClone(value)` (`623,291 ops/s`), whereas `Compile(schema).Parse(value)` from `typebox/compile` runs at `40,074,796 ops/s` — **64.3x faster**.

Crucially, **delivering NestJS 1:1 DX parity ([`map.md`](./map.md)) does not require sacrificing any of these fast paths**, provided Aponia compiles enhancer/pipe/serializer/context requirements statically during bootstrap and preserves sync execution lanes on Bun.

---

## 1. Empirical Baselines (`Bun v1.4.5`, `macOS arm64`)

### 1.1 Repository Benchmark Suite (`bun scripts/benchmark.ts --soak`)

Executed directly against the unmodified repository:

```text
container.get (singleton)                    2093053 ops/s  (2000 iterations)
GET /bench/plain (guard + JSON)               575443 ops/s  (2000 iterations)
POST /bench/validated (body schema)           433714 ops/s  (2000 iterations)
POST /bench/piped (application pipe)          512782 ops/s  (2000 iterations)
soak 12538985 requests, 0 failures, 1253899 req/s, p50 0.0ms, p99 0.0ms
```

_(Note: [`scripts/benchmark.ts`](/Users/kittipong/orca/aponiajs/scripts/benchmark.ts) runs a single 2000-iteration cold/warm pass in its microbench cases before the HTTP soak loop.)_

### 1.2 Warm Isolated Hot-Path Probe (10,000 iterations, 500 warmup)

Measured in an isolated Bun harness reusing pre-constructed `Request` objects (50,000 iterations for DI and TypeBox microbenchmarks):

| Benchmark Case                                                     |          Throughput |   Total Time | Relative vs Baseline                        |
| ------------------------------------------------------------------ | ------------------: | -----------: | ------------------------------------------- |
| Raw Elysia (`precompile: true`, bound `instance.bare()`)           |     4,598,847 ops/s |      2.17 ms | 1.00x (reference ceiling)                   |
| Raw Elysia (`precompile: true`, `transform` + `error`)             |     4,397,054 ops/s |      2.27 ms | -4.4%                                       |
| Raw Elysia (`precompile: true`, `error` only)                      |     4,354,767 ops/s |      2.30 ms | -5.3%                                       |
| Raw Elysia (`precompile: true`, `async` fn)                        |     4,028,129 ops/s |      2.48 ms | -12.4%                                      |
| Raw Elysia (`precompile: true`, `transform` only)                  |     3,956,217 ops/s |      2.53 ms | -14.0%                                      |
| Raw Elysia (`precompile: true`, inline fn)                         |     3,712,353 ops/s |      2.69 ms | -19.3%                                      |
| Raw Elysia (`default`, inline fn)                                  |     2,804,852 ops/s |      3.57 ms | -39.0%                                      |
| **Aponia Elysia `NativeApp.handle` (`GET /bare`)**                 | **2,813,731 ops/s** |  **3.55 ms** | **-38.8% vs bound raw**                     |
| Aponia Elysia (`default`) `GET /bare`                              |     2,486,970 ops/s |      4.02 ms | -45.9%                                      |
| **Aponia Elysia (`precompile`) `GET /bare`**                       | **2,362,972 ops/s** |  **4.23 ms** | **-48.6% vs bound / -16.0% vs `NativeApp`** |
| Aponia Elysia (`precompile`) `GET /guarded` (sync guard)           |     1,724,832 ops/s |      5.80 ms | -27.0% vs Aponia bare                       |
| Aponia Elysia (`precompile`) `GET /intercepted` (sync interceptor) |     1,251,519 ops/s |      7.99 ms | -47.0% vs Aponia bare                       |
| Aponia Elysia (`precompile`) `POST /json` (TypeBox schema)         |     1,081,705 ops/s |      9.24 ms | -54.2% vs Aponia bare                       |
| Aponia Elysia (`precompile`) `POST /piped` (sync pipe, no schema)  |       751,538 ops/s |     13.31 ms | -68.2% vs Aponia bare                       |
| Aponia Elysia (`RequestContextModule` + `Scope.REQUEST`)           |       681,446 ops/s |     14.67 ms | -71.2% vs Aponia bare                       |
| Raw Hono `GET /bare`                                               |     2,182,016 ops/s |      4.58 ms | 1.00x (Hono ceiling)                        |
| **Aponia Hono `GET /bare`**                                        |   **463,524 ops/s** | **21.57 ms** | **4.71x slower (-78.8%)**                   |
| Raw H3 `GET /bare`                                                 |     2,908,808 ops/s |      3.44 ms | 1.00x (H3 ceiling)                          |
| **Aponia H3 `GET /bare`**                                          |   **598,590 ops/s** | **16.71 ms** | **4.86x slower (-79.4%)**                   |
| Aponia DI `container.get` (singleton, 50k iters)                   |    17,846,257 ops/s |      2.80 ms | ~56 ns/lookup                               |
| TypeBox 1.4.6 `Compile(schema).Parse` (no clone, 50k iters)        |    40,074,796 ops/s |      1.25 ms | **64.3x faster**                            |
| TypeBox 1.4.6 `Value.Parse(Convert(structuredClone))` (50k iters)  |       623,291 ops/s |     80.22 ms | Baseline (`platform-core`)                  |

_(Scope note: `.handle()`/`.fetch()` benchmarks isolate framework routing, hook dispatch, context materialization, and serialization overhead without TCP socket overhead; live `Bun.serve` additionally engages `collectNativeRoutes` native promotion described in Section 2.2.)_

---

## 2. Upstream Primary-Source Runtime Mechanics

### 2.1 Bun Runtime & JavaScriptCore (`bun.com`)

- **Native `Bun.serve({ routes })` zero-allocation dispatch**: Introduced in Bun v1.2.3+, passing pre-built `Response` objects directly in `Bun.serve.routes` lets Bun's Zig HTTP layer answer static routes with minimal-to-zero JS heap allocation, bypassing JS `fetch()` callbacks.
- **`AsyncLocalStorage` (`node:async_hooks`)**: Bun implements `AsyncLocalStorage` natively via async context frame tracking. Every active frame across microtasks/Promises carries non-trivial propagation overhead compared to passing an explicit reference or avoiding ALS entirely when unnecessary.
- **`Bun.hash`**: Uses Wyhash natively for non-cryptographic hashing at orders of magnitude higher speed than WebCrypto `crypto.subtle.digest` (which is async, returns a `Promise<ArrayBuffer>`, and runs OpenSSL/BoringSSL IPC/buffer allocation).
- **JSC inline caches & object shape churn**: Calling `Object.freeze(...)` on per-request objects (`params`, `headers`, `cookies`, `RouteMatch`) forces extra transition/property-attribute overhead on short-lived garbage-collected objects instead of keeping them tiny plain objects with monomorphic shapes.

### 2.2 Elysia `2.0.0-rc.4` Internals (`node_modules/elysia/src/`)

Direct inspection of Elysia 2.0.0-rc.4 reveals the exact conditions governing its JIT/AOT fast lanes:

- **`sucrose` static analysis (`sucrose.ts:406, 473`)**: Elysia scans handler and hook function source text to infer which request fields are actually read (`query`, `headers`, `body`, `cookie`, `set`). If a function passes the whole `context` variable into another helper (`extractParameterValue(context, ...)`, `runMiddlewareChain(context, ...)`), `sucrose` cannot statically bound property reads and falls back to `allAccessed`, eagerly materializing `query`, `headers`, `body`, and `cookie`.
- **`inlineBareRoute`, `syncFirst` / `tail`, and `responseMode` (`compile/handler/descriptor.ts:233-445`, `compile/handler/jit.ts:402, 1539`)**:
  - Adding **any** lifecycle hook (`transform`, `beforeHandle`, `afterHandle`) sets `hasLifecycleHook = true` and disqualifies `inlineBareRoute`.
  - Declaring `beforeHandle` or `afterHandle` as an `async` function sets `isAsync` / forces `tail = false`, switching Elysia out of its synchronous return lane into Promise continuation chains.
  - Adding **any** route `error` hook sets `hasErrorHook = true`, forces `inference.set = true`, and forces `responseMode = 'set'` instead of `'compact'`.
- **Fetch-level `onRequest` penalty (`handler/fetch.ts:656-757`)**: When `requestHooks` (any `.onRequest(...)`) is non-empty, Elysia allocates `const context = new Context(request)` and calls `materializeSetHeaders(context.set)` on **every incoming request before route matching even occurs**.
- **Bun static response promotion (`adapter/bun/index.ts:202-320`)**: `collectNativeRoutes` promotes non-function/static route values via `buildNativeStaticResponse` directly into `Bun.serve({ routes })`, **only when** `nativeStaticResponse !== false && !fetchLevelHook?.request?.length && !fetchLevelHook?.trace?.length && !frozenRoot['~ext']?.hoc?.length`. Registering a global `onRequest` hook or `wrap`/`hoc` disables this promotion across the entire server.
- **`precompile` (`elysiajs.com`)**: By default (`precompile: false`), Elysia lazily JIT-compiles a route on its first request; `precompile: true` compiles all routes during bootstrap so initial requests never hit JIT compilation latency.

### 2.3 TypeBox `1.4.6` (`node_modules/.bun/typebox@1.4.6/node_modules/typebox/`)

- Package exports provide `"./compile"` (`Compile`, `Validator`) alongside `"./value"` (`Convert`, `Parse`).
- [`compile.d.mts`](/Users/kittipong/orca/aponiajs/node_modules/.bun/typebox@1.4.6/node_modules/typebox/build/compile/compile.d.mts#L4-L6) and [`validator.d.mts`](/Users/kittipong/orca/aponiajs/node_modules/.bun/typebox@1.4.6/node_modules/typebox/build/compile/validator.d.mts#L3-L35) expose `Compile(schema)` returning a JIT-accelerated `Validator` with `.Check()`, `.Parse()`, `.Convert()`, `.Errors()`, and `.Decode()`.
- Our probe measured **`40,074,796 ops/s`** for `Compile(schema).Parse(value)` vs **`623,291 ops/s`** for `Value.Parse(Convert(structuredClone(value)))` (**64.3x faster**).

### 2.4 `rou3` `1.0.0`, `Hono` `4.13.17`, & `H3` `2.0.8`

- **`rou3` (`rou3/dist/compiler.mjs`)**: Ships `compileRouter(router)` (`rou3/compiler`), which compiles static lookup branches and radix-tree traversal into specialized JS functions via `new Function`, avoiding per-request tree-node walking in `findRoute`. Note lines `69-74` still `p.split("/")` only when falling through static match into dynamic segments.
- **Hono (`hono.dev`)**: Uses `SmartRouter` (`RegExpRouter` backed by `TrieRouter`), optimizing flat/shallow routing into a single compiled regex execution and bypassing async composition when handlers/middleware do not return Promises.
- **H3 v2 (`packages/platform-h3/node_modules/h3`)**: Built around lazy `H3Event`, `rou3`, and `srvx`, reading headers/query/params only when accessed (`2,908,808 ops/s` raw).

### 2.5 NestJS v11.1.6 (`docs.nestjs.com`)

- **Request-scope bubbling rule**: NestJS's official injection-scopes documentation warns that marking even one leaf provider `Scope.REQUEST` (or injecting `REQUEST`) causes scope to **bubble up** the dependency chain, forcing dependent services and controllers to re-instantiate on every single request. Even on `@nestjs/platform-fastify`, NestJS advises keeping default singleton scope on hot paths and reserving `Scope.REQUEST` strictly for genuine isolation requirements.

---

## 3. Verified Hot-Path Bottlenecks in AponiaJS

### 3.1 `@aponiajs/platform-elysia`

| #      | Bottleneck & Exact Location                                                                                                                                                                                                                                                                                                                      | Verified Behavior & Performance Cost                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1** | **Unconditional `transform` hook per route**<br>[`route-compiler.ts:283, 298-308`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/routing/route-compiler.ts#L283-L308)                                                                                                                                                              | `withRouteMemory(hook, mountPath)` injects `{ transform: record }` (`rememberMatchedRoute(context.request, mountPath)`) onto **every** decorated route unconditionally. Repository search confirms only 3 opt-in packages read `matchedRouteOf(request)` (`@aponiajs/metrics`, `@aponiajs/opentelemetry`, `@aponiajs/devtools`). Presence of `transform` disqualifies `inlineBareRoute`, prevents Elysia bare fast-pathing, and triggers per-request `WeakMap.set` writes. |
| **E2** | **Unconditional per-route `error` filter array**<br>[`application-bootstrap.ts:391-395`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/application/application-bootstrap.ts#L391-L395)                                                                                                                                             | Every route receives `defaultFilter` in its route `error` hook array so unhandled exceptions format as RFC 9457 Problem Details. On Elysia, any per-route `error` hook sets `hasErrorHook = true`, forcing `responseMode = 'set'` instead of `'compact'`.                                                                                                                                                                                                                  |
| **E3** | **`AponiaApplication.handle()` Promise check wrapper**<br>[`aponia-elysia-application.ts:325-332`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/application/aponia-elysia-application.ts#L325-L332)                                                                                                                               | Wraps `this.#nativeApplication.handle(request)` on every call, checking `typeof result.then === "function"` and attaching `.finally(() => this.#releaseRequest?.(request))` even when `#releaseRequest` is `undefined`. Empirically cuts bare route throughput by **-16.0%** (`2,362,972` vs `2,813,731 ops/s`).                                                                                                                                                           |
| **E4** | **Always-`async` `beforeHandle` / `afterHandle` + per-request `fork`**<br>[`route-hook.builder.ts:180, 215, 235-236`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/routing/route-hook.builder.ts#L180-L236)                                                                                                                       | `beforeHandle = async function` and `async afterHandle` are always `async` regardless of whether guards/interceptors are synchronous, forcing `tail = false` and Promise allocation on every guarded/intercepted route (`-27.0%` guarded, `-47.0%` intercepted). Also calls `execContext.fork(context)` inside both `beforeHandle` and `afterHandle`.                                                                                                                      |
| **E5** | **Piped routes force `async` + break `sucrose`**<br>[`route-handler-compiler.ts:164-167, 212-230`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/routing/route-handler-compiler.ts#L164-L230)                                                                                                                                      | Any route with `route.parameters.length > 0` and `(hasRouteOrParameterPipes                                                                                                                                                                                                                                                                                                                                                                                                |     | hasCustomParameters |     | globalPipes.length > 0)`falls back to`async (context: RouteContext)`calling`extractParameterValue(context, ...)`. Passing `context`into an external function forces`sucrose` to treat all fields (`query`, `headers`, `body`, `cookie`) as accessed (`allAccessed`), and forces async Promise boxing even for synchronous pipes — making `POST /piped` (`751,538 ops/s`) **30.5% slower** than schema-validated `POST /json` (`1,081,705 ops/s`). |
| **E6** | **Global `onRequest` / `onAfterResponse` poisoning Bun promotion**<br>[`application-bootstrap.ts:227-242`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/application/application-bootstrap.ts#L227-L242), [`static-assets.ts:25-37`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/routing/static-assets.ts#L25-L37) | Mounting `RequestContextModule` or static directories or Elysia middleware registers `.onRequest(...)` (plus `.onAfterResponse("global", ...)`). In Elysia `fetch.ts`, non-empty `requestHooks` forces eager `new Context(request)` + `materializeSetHeaders` before routing and disables `collectNativeRoutes` `promoteResponses`.                                                                                                                                        |
| **E7** | **`precompile` defaults to `false`**<br>[`application-bootstrap.ts:166-169`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/application/application-bootstrap.ts#L166-L169)                                                                                                                                                         | `new Elysia({ ...options.elysia, name })` leaves `precompile` unset unless opted in, causing cold first-hit JIT latency spikes on raw Elysia routes (`2.80M` default vs `3.71M` precompiled in un-warmed bursts).                                                                                                                                                                                                                                                          |

### 3.2 `@aponiajs/platform-core`, `@aponiajs/platform-hono`, & `@aponiajs/platform-h3`

These bottlenecks explain why `Aponia Hono` (`463,524 ops/s`) is **4.71x slower** than `Raw Hono` (`2,182,016 ops/s`) and `Aponia H3` (`598,590 ops/s`) is **4.86x slower** than `Raw H3` (`2,908,808 ops/s`):

| #      | Bottleneck & Exact Location                                                                                                                                                                                                                                                                                                                                         | Verified Behavior & Performance Cost                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | **Interpreted TypeBox validation + `structuredClone`**<br>[`validation.ts:8, 63-70`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/kernel/validation.ts#L8-L70)                                                                                                                                                                                         | Calls `structuredClone(value)` + interpreted `Convert` + `Parse` from `typebox/value` per validated slot (`623,291 ops/s`), **64.3x slower** than `Compile(schema).Parse(value)` (`40,074,796 ops/s`).                                                                                                                                                                                                                                                                                |
| **C2** | **Per-request execution context, guard unrolling, array cloning, & pipe resolution**<br>[`http-kernel.ts:176-216`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/kernel/http-kernel.ts#L176-L216), [`parameter-binding.ts`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/kernel/parameter-binding.ts)                                      | Every mounted request executes `new StaticRouteExecutionContext(instance, handler, { method, path }).fork(context)`, re-compiles `compileUnrolledGuards(mount.guards, executionContext, new HttpError(...).toResponse())` **per request**, copies `[...mount.interceptors].reverse()` per request, and resolves parameter pipes via `resolvePipe` inside `buildArguments` per parameter per request.                                                                                  |
| **C3** | **Eager context construction + double response allocation on Hono & H3**<br>[`hono-host.ts:273-300`](/Users/kittipong/orca/aponiajs/packages/platform-hono/src/host/hono-host.ts#L273-L300), [`h3-host.ts:218-264`](/Users/kittipong/orca/aponiajs/packages/platform-h3/src/host/h3-host.ts#L218-L264)                                                              | Always runs an `async` handler wrapper (defeating Hono/H3 sync single-handler bypasses), calls `createContextValues` eagerly (decoding/lowercasing/freezing query, headers, cookies, copying `{ ...context.req.param() }`, reading `peerAddress`), awaits `buildRouteResponse` (creating `new Response`), then calls `applySettings` (building another `Headers` + `new Response`). H3's `listen` also allocates `new URL(request.url).pathname` on every request (`h3-host.ts:250`). |
| **C4** | **Interpreted `rou3` router + `Object.freeze` per lookup**<br>[`route-matcher.ts:27-56`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/kernel/route-matcher.ts#L27-L56)                                                                                                                                                                                 | Uses interpreted `findRoute` from `"rou3"` instead of `compileRouter` from `"rou3/compiler"`, and on every match allocates `params = {}`, loops `Object.entries`, calls `Object.freeze(params)`, and freezes the returned `RouteMatch`.                                                                                                                                                                                                                                               |
| **C5** | **`async` `dispatch` + per-call `.bind` + per-request `reduceRight`**<br>[`http-bootstrap.ts:230-244`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/application/http-bootstrap.ts#L230-L244), [`request-pipeline.ts`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/application/request-pipeline.ts)                                       | `HttpBootstrapApplication.handle()` invokes `this.#host.fetch.bind(this.#host)` and allocates an `async` `dispatch` closure per request; `request-pipeline.ts` recomposes hook chains with `reduceRight` per request instead of compiling once at boot. Also note `http-bootstrap.ts:921-931` creates a `requestContext.run` closure per route when `requestContext` is registered.                                                                                                   |
| **C6** | **Async SHA-1 WebCrypto ETag + skipped dynamic compression threshold**<br>[`http.policy.ts:545-592`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/policy/http.policy.ts#L545-L592)                                                                                                                                                                     | ETag calculation calls `await response.clone().arrayBuffer()`, awaits `crypto.subtle.digest("SHA-1", bytes)`, and converts hex via `[...new Uint8Array(digest)].map(...).join("")`. Compression skips threshold checks whenever `response.headers.get("content-length")` is `null` (which applies to standard dynamic `new Response(...)` objects without explicit `Content-Length`).                                                                                                 |
| **C7** | **`RequestContextService` per-request allocation overhead**<br>[`request-context.module.ts:45-79`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/request-context/request-context.module.ts#L45-L79), [`request-context.service.ts:20-91`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/request-context/request-context.service.ts#L20-L91) | Every request generates `randomUUID()`, constructs `InMemoryRequestContext` + internal `Map`, inserts into two `WeakMap`s (`#contexts`, `#scopes`), constructs a `LifetimeScope`, echoes `x-request-id` into `set.headers`, and enters `AsyncLocalStorage.enterWith(...)`.                                                                                                                                                                                                            |

### 3.3 `@aponiajs/core` & `@aponiajs/common`

| #      | Bottleneck & Exact Location                                                                                                                                                                                                           | Verified Behavior & Performance Cost                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | **Async `ValidationPipe` + per-request metadata lookup + error freezes**<br>[`validation.pipe.ts:58-77, 111-150`](/Users/kittipong/orca/aponiajs/packages/common/src/pipes/validation.pipe.ts#L58-L150)                               | `ValidationPipe.transform` is always `async` (forcing Promise wrapping even when schemas/custom validators are sync), checks `getValidationMetadata` + `resolveRouteValidator` per request instead of caching by `metatype`, and freezes every validation error object on failure.                                                                                                    |
| **D2** | **Per-request `ClassSerializerInterceptor` metadata lookup & deep object rebuild**<br>[`class-serializer.interceptor.ts:27-59`](/Users/kittipong/orca/aponiajs/packages/common/src/enhancers/class-serializer.interceptor.ts#L27-L59) | Reads `getSerializeOptions` twice per response (`context.getHandler()`, `context.getClass()`), merges options `{ ...this.#options, ...declared }`, runs `Object.entries(value)` recursively, and checks `prefixes.some(...)` per key. With NestJS `@Exclude`/`@Expose`/`@Transform` (parity issue 06), uncompiled reflection here would become a major JSON serialization bottleneck. |
| **D3** | **DI runtime scope checks, `forwardRef` proxy resolution, & `Scope.REQUEST` bubbling**<br>[`container.ts`](/Users/kittipong/orca/aponiajs/packages/core/src/injector/container.ts)                                                    | Singletons resolve rapidly (`17.85M ops/s`), but `Scope.REQUEST` forks per-request container maps, re-instantiates request-scoped providers and bubbled controllers, and `forwardRef` proxy traps re-resolve/re-bind on property/method access rather than memoizing resolved targets after module initialization.                                                                    |

---

## 4. Architecture Blueprint: 1:1 NestJS Parity Without Losing Raw Speed

Every parity ticket in [`map.md`](./map.md) can be implemented using **compile-at-boot specialization** so unopted routes pay **zero cost**:

### 4.1 Tiered Elysia Route Compilation Matrix (Zero-Cost Abstractions)

Compile each route into the narrowest Elysia representation required by its resolved static flags:

1. **Tier 0 — Bare Static / Pass-Through Route**:
   - **Preconditions**: Zero guards, zero interceptors, zero pipes (including empty `globalPipes`), zero declared exception filters, no route observers (`hasRouteObservers === false`), no `Scope.REQUEST` dependency in controller tree, non-async handler.
   - **Action**:
     - Do **not** attach `withRouteMemory` (`transform` hook).
     - Move `defaultFilter` fallback from per-route `{ error: [defaultFilter] }` to an app-level `application.onError(...)` handler (preserving route-declared `@UseFilters` priority, while verifying Elysia `responseMode = 'compact'` vs `'set'` improvement in benchmark).
     - Emit a synchronous bound invoker `() => instance[method]()` (matching our `4,598,847 ops/s` raw Elysia bound-method ceiling).
     - Use native static promotion (`nativeStaticResponse`) when a descriptor route returns a literal `Response` and no global `onRequest` / `hoc` is installed.
2. **Tier 1 — Synchronous Pipeline (`tail`-preserving)**:
   - **Preconditions**: Route has guards (`CanActivate`), sync parameter/route pipes, or `interceptBefore`/`interceptAfter` interceptors, and **every** participant (guards, pipes, interceptors, handler) is statically known/detected synchronous (`ast-sync-analyzer.ts` + enhancer phase flags).
   - **Action**:
     - Compile **synchronous** `beforeHandle(context)` and **synchronous** `afterHandle(context)` instead of unconditional `async function` in [`route-hook.builder.ts`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/routing/route-hook.builder.ts).
     - Pre-allocate the route's base immutable metadata (`StaticRouteExecutionContext` skeleton) once at boot and allocate the lightweight request `ExecutionContext` **at most once** per request (reused across guards + pipes + interceptors via a single field update, never `.fork()`-ed twice in both `beforeHandle` and `afterHandle`).
     - Pre-build the constant `FORBIDDEN` response once at boot rather than `new HttpError("Forbidden", ...).toResponse()` on every request.
     - Inline direct property reads in generated route invokers (`context.query.page`, `context.body`, `context.params.id`) **before** applying synchronous pipe transforms so `sucrose` sees exact field reads instead of `allAccessed`, eliminating the `-30.5%` piped penalty.
3. **Tier 2 — Asynchronous / NestJS `CallHandler` (`NestInterceptor`)**:
   - **Preconditions**: At least one handler/guard/pipe is `async`, OR the route attaches an interceptor implementing Nest's `intercept(context, next: CallHandler)` (`map.md` interceptor parity).
   - **Action (Zero-RxJS `CallHandler` Fast Path)**:
     - Do **not** allocate an `Observable` wrapper per interceptor unless user code actually calls `.pipe(...)` on the `CallHandler` return value!
     - Implement `next.handle()` as a dual fast-path object: directly `PromiseLike` / thenable around the compiled index-stepping continuation `(index) => ...` so `return await next.handle()` triggers **zero** operator array or subscriber allocations; allocate the RxJS-compatible operator chain only lazily if `.pipe(...)` is called.
     - Keep routes **without** `intercept(ctx, next)` completely off this wrapper (`beforeHandle`/`afterHandle` Tier 1 instead).

### 4.2 Observer-Gated Route Memory (`withRouteMemory`)

- Add an internal boot capability check: `hasRouteObservers = hasInstalledPackage(@aponiajs/metrics | @aponiajs/opentelemetry | @aponiajs/devtools) || requestLifecycleHooks.length > 0`.
- Only attach `withRouteMemory` (`transform: record`) when `hasRouteObservers` is `true` — or even faster, when `@aponiajs/platform-elysia` wraps `onBeforeHandle` / handler dispatch for an observer, pass `mountPath` directly inside the compiled closure instead of a `WeakMap<Request, string>` lookup (`matchedRouteOf`).

### 4.3 Precompiled TypeBox `Compile`, Cached `ValidationPipe`, & Compiled `ClassSerializerInterceptor`

1. **`platform-core/src/kernel/validation.ts`**:
   - Replace `typebox/value` interpreted `Convert`/`Parse` + unconditional `structuredClone(value)` with a `WeakMap<object, CompiledValidatorEntry>` or boot-time precompiled `Compile(schema)` from `typebox/compile`:
     - Pre-check schema at compile time whether coercion/defaulting or codecs are present; when absent, run pure `validator.Parse(value)` (measured **64.3x faster**: `40.07M ops/s` vs `623k ops/s`) with zero `structuredClone`. When coercion is needed (`query`, `params`, `headers`), mutate only a shallow clone of the parsed record rather than deep `structuredClone` over nested objects when safe.
2. **`ValidationPipe`**:
   - Cache resolved validators (`WeakMap<Function, CachedValidator>`) so `transform()` avoids repeating `getValidationMetadata` + `resolveRouteValidator` per request, and return synchronously when `!isAsyncValidator` (only awaiting when a custom Standard Schema validator returns a thenable).
3. **`ClassSerializerInterceptor` (including Parity Issue 06 `@Exclude`/`@Expose`/`@Transform`)**:
   - Precompile a `WeakMap<Constructor, CompiledSerializerPlan>` storing:
     - Merged strategy (`EXCLUDE_ALL` vs `EXPOSE_ALL`), precomputed `Set` / exact key keep/drop masks, compiled `@Transform` callbacks, and nested DTO plan references.
     - Plain-object / array fast check: if a response is a plain DTO with `@Expose`/`@Exclude` metadata compiled into a specialized flat copier `(obj) => ({ id: obj.id, email: obj.email })`, zero `Reflect.getOwnMetadata`, zero `Object.entries`, and zero `prefixes.some(...)` loops run on hot responses.
     - Guard `Reflect.getMetadata` merge for `@SerializeOptions()` via a route/handler boot cache (`WeakMap<Function, SerializeOptions>`).

### 4.4 High-Speed `platform-core`, `platform-hono`, & `platform-h3` (Closing the 4.8x Gap)

1. **Compiled `rou3` matcher (`route-matcher.ts`)**:
   - Replace interpreted `findRoute` with `compileRouter` from `"rou3/compiler"`.
   - For static routes (no `:param` / `*`), return a shared frozen `EMPTY_ROUTE_MATCH` object per route built at boot time — eliminating `{}` + `Object.entries` + double `Object.freeze` per request.
2. **Lazy Context Materialization (`hono-host.ts`, `h3-host.ts`, `http-kernel.ts`)**:
   - Never eagerly construct normalized/frozen `headers`, `query`, `cookies`, `params`, or invoke `getConnInfo` unless the mounted route's `capabilities` list actually declares them (`@Headers`, `@Query`, `@Cookie`, `@Param`, `@Ip`, middleware, etc.) OR expose lazy memoized getters (`Object.defineProperty` on prototype class instance) so untouched fields cost **0 ns**.
   - Avoid `new URL(request.url).pathname` on hot paths where string slicing (`url.indexOf("/", url.indexOf("//") + 2)` to `?`) yields exact encoded pathname in 10x less time without full URL parser allocation (already standard in Hono/rou3 routers).
3. **Sync Dispatch + Single `Response` Construction (`http-bootstrap.ts`, `hono-host.ts`, `h3-host.ts`, `http-kernel.ts`)**:
   - Return `Response | Promise<Response>` synchronously from route handlers and `HttpBootstrapApplication.handle()`, binding `host.fetch` once in the constructor rather than `.bind` + `async` wrapper per call.
   - Pass headers/status cleanly into `buildResponse` once instead of building a `Response` in `buildResponse` and cloning/rebuilding `new Headers()` + `new Response()` in `applySettings`.
4. **Hoisted Policy & Pipeline Composition (`request-pipeline.ts`, `http.policy.ts`)**:
   - Compose `hooks` via `reduceRight` once at bootstrap (`createRequestPipeline` + `installHttpPolicies`), never per request.
   - Replace WebCrypto async `crypto.subtle.digest("SHA-1", ...)` + `.arrayBuffer()` copy in ETag with `Bun.hash` / `Bun.CryptoHasher` fast path when running under Bun (sync weak/strong ETag, zero Promise wrapping).
   - Enable configurable/optional threshold fast-check for `Uint8Array` / serialized string bodies where byte length is known prior to constructing `new Response`, avoiding the `content-length === null` blind spot in compression.

### 4.5 NestJS DI Parity Without `Scope.REQUEST` Regressions

1. **Bootstrap-only reflection (`DiscoveryService`, `MetadataScanner`, Property `@Inject()`)**:
   - Complete property-injection metadata scanning and enhancer auto-instantiation (`issues/02`) 100% during `compileRootModule` / `initializeModule`, storing pre-bound instantiation steps cleanly in `AponiaContainer` so hot-path `container.get()` keeps its `~17.85M ops/s` direct Map fast path.
2. **Memoize resolved `forwardRef` proxies after init**:
   - Once bootstrap finishes (`initializeModule` complete), replace or cache resolved target instances inside `forwardRef` proxies so runtime method calls pay at most a single cached property forward rather than re-running `#resolve` per call.
3. **Zero-Allocation Default for Requests Without `Scope.REQUEST` or `RequestContextModule`**:
   - Keep `RequestContextModule` and `Scope.REQUEST` strictly opt-in and **per-route / graph-scoped**:
     - If no module imports `RequestContextModule` and no controller transitively depends on a `Scope.REQUEST` provider, attach **zero** `onRequest` / `onAfterResponse` / `AsyncLocalStorage` hooks (saving the `-71.2%` drop measured in our probe and preserving `Bun.serve` native static promotion).
     - When `Scope.REQUEST` IS used, determine static reachability at graph compile time (just as Nest's `isRequestScoped` tree analysis tracks scope bubbling) and wrap **only routes/controllers that require request scope** rather than paying `onRequest` + eager Elysia `Context` materialization across static/singleton routes.
     - Inside `RequestContextModule`, skip `randomUUID()` generation unless `echo` is `true` OR `requestId` getter is actually read (lazy ID generation), and avoid constructing `LifetimeScope` unless `.scoped()` from `@aponiajs/compiler` is called.
4. **Lightweight `@Res()` / `HttpArgumentsHost.getResponse()` Facade**:
   - Construct the Express/Fastify-compatible response facade lazily only when `@Res()` or `ctx.switchToHttp().getResponse()` is invoked, backed directly by mutable `context.set` (`status`, `headers`) on Elysia/Hono/H3 rather than eager adapter wrappers on every route.

### 4.6 Precompilation & Startup Defaults

- Consider enabling `precompile: true` by default in `AponiaFactory.create` (or in `NODE_ENV=production` / documented production recipe) while exposing `precompile: false` as an explicit opt-out for constrained CLI/test boots.
- Remove `.then`/`.finally` wrapper overhead in `AponiaApplication.handle()` when `#releaseRequest === undefined` by keeping `#handleFast` vs `#handleWithRelease` branch assigned once in constructor.

---

## 5. Prioritized Optimization & Parity Verification Roadmap

| Priority | Change & Owner                                                                                                                                                                                                                   | Expected Impact                                                                                                                  | NestJS 1:1 Parity Alignment                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **P0**   | **TypeBox `Compile` JIT + remove `structuredClone` fast path** (`platform-core/src/kernel/validation.ts`, `common/.../validation.pipe.ts`)                                                                                       | **Up to 64x validation speedup** (`623k -> 40M ops/s` in TypeBox microbench)                                                     | Keeps Zod/Standard Schema + `ValidationPipe` (`issues/06`) fast under load                                     |
| **P0**   | **Sync fast paths & Tiered Elysia hooks** (`platform-elysia`: remove unconditional `withRouteMemory`, sync `beforeHandle`/`afterHandle`, direct property binding on piped sync routes, zero-overhead `AponiaApplication.handle`) | Reclaim **~48% lost Elysia bare throughput** (`2.36M -> ~4M+ ops/s`) + eliminate `-30.5%` pipe tax & `-47%` sync interceptor tax | Explicitly separates Tier 1 sync enhancers from Tier 2 zero-RxJS `NestInterceptor` `CallHandler` (`issues/05`) |
| **P0**   | **Pre-compile Hono/H3 context laziness + compiled `rou3` + single `Response`** (`platform-core`, `platform-hono`, `platform-h3`)                                                                                                 | Recover majority of the **4.7x–4.9x gap** on Hono (`463k -> 1.5M+`) & H3 (`598k -> 2M+`)                                         | Cleanly powers lazy `@Res()` / `HttpArgumentsHost.getResponse()` (`issues/04`) across all 3 platforms          |
| **P1**   | **Compiled `ClassSerializerInterceptor` plans** (`common/.../class-serializer.interceptor.ts`)                                                                                                                                   | Eliminates per-request metadata reads & `Object.entries` allocations on serialized JSON                                          | Makes `@Exclude`/`@Expose`/`@Transform` (`issues/06`) near-zero overhead                                       |
| **P1**   | **Scope `AsyncLocalStorage` / `Scope.REQUEST` per dependency subtree + lazy `RequestId`/`LifetimeScope`** (`platform-elysia`, `platform-core`)                                                                                   | Prevents `-71%` penalty bleeding onto singleton routes; preserves Bun static promotion                                           | Matches NestJS `Scope.REQUEST` bubbling rules without global `onRequest` sabotage (`issues/02, 03`)            |
| **P1**   | **Hoisted HTTP policy pipelines & `Bun.hash` ETag + sync compression sizing** (`platform-core/src/policy/http.policy.ts`, `request-pipeline.ts`)                                                                                 | Removes WebCrypto Promise boxing + redundant `reduceRight` per request                                                           | Zero-friction middleware, versioning, CORS, security headers (`issues/04, 07`)                                 |
| **P2**   | **Extended benchmark harness (`scripts/benchmark.ts`)**                                                                                                                                                                          | Tracks Raw vs Aponia ratios for Elysia/Hono/H3, guards/interceptors/pipes, TypeBox `Compile`, and `Scope.REQUEST` in CI          | Prevents performance regressions as Issues 01–10 land                                                          |

### Verification Plan (After Any Implementation PR)

1. Expand `scripts/benchmark.ts` (without breaking existing CI timings) with explicit Aponia-vs-Raw parity ratios for Elysia, Hono, H3, sync vs async interceptors, TypeBox `Compile`, and `RequestContextModule`.
2. Verify all mandatory repository gates defined in [`RULES.md`](/Users/kittipong/orca/aponiajs/RULES.md):
   - `bun run check`
   - `bun run test:coverage` (98% aggregate line, 95% function, 95% per-package line floor)
   - `bun run test:vite-plus`
   - `bun run test:examples`

---

## 6. Primary Sources Cited

- **Repository Benchmarks & Framework Source**:
  - [`scripts/benchmark.ts`](/Users/kittipong/orca/aponiajs/scripts/benchmark.ts)
  - [`packages/platform-elysia/src/routing/route-compiler.ts`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/routing/route-compiler.ts)
  - [`packages/platform-elysia/src/routing/route-handler-compiler.ts`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/routing/route-handler-compiler.ts)
  - [`packages/platform-elysia/src/routing/route-hook.builder.ts`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/routing/route-hook.builder.ts)
  - [`packages/platform-elysia/src/routing/ast-sync-analyzer.ts`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/routing/ast-sync-analyzer.ts)
  - [`packages/platform-elysia/src/routing/static-assets.ts`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/routing/static-assets.ts)
  - [`packages/platform-elysia/src/application/aponia-elysia-application.ts`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/application/aponia-elysia-application.ts)
  - [`packages/platform-elysia/src/application/application-bootstrap.ts`](/Users/kittipong/orca/aponiajs/packages/platform-elysia/src/application/application-bootstrap.ts)
  - [`packages/platform-core/src/kernel/http-kernel.ts`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/kernel/http-kernel.ts)
  - [`packages/platform-core/src/kernel/validation.ts`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/kernel/validation.ts)
  - [`packages/platform-core/src/kernel/route-matcher.ts`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/kernel/route-matcher.ts)
  - [`packages/platform-core/src/kernel/parameter-binding.ts`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/kernel/parameter-binding.ts)
  - [`packages/platform-core/src/application/http-bootstrap.ts`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/application/http-bootstrap.ts)
  - [`packages/platform-core/src/policy/http.policy.ts`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/policy/http.policy.ts)
  - [`packages/platform-core/src/request-context/request-context.module.ts`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/request-context/request-context.module.ts)
  - [`packages/platform-core/src/request-context/request-context.service.ts`](/Users/kittipong/orca/aponiajs/packages/platform-core/src/request-context/request-context.service.ts)
  - [`packages/platform-hono/src/host/hono-host.ts`](/Users/kittipong/orca/aponiajs/packages/platform-hono/src/host/hono-host.ts)
  - [`packages/platform-h3/src/host/h3-host.ts`](/Users/kittipong/orca/aponiajs/packages/platform-h3/src/host/h3-host.ts)
  - [`packages/common/src/pipes/validation.pipe.ts`](/Users/kittipong/orca/aponiajs/packages/common/src/pipes/validation.pipe.ts)
  - [`packages/common/src/enhancers/class-serializer.interceptor.ts`](/Users/kittipong/orca/aponiajs/packages/common/src/enhancers/class-serializer.interceptor.ts)
  - [`packages/core/src/injector/container.ts`](/Users/kittipong/orca/aponiajs/packages/core/src/injector/container.ts)
- **Installed Upstream Sources Inspected**:
  - `elysia@2.0.0-rc.4`: [`sucrose.ts`](/Users/kittipong/orca/aponiajs/node_modules/elysia/src/sucrose.ts), [`descriptor.ts`](/Users/kittipong/orca/aponiajs/node_modules/elysia/src/compile/handler/descriptor.ts), [`jit.ts`](/Users/kittipong/orca/aponiajs/node_modules/elysia/src/compile/handler/jit.ts), [`fetch.ts`](/Users/kittipong/orca/aponiajs/node_modules/elysia/src/handler/fetch.ts), [`adapter/bun/index.ts`](/Users/kittipong/orca/aponiajs/node_modules/elysia/src/adapter/bun/index.ts)
  - `typebox@1.4.6`: [`compile.d.mts`](/Users/kittipong/orca/aponiajs/node_modules/.bun/typebox@1.4.6/node_modules/typebox/build/compile/compile.d.mts), [`validator.d.mts`](/Users/kittipong/orca/aponiajs/node_modules/.bun/typebox@1.4.6/node_modules/typebox/build/compile/validator.d.mts)
  - `rou3@1.0.0`: [`compiler.mjs`](/Users/kittipong/orca/aponiajs/node_modules/.bun/rou3@1.0.0/node_modules/rou3/dist/compiler.mjs)
  - `h3@2.0.8` ([`package.json`](/Users/kittipong/orca/aponiajs/packages/platform-h3/node_modules/h3/package.json)) & `hono@4.13.17`
- **Official Upstream Documentation**:
  - Bun documentation & release notes (`bun.com`): `Bun.serve` native routes & static zero-allocation dispatch, `Bun.hash` (Wyhash), `AsyncLocalStorage` (`node:async_hooks`).
  - Elysia documentation (`elysiajs.com`): AOT compiler, `sucrose` static analysis, `precompile`, `nativeStaticResponse`.
  - Hono documentation (`hono.dev`): `RegExpRouter`, `SmartRouter` (`TrieRouter` fallback).
  - NestJS documentation (`docs.nestjs.com`, v11.1.6 baseline): Injection Scopes (`Scope.REQUEST` bubbling rule) and Fastify adapter performance guidance.
