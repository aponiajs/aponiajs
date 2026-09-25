# Inspecting an Application

`inspectAponiaApplication` turns a root module into plain data describing what
bootstrap would mount: the module graph, every provider and its dependencies,
every decorated route with its parameter bindings, and every WebSocket gateway.
It is the read model behind build tooling, editor helpers, and anything that
needs to reason about an application without running it.

```ts
import { inspectAponiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

const inspection = inspectAponiaApplication(AppModule);

console.log(inspection.modules.map((module) => module.id));
console.log(inspection.routes.map((route) => `${route.method} ${route.path}`));
```

## In a generated application

An application created by `aponia new` already ships this as a script:

```bash
bun run inspect          # a readable summary of modules, routes, and gateways
bun run inspect --json   # the whole inspection, for tooling
```

## What it returns

```ts
interface AponiaApplicationInspection {
  readonly rootModule: string;
  readonly modules: readonly AponiaModuleInspection[];
  readonly routes: readonly AponiaRouteInspection[];
  readonly gateways: readonly AponiaGatewayInspection[];
}
```

Each module carries its `id`, the configured `instanceId` of a dynamic module,
the ids of its imports, the names of its controllers, its providers with the
token names they depend on, and the token names it exports.

Each route carries its `method`, mounted `path`, owning `module` and
`controller`, the handler's name, and the request parameters that handler binds
— each with the parameter index, the binding kind, and the optional property
name a decorator selected.

## What it guarantees

- **No instances are constructed.** Inspecting compiles the graph; it never
  calls a provider factory, a class constructor, or a controller constructor, so
  it is safe to run against an application whose providers open connections.
- **The result is frozen**, including nested arrays and objects.
- **The result is JSON-serializable.** No functions, no class instances, no
  validators, no raw symbols. Module identity that is a symbol and handler keys
  that are symbols are projected with `String(...)`, so a symbol-keyed handler
  reads as `Symbol(description)`.
- **The order is deterministic** and independent of declaration order: modules
  stay in graph order, so every import precedes the module importing it; routes
  sort by path, then method, controller, handler, and module; gateways sort by
  canonical path while their events keep subscription order.

Two inspections of the same root module are deeply equal.

## What it does not include

Routes contributed by `elysiaController` and `defineElysiaController` callbacks
are absent. Those callbacks receive a real Elysia instance and build their
routes from it, so producing them would mean constructing a controller and
running the callback — which is exactly what inspecting avoids. Such a
controller still appears in its module's `controllers`.

For the complete mounted route table, build the application and read the native
instance:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

const application = await AponiaFactory.create(AppModule, { logger: false });
const mounted = application
  .getNativeApplication()
  .routes.map((route) => `${route.method} ${route.path}`);

console.log(mounted);
await application.close();
```

This runs your application's own code, including provider factories, so it is
not a substitute for inspecting. Use inspection for structure and this for the
full native route table.

## Failures

Inspection raises the same `AponiaError` codes bootstrap would raise for the same
defect, because it compiles through the same path: `MODULE_CYCLE`,
`INVALID_MODULE`, `AMBIGUOUS_PROVIDER`, `DUPLICATE_WEBSOCKET_GATEWAY`,
`UNSUPPORTED_CONTROLLER`, and the rest of the closed union in
[`dependency-injection.md`](dependency-injection.md).
