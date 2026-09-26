# Aponia DevTools — design

## Why this exists

Aponia lowers decorated classes into descriptors, and `aponia build` emits two
artifacts that replace work the runtime would otherwise do: literal route
invokers, and the module graph as data. Both are refusable by design — a
declined handler, a refused artifact, or a stale file silently costs the
optimization it was meant to remove and nothing else.

That silence is the problem this package addresses. Today the only report is a
startup log line and a `DECLINED` line printed by `aponia build`. Nothing
carries the answer to "which graph is serving this application, which handlers
are still on the compiled path, and why" to a tool a developer can look at.

NestJS DevTools solves the equivalent problem for Nest by starting a local HTTP
server that a dashboard queries. This package takes that architecture and
leaves out the dashboard: the consumer writes the UI.

## Scope

In scope:

- a runtime plugin installed by the application, enabled or disabled by
  whether it is registered;
- a read-only HTTP server on a forced loopback address, serving the compiled
  module graph, the mounted route table, the build-time codegen verdicts, and
  the application's log stream;
- the data contract itself, versioned, because a consumer builds a UI against
  it;
- two changes in `@aponiajs/platform-elysia` that the above requires.

Out of scope, deliberately:

- **any UI.** The package ships no HTML, no assets, and no bundler step. The
  consumer renders.
- **a playground.** Running application code over HTTP is remote code execution
  by construction. Excluded, not deferred.
- **mutation.** Every endpoint is a `GET`. There is no way to change a running
  application through this package.
- **a committed snapshot file and a diff command.** Superseded: a live server
  makes a stale file a second source of truth.
- **a file watcher.** `dev` already restarts the process on every save, so the
  server re-publishes on every restart.
- **bootstrap timing, an architecture linter, and partial-graph upload.**
  Separate concerns; each would be its own package.

## Architecture

`@aponiajs/devtools` depends on `@aponiajs/common`, `@aponiajs/core`,
`@aponiajs/platform-elysia`, and `@aponiajs/cli`. Nothing depends on it. It is a
leaf, installed by an application that wants it.

```ts
// app.module.ts
@Module({
  imports: [
    DevtoolsModule.register({
      port: 8000,
      enabled: Bun.env.NODE_ENV !== "production",
    }),
  ],
})
export class AppModule {}
```

Registration is the opt-in. `enabled` is the switch, and it is the
application's decision: the framework never reads an environment variable on
the application's behalf. A disabled module registers no provider, mounts no
plugin, and opens no socket.

`port` is optional and defaults to `8000`. If the port is already bound, the
plugin logs the failure under `Devtools` and the application boots normally.
A debugging aid must never be the reason a bootable application fails, which is
the same rule the artifact refusals already follow.

### Why a plugin, and which kind

`DevtoolsModule` is an `ElysiaPluginModule`. That is not cosmetic:

- A plain provider is constructed in bootstrap's first pass, **before** any
  controller mounts, so it cannot see the route table.
- An Elysia plugin runs at `onStart`, after every route is mounted.

Verified by probe: a plugin mounted before two routes were added still observed
both at `onStart`. This is what makes the mounted route table — including routes
that `elysiaController` and `defineElysiaController` callbacks build from a real
instance, which `inspectAponiaApplication` cannot produce — available without
constructing anything extra.

The cost is that `onStart` fires on `listen()`. An application that only calls
`handle()` publishes nothing. That is accepted: the plugin reports its state in
the startup log either way.

### The server

`Bun.serve` on its own port. It is not an Elysia route and does not touch
Elysia's route API, which keeps
[`routing/native-route.ts`](../../../packages/platform-elysia/src/routing/native-route.ts)
the only module that registers routes and preserves its
`UNSUPPORTED_ELYSIA_VERSION` guard.

Path prefix: `/__devtools`. The double underscore marks it as an internal
surface, and it keeps the namespace disjoint from anything an application
serves.

```
GET http://127.0.0.1:8000/__devtools/meta
```

## The API contract

The payloads are the product. Every response is frozen, JSON-serializable, and
ordered deterministically — the same rules `inspectAponiaApplication` already
obeys, for the same reason: a consumer diffs and renders them.

`GET /__devtools/meta`

```ts
{
  contract: 1; // the payload version this server speaks
  framework: string; // the running AponiaJS release
  elysia: string | null; // the resolved Elysia, when one resolves
  artifacts: {
    invokers: string | null; // the release the invoker artifact was built by
    descriptors: string | null;
  }
  startedAt: string; // ISO 8601
}
```

A consumer reads `contract` first and refuses a version it does not know. This
is the one field it can rely on never changing meaning.

`GET /__devtools/graph` — the compiled module graph: modules with their
imports, controllers, providers, dependencies and exports, and gateways with
their events. The shape is the existing `AponiaApplicationInspection` **minus
`routes`**, which this endpoint omits on purpose: the graph carries the routes a
controller _declares_, while `/routes` carries the routes the server
_answers_, and publishing both under one name would leave a consumer choosing
between two answers to the same question. `/routes` is authoritative for
routes; nothing else serves them.

It describes the graph the application **actually compiled**, which is whatever
`selectRootModuleDescriptor` chose — not the decorated classes. See the platform
change below.

`GET /__devtools/routes` — the mounted route table, read from the running
native application at request time.

```ts
{
  routes: readonly {
    method: string;
    path: string;
    module: string;
    controller: string;
    handler: string;
    source: "generated" | "compiled";   // which invoker serves this route
    parameters: readonly { index: number; kind: string; property: string | undefined }[];
  }[];
}
```

`source` is the field that does not exist anywhere else. `generated` means the
route is served by a build-time invoker; `compiled` means the runtime compiled
it. A route whose handler was declined by `aponia build` reads `compiled` here
and carries its reason in `/aot`.

`GET /__devtools/aot` — the build-time verdicts.

```ts
{
  graph: "declared" | "decorated";     // which root the container compiled
  invokers: {
    accepted: boolean;                 // was the invoker artifact used at all
    reason: string | undefined;        // why it was refused, when it was
  };
  controllers: readonly {
    controller: string;
    handlers: readonly {
      handler: string;
      invoker: "generated" | "compiled";
      reason: string | undefined;      // why the emitter declined it
    }[];
  }[];
}
```

`graph`, `invokers.accepted`, and `invokers.reason` come from the platform: they
are facts bootstrap already decided. The per-handler `reason` comes from the
emitter's own analysis.

**That analysis is imported lazily.** `@aponiajs/cli` pulls `ts-morph` and
`oxfmt`; loading it at boot would tax every restart of a `bun --watch` loop.
The module is imported on the first request to this endpoint and the result is
cached for the life of the process. The framework facts above are served whether
or not it has been loaded, so an unreachable or slow analysis degrades one field
group rather than the endpoint.

`GET /__devtools/logs?since=<cursor>`

```ts
{
  cursor: number;                        // pass back as `since`
  entries: readonly {
    level: string;
    context: string;
    message: string;
    timestamp: string;
  }[];
}
```

A bounded ring buffer, polled with a cursor. Not SSE and not a WebSocket: a
long-lived connection is a resource the consumer must manage, and polling a
cursor is the shape that survives a page reload. The buffer is bounded so a
forgotten consumer cannot grow the process.

## Security

The threat is a debugging surface that exposes an application's internals, and
the failure mode is it being reachable when it should not be.

- **The bind address is not configurable.** `127.0.0.1` always. There is no
  `host` option to set to `0.0.0.0` by accident, and an application listening on
  a public interface does not thereby publish its devtools.
- **No environment inference.** `enabled` is required and is the application's
  decision. The framework does not read `NODE_ENV`, because an environment
  variable is not a security boundary and a framework that guesses on the
  application's behalf is how a debug surface reaches production.
- **Read-only.** Every endpoint is `GET`; any other method is `405`.
- **Announced.** A started server logs its URL at `Devtools` level, so an
  application that published one says so in its own startup output.
- **Bounded.** The log buffer has a fixed capacity. `since` outside the buffer
  returns what is retained rather than an error.
- **No execution.** There is no endpoint that evaluates code, and none that
  mutates application state.

## Platform changes

Two, both in `@aponiajs/platform-elysia`.

### 1. Expose the boot decision and the compiled graph

Bootstrap already resolves which module graph to compile and which invokers to
accept. Today it keeps neither as data. `bootstrapAponiaApplication` will attach
both to the native application so a plugin can read them at `onStart`:

- the resolution record, as already computed by
  `routing/invoker-artifact.ts` and `modules/module-descriptor-artifact.ts`;
- the compiled `ModuleDefinition` root that `compileRootModule` returned.

This is a **seam, not a new public contract**: the two selectors stay internal
and their rules stay in one place. The alternative — exporting them and letting
this package re-apply the rules — was rejected, because a second implementation
of the refusal rule would drift from the runtime and the devtools would report
something that is not true.

`compileRootModule`'s result is what makes `/graph` correct. Without it
`/graph` would lower the decorated classes and describe a graph the application
may not be running.

### 2. Resolve artifacts in `inspectAponiaApplication`

`inspectAponiaApplication(root)` currently compiles the **decorated** root
unconditionally. It does not accept `AponiaApplicationOptions`, so for an
application booting from a generated descriptor artifact it reports a graph the
application is not running, silently.

This is a defect independent of this package — `bun run inspect` in a generated
application has it today — and it is fixed here: inspection accepts the same
artifact options bootstrap does and resolves the root through the same rule.

With change 1 in place this package does not depend on the fix, but a user
running `bun run inspect` on an application they have also pointed at
`__devtools` would otherwise get two different graphs from the same project.

## Accepted limitations

- **Data freshness is per boot.** The server publishes what it read at startup.
  In development `bun --watch` restarts on every save, so this is current; a
  long-running process does not re-read the filesystem.
- **`onStart` requires `listen()`.** An application that only uses `handle()`
  publishes nothing.
- **A stale invoker artifact is still served.** If a handler's parameter
  decorators change and the committed artifact is not regenerated, the platform
  uses the stale invoker and binds the handler's arguments as the old source
  described. The version stamp catches release drift, not source drift. This
  package reports what happened; it does not prevent it. Preventing it is a
  platform change evaluated on its own merit, not a devtools feature.
- **`elysiaController` callback routes appear in `/routes` but contribute no
  symbol-keyed handler name.** They are read off the mounted application, which
  knows the path and method but not the class property that built them.

## One open question this design does not settle

`packages/platform-elysia/AGENTS.md` states that a synchronous invoker around an
async handler "runs `onAfterHandle` before Elysia awaits that Promise, exposing
the raw Promise to the lifecycle". A probe run against the supported Elysia
release did **not** reproduce this: `onAfterHandle` observed the resolved value
for both a synchronous and an asynchronous wrapper, with `aot` both off and on.

Two probes are not proof of absence, so this document records the disagreement
rather than resolving it. It matters here because the invariant is the stated
reason the runtime compiles Promise-capable invokers at all — if it does not
hold, that rule is buying nothing, and if it does hold in a configuration not
probed, the generated invoker emitter should be revisited. It is called out so
that neither conclusion is reached silently.

## Delivery order

The two platform changes are prerequisites, and both are independently
shippable: each fixes something that is wrong today whether or not this package
is ever built. They land first, with their own tests, so that the package is
built on facts rather than on a seam that arrives with it.

The package follows: module and registration, then the server and `/meta`, then
`/graph` and `/routes`, then `/logs`, then `/aot` with its lazy import. Each
endpoint is independently testable, so the order is also the order a reviewer
can check.

## Testing

Bun is the primary lane: `packages/devtools/tests/*.test.ts`. The Vite+
conformance lane mirrors the public contract in
`packages/devtools/tests-vp/*.conformance.ts`.

- Boot an application with the plugin registered and query the server over
  `fetch`. Do not test handlers directly; the contract is HTTP.
- Cover: the disabled module opening no socket; the forced loopback address;
  a non-`GET` method answered `405`; an unknown path answered `404`; each
  endpoint's shape, ordering, frozen-ness, and serializability; the cursor
  contract including `since` beyond the retained window; `/aot` before and
  after the lazy import; `/routes` reporting `generated` and `compiled` for the
  two cases; `/graph` describing the compiled root when a descriptor artifact
  is supplied and the decorated root when it is refused.
- Assert `contract` is `1` and that a consumer reading only `meta` can decide
  whether to proceed.
- The platform changes carry their own tests in the platform's lanes, including
  the pre-existing `inspectAponiaApplication` defect as a regression case.

Repository gates that this package joins, and which the change must satisfy in
the same pull request:

- an entry in the source-completeness discovery in `scripts/coverage-gate.ts`;
- `packages/devtools/AGENTS.md`, indexed from the root guide;
- a row in `docs/packages.md`, a `packages/devtools/README.md`, and a
  `docs/devtools.md` reference;
- the workspace version, which every publishable package shares;
- the aggregate 95% line and function coverage floor.
