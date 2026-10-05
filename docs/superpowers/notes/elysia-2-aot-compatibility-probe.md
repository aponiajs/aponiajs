# Elysia 2 Native AOT Compatibility Probe

Status: investigation complete.

## Summary

Elysia 2 (`2.0.0-beta.19`) removed the runtime `ElysiaConfig.aot` option in favor of `precompile: true | false`, while providing an opt-in build plugin at `elysia/plugin/aot/bun` and an import stub at `elysia/compiled`.

This probe measured and evaluated the behavior of native Elysia AOT alongside AponiaJS's build tooling (`aponia build`).

## Measured Evidence

Tested with an application containing:

- Decorated controllers with Standard Schema and TypeBox validation models.
- Parameter decorators (`@Body()`).
- Guards (`@UseGuards(Guard)`).
- Exception filters (`@UseFilters(Filter)`).
- Native Elysia plugins (`new Elysia().get('/plugin', ...)`).
- Low-level declared modules (`defineModule`, `defineControllerRoutes`).
- WebSocket gateways (`@WebSocketGateway('/ws')`, `@SubscribeMessage('echo')`).

### 1. Build and Bundle Metrics

| Metric           | Standard `Bun.build` | `elysia/plugin/aot/bun`                        |
| ---------------- | -------------------- | ---------------------------------------------- |
| Bundle size      | 1.205 MB             | 1.284 MB (+6.5%)                               |
| Build time       | ~15.6 ms             | ~47.0 ms                                       |
| Output artifacts | `plain.js`           | `plain.js` (includes frozen handler manifests) |

### 2. Build-Time Evaluation Side Effects

Elysia's `aot` plugin evaluates the entrypoint module at build time via `setupAotOnLoad` in order to extract and compile the native `Elysia` instance.

In an AponiaJS application whose entrypoint runs `await AponiaFactory.create(AppModule, ...)`:

- Provider constructors execute during `bun build`.
- `onModuleInit` lifecycle hooks execute during `bun build`.
- Gateway `afterInit` hooks execute during `bun build`.
- `onApplicationBootstrap` hooks execute during `bun build`.
- Environment variables (`process.env.*`) are read with build-time values and baked into closure captures.

For applications connecting to databases, initializing OpenTelemetry tracing, scheduling jobs, or listening on ports, running bootstrap during bundling would fail the build or capture ephemeral build-environment state.

### 3. Eval / Function Stripping

Even with Elysia's JIT stripping (`strip: 'auto'`), AponiaJS's own runtime fallback route compilation (`compileRouteHandler` in `packages/platform-elysia/src/routing/route-compiler.ts`) relies on `Function(...)` to generate high-performance argument invokers. Compiling with Elysia native AOT does not yield an eval-free bundle.

### 4. Behavioral Parity

Runtime request handling demonstrated complete behavioral parity across:

- Declared routes (`/declared` → 200).
- Plugin routes (`/plugin` → 200).
- Guard evaluation (`/decorated/guard` → 200).
- Filter mapping (`/decorated/filter` → 409).
- Standard Schema validation (valid → 200; invalid → 422 Problem Details).
- TypeBox validation (valid → 200; invalid → 422 Problem Details).
- Native WebSocket message exchange (`{"event":"echo","data":0}`).

## Decision Gate Outcome

**Retain the current Aponia build path (`aponia build` + standard `Bun.build`).**

Do not adopt `elysia/plugin/aot/bun` as the default build plugin for starter applications because build-time module evaluation risks unintended side-effects (database connections, unconfigured environment secrets, premature lifecycle triggers).

Native Elysia AOT remains an opt-in pattern that advanced users can configure when their application architecture guarantees pure build-time bootstrap.
