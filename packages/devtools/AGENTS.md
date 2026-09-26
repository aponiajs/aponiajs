# @aponiajs/devtools — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The opt-in devtools surface for a running application: the module an application
imports, the plugin that runs at `onStart`, and (from the tasks that build it)
the loopback HTTP API that reports what the running application actually is. The
package is a leaf — nothing in the framework depends on it, and an application
installs it deliberately.

| Domain       | Owns                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| `module/`    | `DevtoolsModule.register`, `DevtoolsOptions`, the plugin                   |
| `server/`    | `startDevtoolsServer`, the loopback socket, `routeRequest`, the dispatcher |
| `endpoints/` | One payload builder and its wire contract per endpoint, `/meta` first      |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- Registration is the opt-in and `enabled` is the switch. The framework never
  reads an environment variable on the application's behalf, because an
  environment variable is not a security boundary.
- A disabled registration mounts nothing: no provider, no native plugin, and so
  no socket — the plugin is the only thing in this package that starts a server,
  so the socket absence follows by construction from the plugin absence. It is
  an inert module rather than a plugin that does nothing, so a boot cannot
  mistake it for the enabled one.
- The module is an `ElysiaPluginModule` because the plugin has to see the
  mounted route table. A plain provider is constructed before any controller
  mounts and cannot; an Elysia plugin runs at `onStart`, after every route is
  mounted. Never construct a second plugin instance or add a separate devtools
  container.
- `onStart` fires on `listen()`. An application that only calls `handle()`
  publishes nothing and must be unaffected — that is accepted behavior, not a
  defect to work around.
- The bind address is `127.0.0.1`, always, and there is no `host` option to set
  to `0.0.0.0` by accident. A debugging aid that reaches a public interface is
  the failure mode this package exists not to have.
- A debugging aid must never fail a boot: a port that is already bound is
  reported under `Devtools` with the reason, `startDevtoolsServer` returns
  `undefined`, and the application continues. The plugin's `onStart` reports
  nothing further when it sees that, so one refused bind is one row.
- The handler build runs inside that `onStart`, which Elysia neither awaits nor
  catches, so nothing it does may throw — a throw would take `listen()` with it.
  That makes every read of a boot record a read of data this package did not
  write: the record arrives through a registry-global symbol key, and a copy of
  `@aponiajs/platform-elysia` older than this release answers the same key with a
  record that has no `artifacts` at all. The stamp read is an optional chain that
  answers `null` — what an artifact the boot did not adopt reads as — rather than
  a dereference that would fail the boot it is describing.
- The plugin holds the server handle and stops it at `onStop`, which Elysia
  fires on `close()` for a plugin as much as for the application that mounted it.
  A devtools socket that outlived its application would hold the port across the
  next boot and answer for an application that is gone; the handle belongs to the
  plugin because the plugin is what opened the socket.
- The plugin owns one devtools socket at a time. A second `listen()` re-runs
  `onStart` while the socket the first one started is still held, so only a start
  that succeeded becomes the handle — assigning the `undefined` a refused bind
  answers would leave the live socket with nothing left to stop it — and the
  socket being replaced is stopped as the replacement starts. Losing the handle
  to a start that failed, or replacing it without stopping the socket it named,
  is the leak this prevents.
- The socket binds port `0` happily, and the report then names the address the
  socket took — never the port the registration asked for. A report that echoed
  the configuration would be indistinguishable from one that never bound.
- A payload that describes a boot is built once, when the socket starts. It
  describes a boot, and a boot does not change once it has started, so two polls
  of one server answer the same report. `/routes` and `/flow` are the exceptions,
  and they are exceptions by design: the mounted route table belongs to the
  running application, which may mount another route on its native instance
  before it listens, so those handlers read the table when the request arrives.
  The table is also where a route's own entry lives — its contributed hooks and
  the schema slots Elysia holds — which is the half of `/flow`'s stages no boot
  record carries. Everything they report from the record is still the boot's, and
  a route the record does not describe is reported with the facts a record would
  have supplied left empty rather than filled in.
- `/meta` falls back to this release for an application no boot produced, and
  says `null` for every artifact such a boot did not adopt. It never crashes on
  a missing record and never reports a guess as a release.
- `/meta` reports each artifact stamp exactly as the boot record states it. The
  record is where "an artifact supplied this" and "a release wrote it" are told
  apart — a hand-written `ModuleDefinition` compiles as declared data that no
  build emitted — so this package never re-derives a stamp from the graph it sees.
- `/graph` reports the graph the boot compiled, which is the record's own
  `rootModule` lowered through `compileRootModule` and projected by
  `inspectAponiaApplication` — the root selector substitutes only a class or a
  dynamic module, so a descriptor handed to the projection cannot be re-resolved
  and this endpoint cannot disagree with `bun run inspect`. It carries no `routes`
  key, because the plans state the routes a controller declares while `/routes` is
  what reports the routes the server answers.
- An endpoint whose fact the boot record does not hold is not registered rather
  than answered with a guess: a record a foreign copy of the platform wrote — one
  older, which has no `rootModule` field, or one newer, whose compiled root this
  release cannot lower — serves no `/graph`, and the dispatcher's `404` is the
  answer for a path the handler record does not own.
- `/routes` is registered whatever the record holds, because its fact is not the
  record's: the mounted route table is the application's own, and an application
  no boot produced still answers one. The record joins to it rather than replacing
  it, and the join runs one way only — every route the table holds is reported,
  and an entry describes a route only when the table holds it. The table is read
  from the application, never from a payload, and it is Elysia's rather than this
  release's, so both halves of the join are checked rather than assumed: an entry
  whose method or path is not a string cannot be joined or reported, and is
  dropped.
- `/routes` states three facts per route and each has one owner. The method, the
  path, and the parameter list are what the mounted table and the boot's plans
  hold. `source` is the binding the boot decided on: `"generated"` for a
  build-time invoker, `"compiled"` for the running platform's own compilation or
  for a route a callback mounted, which no artifact can reach, and `null` when no
  boot recorded the route — a native WebSocket route, or one mounted outside the
  boot. `null` never means "an unknown binding"; a guess published where a decided
  state belongs would make one boot's routes look interchangeable with another's.
  A field the record is too old to carry reads `null` the same way, for the same
  reason `/meta`'s optional stamp read does.
- `/routes` reports an empty name rather than a guess wherever the boot has none
  to give: a route a controller's callback or plugin mounted names its module and
  controller and no handler, because the property key that built it exists only
  while the mount runs and the mounted table keeps no trace of it; a route no plan
  and no callback describes names none of the three. Entries are sorted by path,
  method, controller, handler, and module in code-unit order, which is the order
  the platform's own inspection states.
- `/flow` is registered whatever the record holds, for `/routes`' reason and one
  of its own: its stages have two owners. The mounted route entry owns the
  contributed hooks and the schema slots Elysia itself holds, so an application
  no boot produced still states the hook stages its routes run; the boot record
  owns the compiled plan, which is the only place a route's guards and
  interceptors are still separate, and the application's own enhancer
  declaration, which no plan carries.
- `/flow` publishes a compiled hook as its parts and never as a `hook` stage. The
  platform lowers a route's guards and the before halves of its interceptors into
  one `beforeHandle`, and the after halves into one `afterHandle`, so a compiled
  hook says nothing about its parts: a `guard`, an `interceptBefore`, and an
  `interceptAfter` stage each name the class the platform resolved, and the parts
  of one hook keep the order the route declared them in. An entry of a lifecycle
  array this release cannot identify — no scope it knows and no checksum — is not
  published as a stage, which is how the compiled hook stays out of the hook
  stages rather than being reported as one.
- The application's own enhancer declaration merges into the routes the platform
  mounted from a plan and into no others. A route a controller's callback mounted,
  and one mounted on the native instance, carry no compiled hook for it to merge
  into, so publishing it for one of those routes would claim an enhancer that never
  runs.
- `/flow` publishes a stage only when the route runs it: a route that declares a
  schema for no slot carries no `validate` stage, a handler that binds no
  parameter carries no `bind` stage, and a route no record describes carries no
  `invoke` and no `handler`. The order is the spec's, and it is read from the two
  sources rather than re-derived: the contributed hooks and the validation slots
  first, then the guards and before halves, then the binding, the invoker, and the
  method, then what a plugin contributed to the after phase, and last the after
  halves over the whole interceptor list reversed, so the outermost interceptor's
  half runs last.
- `/flow`'s `id` and `next` are stated per stage rather than assumed from the
  order, so a renderer draws a graph: the ids are the route's own id and the
  stage's position, and every `next` names a stage of the same route. The ids are
  stable within one response and never a cross-response identity, because the
  stages are assembled per request from a table that may have changed.
- A contributed hook is identified by an identity, never by a name. Elysia
  identifies a hook by its `subType`, its scope, and a `checksum`, and the plugin
  that contributed it is not carried on the route, so the identity is derived from
  the checksum — which groups the same hook across every route it reaches — and no
  plugin name is reported. A hook that carries no checksum is published with its
  scope and no identity, because nothing would group it; a hook whose scope this
  release does not know is published without a scope rather than with a guess.
  `"scoped"` is normalized to `"local"`: a hook scoped to the plugin that
  contributed it reaches that plugin's own routes and the ones mounted beside it,
  which is the reach of a local declaration.
- A route's filters are a list on the route and never a stage in the chain. They
  run when a guard or the handler threw rather than on every request, and the list
  is ordered exactly as the route's own `error` array is — the method's filters,
  then the controller's, then the application's, then the mapping every compiled
  route ends with — because the first entry that answers is the one that decides.
  A route no plan describes carries no list at all: the platform compiles that
  array only for the routes it mounts from a plan.
- The report describes the boot the _plugin's own_ application carries: Elysia
  hands `onStart` the root application, which is the one bootstrap attached the
  record to.
- The server is `Bun.serve` on its own port. It registers no Elysia route, which
  keeps `routing/native-route.ts` in `packages/platform-elysia` the only module
  in this workspace that calls Elysia's route registration API.
- Every endpoint is a `GET`; any other method answers `405` before the path is
  read, and a path the handler record does not own answers `404`. The lookup is
  `Object.hasOwn`, because the suffix comes from the request. Nothing this
  package serves mutates application state.
- `startDevtoolsServer` is synchronous, and so is the read that resolves the
  installed Elysia, because Elysia does not await `onStart`. A handler may still
  answer a promise: Task 10's analyzer loads itself on first request.
- Only an Elysia installed in the tree is reported. `Bun.resolveSync` falls back
  to Bun's global install cache, so it answers for a tree that installed nothing
  and would name a release the application never ran against; the resolver walks
  up from the directory that asks, looking for `node_modules/elysia/package.json`
  itself, and answers `null` when the walk finds none. The CLI's
  `hasOwnToolchain` guard is the same rule for the same reason.
- The package reports what a boot decided; it never re-derives it. Read the boot
  record through `readApplicationDiagnostics` instead of re-applying a
  platform selector's rule here.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+.

Boot through `AponiaFactory.create` and assert what an application observes:
whether the boot mounted the plugin module (the enabled twin reports
`ElysiaPluginModule[devtools] dependencies initialized`, the disabled twin
asserts that line and every `Devtools` report absent) and what the plugin
reported at `onStart`.

The contract is HTTP, so the socket is asserted over HTTP and never assumed: a
case binds port `0`, reads the address the report named back out of it, and
fetches that address. No case depends on a fixed port, and none connects to a
port it guessed. The single exception is the default-port case, which asserts
that the row names `8000` and decides nothing about whether `8000` is free: a
bind that succeeds reports the address it took, one that is refused reports the
address it could not take.

A refused bind is asserted the same way — a blocker on port `0`, an application
whose devtools points at the port the blocker took — and the pair is what makes
the two reports distinguishable: the ephemeral case names an address that
answers, the refused case states it could not listen and leaves the application
answering its own routes.

The socket's lifetime is asserted over HTTP too: a case polls the address while
the application listens, closes the application, and polls again, because a
devtools server that survived `close()` is indistinguishable from a working one
until a second boot cannot take the port. A second `listen()` is asserted the
same way: the address the first socket took stops answering once the second boot
replaces it, and the address the second one took answers, so the plugin is shown
to hold one socket rather than to have lost track of the first.

The handler build is asserted against a record this release did not write: a case
attaches a boot record with no `artifacts` — what a copy of the platform older
than the artifact stamps leaves behind — and requires `/meta` to answer `null`
stamps rather than throw, because that build runs where a throw takes `listen()`
with it. `/routes` is asserted the same way against a record whose plans carry no
binding state and which has no callback routes at all.

`/routes` is asserted for the two decisions it makes about a running application
rather than about a boot. Both bindings are mounted by one application, because a
case that only ever observed one of them could not tell a per-route decision from
a per-boot one — and each route answers with a different string, so the report is
checked against the binding that served rather than read back as a claim. A route
mounted on the native application after the server started has to appear, which is
the case a payload built once at `onStart` would fail.

`/flow` is asserted the same way, and the assertions are the wire shape because
the shape is the contract. A decorated application pins the full chain a route
runs, its guard's class and scope, and its filter list; a plugin-contributed
`derive`, `resolve`, and lifecycle hook pin what the mounted entry owns, including
the identity that groups one hook across the two routes it reaches and the absence
of `enhancer` on a stage nothing names; a hand-written descriptor pins the
`generated`/`compiled`/`null` tri-state `source` on `invoke`; and the application's
own enhancers pin both their order ahead of the route's and the reversal of the
after halves. A compiled hook is asserted not to appear as a `hook` stage by the
exact stage lists rather than by a rule re-applied in the test. The graph every
case needs is checked from the payload alone: the ids are unique, every `next`
names a stage of the same route, and every stage is reachable from the first.

The table and the record are both data this release did not write, so both are
asserted where they are not the shape it expects. One case serves a table whose
`routes` is not an array, whose entries carry no method or path, whose hooks
object is missing, and whose lifecycle arrays hold entries with no identity and a
scope this release does not know; another serves a record whose plans carry a
property key, a parameter list, a schema, and enhancer lists that are not the
shapes this release writes. Both must leave the endpoint answering — that handler
runs inside `Bun.serve`, where a throw is a failed request — so a fact neither
source states is reported as the absence it is rather than filled in.

The Elysia read is asserted for what it refuses: the workspace's own install
answers its version, and a throwaway project that installed nothing answers
`null` — the case that would report a cached release instead if the resolver
asked `Bun.resolveSync`.

The pure dispatcher is tested directly, because `405` and `404` are the two
answers a socket cannot demonstrate as cheaply, and the same cases run over a
real socket as well so the contract is pinned where a client meets it.

The Vite+ lane stays type-only — it mirrors `DevtoolsOptions` and the payload
types, and opens no socket. A conformance run is not the place to assert a
transport the Bun lane already drives end to end.
