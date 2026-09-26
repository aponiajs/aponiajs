# Inspecting an Application

`inspectAponiaApplication` turns a root module into plain data describing what
bootstrap would mount: the module graph, every provider and its dependencies,
every route with its parameter bindings, and every WebSocket gateway.
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

## Resolving the graph the application boots from

An application that boots from the descriptor artifact `aponia build` writes
passes it to the factory. Inspection accepts the same artifact, so it reports the
graph that application serves instead of the decorated classes it named:

```ts
import { inspectAponiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";
import { moduleDescriptorArtifact } from "../src/descriptors.generated.ts";

const inspection = inspectAponiaApplication(AppModule, {
  descriptors: moduleDescriptorArtifact,
});

console.log(inspection.rootModule); // the id of the declared graph
```

The root is resolved through the same selector bootstrap uses, so which graph
serves the application and which graph an inspection describes cannot disagree.
An artifact this release refuses — one built by another release, one holding no
declaration for the root module's name, one whose entries are not module
descriptors — is never an error here either: the decorated module is inspected
instead, exactly as bootstrap lowers it, and the `logger` option receives the one
line reporting which of the two was chosen. The options also accept the
`invokers` artifact for symmetry with the factory options; an invoker artifact
binds handlers rather than declaring the graph, so it changes nothing an
inspection reports.

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
