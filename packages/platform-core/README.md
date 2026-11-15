# @aponiajs/platform-core

> The runtime-neutral HTTP platform primitives AponiaJS builds every HTTP
> platform on: the request execution context, the compiled guard pipeline,
> pipe resolution, and the middleware consumer contract.

This package is a building block, not an application entry point. An
application imports a platform (`@aponiajs/platform-elysia`,
`@aponiajs/platform-hono`, `@aponiajs/platform-h3`), and that platform imports
these primitives. Use it directly only when you are writing a platform.

## Use it

```ts
import {
  StaticRouteExecutionContext,
  compileUnrolledGuards,
  executePipes,
  resolvePipe,
} from "@aponiajs/platform-core";
```

- `StaticRouteExecutionContext` — a route's immutable identity plus one
  request's context. Compile one prototype per route and `fork(context)` per
  request.
- `compileUnrolledGuards(guards, executionContext, defaultResponse)` — the
  guard list as one ordered pipeline; `compileGuardsHook` is its alias.
- `resolvePipe`, `resolveApplicationPipe`, `resolveApplicationPipes`,
  `executePipes` — pipe resolution against the container and execution.
- `HttpError`, `httpErrors`, and the neutral status-name map — the same
  RFC 9457 failure contract every platform answers with.
- `createMiddlewareConsumer` — the consumer a module uses to declare
  middleware targets and exclusions.
- `selectRootModuleDescriptor` and `selectInvokerArtifact` — the build artifacts
  an application boots from, and the release check each is held to.
- `compileRootModule` — lowers a decorated root into the descriptor the graph
  compiles. A platform supplies `compileController` and `assertRoutes`, the two
  halves only it can state; without them a controller lowers to a neutral
  descriptor and no route check runs.
- `normalizeRoutePrefix`, `stripRoutePrefix`, and the `RoutePlan`,
  `AponiaRootModule`, `RouteHandler`, and `ControllerHandlerFactory` types.

## What a platform can rely on

- No HTTP runtime is imported here; the primitives work with `RouteContext`.
- A route-level pipe with no dependencies resolves without a container; an
  application-level pipe resolves through the root module and fails loudly with
  `MISSING_PROVIDER` when the graph cannot reach it.
- The execution context is forked per request, so concurrent requests never
  share mutable state.
- Run order is fixed: middleware, guards and interceptor before halves, the
  handler, interceptor after halves reversed, filters most-specific-first.
