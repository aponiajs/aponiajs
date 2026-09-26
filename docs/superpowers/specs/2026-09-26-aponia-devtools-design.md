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
- a read-only HTTP server, loopback by default and moved off loopback only
  when the registration names a host, serving the compiled
  module graph, the mounted route table, each route's per-request stages as a
  graph, the build-time codegen verdicts, the application's log stream, and the
  requests it answered;
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

`GET /__devtools/flow` — the stages each mounted route passes through, as a
directed graph.

```ts
{
  routes: readonly {
    id: string;                       // "GET /users/:id"
    stages: readonly {
      id: string;                     // stable within one response
      kind:
        | "derive" | "validate" | "resolve" | "hook"
        | "guard" | "interceptBefore"
        | "bind" | "invoke" | "handler"
        | "interceptAfter";
      scope?: "global" | "local";     // on the lifecycle kinds: which scope runs the stage
      enhancer?: string;              // on `guard` and `intercept*`: the class the stage runs
      slot?: "body" | "query" | "params" | "headers" | "cookie" | "response";
      model?: string;                 // the @Validation() class the slot resolved to
      parameters?: readonly { index: number; kind: string; property: string | undefined }[];
      hook?: string;                  // a stable identity for a contributed hook
      source?: "generated" | "compiled";   // on `invoke`
      controller?: string;            // on `handler`
      handler?: string;
      next: readonly string[];        // the stages that run after this one
    }[];
    filters: readonly {               // run only when a guard or the handler threw
      kind: "filter" | "default";     // a declared filter, or the mapping every route ends with
      name: string;                   // the filter class, or the Problem Details mapping
      scope?: "local" | "global";     // on `filter`: the declaration that contributed it
      catch?: readonly string[];      // on `filter`: what @Catch() named; empty answers anything
    }[];
  }[];
}
```

Read from the running native application, not inferred from source. Verified by
probe: a mounted route exposes its `transform` hooks (a plugin's `derive`), its
`beforeHandle` hooks (a plugin's `resolve`, and any local hook), and the lowered
JSON Schema already bound to `params`, `query`, and `body`. That is enough to
publish the contributed hooks and the validation slots as data without
re-deriving anything.

The route's own enhancers are the exception, and the compiled route plan is
where they come from. The platform lowers a route's guards and interceptors
into one `beforeHandle` function and one `afterHandle` function, and a compiled
hook says nothing about its parts; the plan carries the enhancers the route
declares, and the application's own declaration is resolved beside it, so the
two lists the hook was built from are what publishes as stages. A compiled hook
is never published as a `hook` stage: its parts are the `guard` and `intercept*`
stages, which is where the order between them is still legible.

**The order is the one the code states.** Per request:

1. `derive`, `validate`, `resolve`, `hook` — the route's Elysia hooks and its
   schema, ahead of anything the platform compiled;
2. `guard` — every guard the route runs, the application's own declaration
   (`global`) first, then the controller's and the handler's (`local`), each
   scope in declaration order;
3. `interceptBefore` — the same order, immediately behind the guards, in the
   same `beforeHandle`;
4. `bind`, `invoke`, `handler` — the compiled parameter binding, the invoker
   that serves the route, and the controller's method;
5. `interceptAfter` — the whole interceptor list reversed, so the outermost
   interceptor's half runs last and each receives what the previous one
   answered.

A stage is published only when the route runs it. A guard that refuses ends the
chain there, and so does a handler that throws: no later guard, no before half,
no after half, and no handler runs. What answers that path is the route's
filters.

**Filters are a list on the route, not a stage.** They run when a guard or the
handler threw, never on the happy path, so a stage in the chain would claim
something every request runs. Each route's entry carries them in their own list,
ordered exactly as the route's `error` array is — the method's filters, then the
controller's, then the application's, then the Problem Details mapping every
route carries last — because the first entry that answers is the one that
decides.

**This is not Nest's flow graph, and the difference is the point.** Nest builds
that view from guards, interceptors, and pipes. Aponia compiles guards and
interceptors onto a route's own hooks, so the stages above name them; it has no
pipes, because a route's declared schema already validates every slot it
carries; and it has no middleware, because Elysia's `derive` and `resolve`,
reachable through `ElysiaPluginModule`, are that mechanism. The graph therefore
publishes what the route actually runs rather than a translation of Nest's view,
and it carries one dimension Nest has no equivalent for: `invoke.source` reports
whether the route reaches a build-time invoker or a runtime-compiled one.

`stages` is a graph rather than a list because a consumer renders it as one.
Only the validation stages, the guard stages, and the invoke stage can branch
today, but `id` and `next` are stated explicitly so a linear chain is not
something a renderer has to assume.

**A contributed hook cannot be named.** Elysia identifies a hook by `subType`,
`scope`, and a `checksum`; the plugin that contributed it is not carried on the
route. A stage therefore reports `hook` as an identity derived from the
checksum — which groups the same hook across every route it reaches — and does
not report a plugin name. Naming it would require Elysia to carry that
information, which it does not, so the field is absent rather than guessed. An
enhancer stage is the other case: the platform resolved that class itself, so
`enhancer` names it, and only a hook Elysia owns stays anonymous.

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

`GET /__devtools/requests?since=<cursor>`

```ts
{
  cursor: number;                        // pass back as `since`
  entries: readonly {
    method: string;
    path: string;                        // the route pattern that matched — "/users/:id"
    url: string;                         // the path with its query string, as it arrived
    status: number;
    durationMs: number;
    timestamp: string;                   // ISO 8601, when the request arrived
    error?: string;                      // the message the answer published, on a failure
    headers?: Readonly<Record<string, string>>;
    body?: string;                       // cut at `capture.bodyLimit`, marked when it was cut
  }[];
}
```

The same bounded ring buffer, polled with the same cursor, never SSE and never a
WebSocket, for the reasons `/logs` gives. Every other endpoint publishes what the
application **is**; this one publishes what it **did**.

**Everything is captured by default.** A registered module records, for every
request the application answers: its method; the route pattern that matched; the
URL as it arrived, query string included; the status; the duration; the arrival
time; the request's headers; and the request body the route parsed. `capture` is
how a developer turns parts of that off, and every one of its options is an
opt-out rather than a permission:

```ts
interface DevtoolsCaptureOptions {
  /** Record requests at all. Default true. */
  readonly enabled?: boolean;
  /** Include request headers. Default true. */
  readonly headers?: boolean;
  /** Include the parsed request body. Default true. */
  readonly body?: boolean;
  /** Maximum characters stored for a body. Default 16384. */
  readonly bodyLimit?: number;
  /**
   * Header names to replace with the literal "[redacted]" before an entry is
   * stored. Empty by default: the tool shows what arrived. Set it when the
   * application is pointed at data that is not yours.
   */
  readonly redact?: readonly string[];
}
```

`capture: false` is shorthand for `{ enabled: false }`. `redact` matches a header
name case-insensitively, because a header name is, and it keeps the header in
place with the literal `[redacted]` as its value, so a consumer can see that one
was sent and that the tool was told not to show it. A `bodyLimit` that cut a body
appends the literal `[truncated]` to the stored value. A body this package cannot
serialize — one that refers to itself, or one carrying a `BigInt`, both of which
`JSON.stringify` refuses — is stored as the literal `[unserializable]` rather
than left out, because a missing `body` would read as a request that carried
none. The wire never carries such a body: an application's own validation
transform or parse hook is what makes one, and the record states what it could
not read rather than failing the answer it describes.

**`path` and `url` are both published, and they answer different questions.**
`path` is the pattern the request matched, so it names the route that answered;
`url` is the path and query string that arrived, which a pattern never carries.
**A token passed as a query parameter is captured in `url`.** That is a fact
about the record rather than a defect in it: an application that carries a secret
in a query string and points this module at that traffic is showing it to whoever
reads this endpoint, and `capture.redact` is the answer for exactly that case.

**An unmatched request is recorded, and the record says so.** A request that
reaches the route table without matching a route — a path nothing serves, or one
a plugin's `onRequest` threw for — is not dropped: `path` carries the path that
arrived rather than a pattern, and no route, controller, or module is named.
`/routes` is the table that says which of the two a `path` is, because a pattern
the application mounted is in it and a path that arrived without matching one is
not. One refusal produces no entry at all: an `onRequest` that returns a
`Response` before matching runs no later phase, so the hook the record is written
from never runs and its status is never learned. An entry written at arrival
instead would have to invent that status, and this package states what it
observed rather than what it guessed.

**Response bodies are not captured.** Buffering every answer costs in proportion
to the traffic rather than to the question being asked, and the request is
usually what is being debugged. An application whose answers are worth recording
has `application.handle` and its own tests.

**`error` is what the answer published, never the exception.** The field is
present on a `5xx` whose answer still carries a Problem Details body this hook can
read — the `HttpError` path — and it carries that body's `detail`. Wherever there
is nothing to read it is absent, and the absence is stated rather than filled with
the exception's message: an unhandled failure is answered by the platform's own
mapping, whose `Response` is never assigned to the context, and a `5xx` a handler
built itself is the answer the client already holds, so its body cannot be read a
second time. The exception is reported where it always was, in the log stream
under `ExceptionsHandler`, which `/logs` serves. A `4xx` is an answer rather than
a failure: a validation `422`, a `404`, and an `HttpError` a route threw on
purpose all carry no `error`.

**The record is written by the plugin, not by the application.** The module
contributes the hook that writes it, and it observes rather than participates: it
cannot change what a route receives, and it cannot change the answer. An
application that did not register the module has nothing on its request path at
all. The data is in memory, per boot, and bounded, like every other payload this
package serves: a restart is a new record, and the buffer's capacity is what a
forgotten consumer can cost. The devtools server is its own server, so polling
the record never adds to it.

## Security

The threat is a debugging surface that exposes an application's internals, and
the failure mode is it being reachable when it should not be.

- **The bind address defaults to loopback and widening it is reported.**
  `127.0.0.1` unless the registration names a `host`, because a debugging aid
  should not be reachable by default and an application listening on a public
  interface does not thereby publish its devtools. The option exists because a
  container that publishes its port, a remote development box, and a phone on
  the same network are real cases the default would otherwise make unreachable.
  A bind outside loopback is permitted and never silent: the start reports one
  row under `Devtools` naming the `host` option, the address the socket took,
  and `/requests` — which records request headers and bodies by default — so the
  reader learns the concrete exposure rather than the abstraction. `127.0.0.1`,
  any `127.x.x.x`, `::1`, and `localhost` are the loopback spellings
  the row is skipped for. The check is syntactic and resolves nothing, which is
  the safe direction: a host name that points at loopback still reports.
- **No environment inference.** `enabled` is required and is the application's
  decision. The framework does not read `NODE_ENV`, because an environment
  variable is not a security boundary and a framework that guesses on the
  application's behalf is how a debug surface reaches production.
- **Read-only.** Every endpoint is `GET`; any other method is `405`.
- **Announced.** A started server logs its URL at `Devtools` level, so an
  application that published one says so in its own startup output.
- **Bounded.** The log and request buffers have a fixed capacity. `since`
  outside either buffer returns what is retained rather than an error.
- **No execution.** There is no endpoint that evaluates code, and none that
  mutates application state.
- **The request record is the application's own data.** Headers and bodies are
  captured in full by default, because a development tool that hides what a
  request carried is one nobody opens. An application pointed at traffic that is
  not a development environment's — a shared staging service, a colleague's
  browser session — is the case `capture.redact` exists for: it names the headers
  to replace before an entry is stored. Everything else about the record is what
  it is: in memory, per boot, never on disk. No default guards it, for the same
  reason `enabled` is the application's decision: the module is already opt-in
  and the socket is loopback-bound unless the application itself moved it, and a
  framework that hides data the
  developer asked to see is the same mistake as one that guesses about the
  environment.

## Platform changes

Two, both in `@aponiajs/platform-elysia`.

### 1. Expose the boot decision and the compiled graph

Bootstrap already resolves which module graph to compile and which invokers to
accept. Today it keeps none of it as data. `bootstrapAponiaApplication` will
attach the following to the native application so a plugin can read them at
`onStart`:

- the resolution record, as already computed by
  `routing/invoker-artifact.ts` and `modules/module-descriptor-artifact.ts`;
- the compiled `ModuleDefinition` root that `compileRootModule` returned;
- the compiled route plans, whose schemas must retain the name of the
  `@Validation()` model each slot resolved to, and which carry the enhancers
  their routes declare. The platform already resolves that model while a route
  mounts; `/flow` needs the name beside the lowered validator, because the
  lowered JSON Schema no longer says which class produced it, and it needs the
  enhancers for the same reason: they lower into one compiled hook, so the plan
  is the only place their order is still separate;
- the application's own enhancer declaration, resolved once for the boot,
  because a route's plan states only what the route declares while the hook a
  route mounts runs both lists merged.

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
- **The request record is not complete.** A request refused before a route
  matched has no route identity: the entry carries the path it asked for and
  names no controller, module, or handler. A request the runtime never reached —
  one the server itself rejected, or one whose client disconnected before an
  answer — is not recorded at all. The record says what the application answered,
  not everything that was asked of it.

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
`/graph` and `/routes`, then `/flow`, then `/logs`, then `/requests`, then `/aot`
with its lazy import. Each endpoint is independently testable, so the order is
also the order a reviewer can check. `/flow` follows `/routes` because it is
keyed by the same route identities and reads the same mounted application, and
`/requests` follows `/logs` because it is the same buffer and the same cursor
over a different record.

## Testing

Bun is the primary lane: `packages/devtools/tests/*.test.ts`. The Vite+
conformance lane mirrors the public contract in
`packages/devtools/tests-vp/*.conformance.ts`.

- Boot an application with the plugin registered and query the server over
  `fetch`. Do not test handlers directly; the contract is HTTP.
- Cover: the disabled module opening no socket; the default loopback bind
  reporting nothing; each loopback spelling reporting nothing; a host outside
  loopback binding, answering, and reporting once under `Devtools`; a widened
  bind that cannot be taken reporting the address it could not take;
  a non-`GET` method answered `405`; an unknown path answered `404`; each
  endpoint's shape, ordering, frozen-ness, and serializability; the cursor
  contract including `since` beyond the retained window; `/aot` before and
  after the lazy import; `/routes` reporting `generated` and `compiled` for the
  two cases; `/graph` describing the compiled root when a descriptor artifact
  is supplied and the decorated root when it is refused; `/flow` reporting a
  plugin `derive` and `resolve`, a contributed local hook, each populated
  validation slot, every guard and interceptor stage in the order the code
  states, a declared route's filter list in its precedence order, the binding,
  the invoke source, and the handler, with every `next` naming a stage the same
  route actually declares and no stage unreachable from the first; `/requests`
  recording an entry with every field it publishes by default, carrying the
  pattern in `path` and the query string in `url`, recording an unmatched
  request without a route identity, recording nothing when `capture` is false,
  omitting `headers` and `body` when each is turned off, marking a body it cut at
  `bodyLimit`, replacing a `redact`ed header with the literal, and carrying
  `error` with the message the answer published only on a `5xx` whose Problem
  Details body the hook can still read — absent on a `4xx`, which is an answer
  rather than a failure, and absent on the two `5xx` whose body cannot be read
  back, the platform's own mapping for an unhandled failure and an answer a
  handler built itself.
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
