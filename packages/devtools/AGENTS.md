# @aponiajs/devtools — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The opt-in devtools surface for a running application: the module an application
imports, the plugin that runs at `onStart`, and (from the tasks that build it)
the HTTP API that reports what the running application actually is — loopback by
default, and widened only by naming a host. The package is a leaf — nothing in
the framework depends on it, and an application installs it deliberately. It is not dependency-free itself: `@aponiajs/cli` is
what `/aot`'s build verdicts are read through, and that import is deferred to the
first request so an application that never polls the endpoint never loads it.

| Domain       | Owns                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `module/`    | `DevtoolsModule.register`, `devtoolsPlugin`, `DevtoolsOptions`, the plugin                                              |
| `server/`    | `startDevtoolsServer`, the socket and the loopback check, `routeRequest`, the dispatcher                                |
| `endpoints/` | One payload builder and its wire contract per endpoint, `/meta` first, and the cursor reader the cursor endpoints share |
| `buffer/`    | The bounded cursor buffer `/logs` and `/requests` share, and nothing else                                               |
| `logging/`   | The log stream: its record, its bound, the tap that fills it from a logger, and the one-line form of a thrown reason    |
| `requests/`  | The request record: its entry, its bound, and the capture that fills it                                                 |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- Registration is the opt-in and `enabled` is the switch. The framework never
  reads an environment variable on the application's behalf, because an
  environment variable is not a security boundary.
- Registration has two spellings that mount one plugin: `DevtoolsModule.register`
  in a module's `imports`, and `devtoolsPlugin` in `AponiaFactory.create`'s
  `plugins` option. Both read the same `DevtoolsOptions`, both build the plugin
  through `createDevtoolsPlugin`, and both are gated by `enabled` — one
  construction is what makes "the same mounted behaviour" structural rather than
  a promise two code paths keep. The option path exists because a registration is
  a call expression and `aponia build` lowers a module only when every `imports`
  entry is a single identifier: the module path declines the module that wrote
  it, and where that module is the root the committed descriptor artifact keeps
  serving a graph the registration is not in. The option path pays a price the
  module path does not — the plugin is in no module, so it reaches neither the
  module graph, nor `inspectAponiaApplication`, nor a generated artifact — and
  both prices are documented where a user reads them. Keep the two spellings in
  step: a third path is a third surface, not a convenience.
- A disabled registration mounts nothing: no provider, no native plugin, and so
  no socket — the plugin is the only thing in this package that starts a server,
  so the socket absence follows by construction from the plugin absence. It is
  an inert module rather than a plugin that does nothing, so a boot cannot
  mistake it for the enabled one. The option path states the same decision with
  the other shape the platform accepts: `devtoolsPlugin` answers `undefined` and
  the factory mounts nothing for that entry, because a value that mounts nothing
  is the one thing a boot cannot read as an enabled registration. `enabled` is
  the switch on both paths rather than whether the call happens, so one options
  object drives both and an application forwarding its configuration cannot mount
  a debug surface it did not ask for.
- The module is an `ElysiaPluginModule` because the plugin has to see the
  mounted route table. A plain provider is constructed before any controller
  mounts and cannot; an Elysia plugin runs at `onStart`, after every route is
  mounted. Never construct a second plugin instance or add a separate devtools
  container.
- `onStart` fires on `listen()`. An application that only calls `handle()`
  publishes nothing and must be unaffected — that is accepted behavior, not a
  defect to work around.
- The bind address defaults to `127.0.0.1` and `host` is what moves it. Loopback
  stays the default because a debugging aid should not be reachable by default;
  the option exists because a container that publishes its port, a remote
  development box, and a phone on the same network are all real cases. A bind
  outside loopback is permitted and never silent, and the row names the concrete
  exposure rather than the abstraction: the `host` option, the address the
  socket took, and `/requests`, because that endpoint records request headers
  and bodies by default. `127.0.0.1`, any `127.x.x.x`, `::1`, and
  `localhost` are the spellings the warning is skipped for. The check is this
  package's own and resolves nothing, so any other name warns; that direction is
  the safe one, because a spelling the pattern cannot be sure of is reported
  rather than assumed. The one name it accepts without resolving is `localhost`,
  and that is stated rather than hidden: a hosts file that mapped `localhost` to
  one of this machine's public addresses would bind it in silence, which is the
  price of a check with no lookup in it. A debugging aid that
  reaches a public interface silently is the failure mode this package exists
  not to have.
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
  stages rather than being reported as one. That rule is read off a release this
  package does not own, so it is re-checked whenever the Elysia peer range moves:
  it holds while Elysia stamps a scope on every hook an instance-level API
  contributes — `"local"` when the caller declares none — and a checksum on the
  hooks of a named plugin. An Elysia that stopped stamping the scope would make an
  unscoped contribution indistinguishable from the compiled hook, and it would
  drop out of the payload silently, which is why a case pins the default stamp.
- `/flow` publishes an interceptor's half only for the classes that declare it.
  The platform calls both halves with an optional call, so a class implementing
  one half runs one half, and a stage for the other would state a step the route
  never runs — the same rule that keeps a `bind`, an `invoke`, a `handler`, and a
  validation slot off the routes that do not have them.
- A half declared as a class **field** is invisible to `/flow`, and that omission
  is this endpoint's one silent gap. The decision is read off each class token's
  `prototype` — the object an instance's methods resolve through — so
  `interceptBefore = () => {}` is an instance property the platform runs and the
  payload reports no stage for, while a half declared as a prototype method is
  reported in full. There is nothing to infer from the other side either: by the
  time a plan is mounted, the platform has lowered the guards and both
  interceptor halves into one `beforeHandle` and one `afterHandle`, so the parts
  are legible only through the tokens the plan carries. Do not derive a stage
  from a token that does not declare one; state the limit where a consumer reads
  the payload, which is what `docs/devtools.md` and the package README do.
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
- `/aot` has two owners, which is why its payload is built per request rather
  than frozen when the socket starts: `graph` and `invokers` are the boot
  record's, and `controllers` is `@aponiajs/cli`'s analysis of the project the
  process was started in — the one fact a boot cannot state, because it belongs
  to a build. The record's half is validated for the two facts this endpoint
  publishes — a graph this release names, and an invoker verdict that is a
  boolean with a reason that is a string or absent — and a record that does not
  carry them serves no `/aot` at all: an application no boot produced, and one a
  copy of the platform this release does not own booted, are the same absence
  `/graph` answers with the dispatcher's `404`. That is the endpoint's first
  degradation axis, and it is an absence rather than a loss: there are no facts to
  publish, so there is nothing to report, and every other endpoint this server
  serves — `/meta` included — answers exactly as it did. The second axis is the
  analysis, which the bullets below state: a record this release can read and a
  project it cannot still answers, with `controllers` empty and one row under
  `Devtools`. The two are not to be collapsed — a reader who sees one axis reads a
  `404` as a surface that failed, and a degraded half as a fact that was never
  there.
- `invokers.reason` is published exactly as the record states it, and a record
  that states none publishes no reason key. A reason belongs to a refusal, so an
  artifact the boot adopted is reported with no reason at all rather than with a
  placeholder or with the selector's sentence restated for a refusal that never
  happened. `accepted` is the running boot's verdict on the artifact it was
  offered, never a prediction about the verdicts beside it, and `/routes` remains
  the endpoint that reports which binding actually serves a mounted route.
- The analyzer is reached through a dynamic import on the first request, never at
  boot. `@aponiajs/cli` carries `ts-morph` and a formatter, so a static import
  would load both into every application that enables the devtools whether or not
  anyone opens `/aot`, while this endpoint is polled by a person and a
  `bun --watch` loop that is never polled pays nothing. The result is cached for
  the life of the process, keyed by project root, and what is cached is the
  promise rather than its result, so two polls arriving together read the project
  once. A failure is cached the same way — one row under `Devtools`, one reading
  of the project rather than a walk per poll — and its cost is stated rather than
  hidden: a project fixed on disk keeps reading as unreadable until the process
  restarts.
- The analysis mirrors `aponia build`'s rules instead of calling it, because the
  command writes files and refuses a project it cannot build while this endpoint
  only reports what a build would decide. The configuration file, the source root
  and its escape guard, the ignore list, the sorted walk, the duplicate class
  name, and the import specifier are repeated from
  `packages/cli/src/generation/invoker-generator.ts` and
  `generation/project-configuration.ts`, with `Bun.Glob` in place of the command's
  `fast-glob` because a runtime package reaches its glob through the runtime. The
  refusal sentences are the command's own, so the row a developer reads here names
  what a build would say about the same project, and `tests/aot.test.ts` reads them
  back out of `generateInvokers` rather than copying them into the case, so a
  wording change on either side fails there instead of shipping. The two rules no
  sentence states are read from the command too: a case holds a controller double
  in a file the build's ignore list leaves out — under both the configured source
  root and the default one — and compares this endpoint's verdict for that project
  with `generateInvokers`' own decision for it, so a change to either copy of the
  ignore list or of the source-root resolution fails there rather than reporting
  verdicts over a file set a build no longer reads. The default
  project is the one mirrored, because `/aot` has no way to name another one. Keep
  the copies in step by hand.
- A handler's verdict is the emitter's, never re-applied here.
  `emitControllerInvokers` decides which handler is emitted and which is declined,
  and the reason beside a `"compiled"` handler is the sentence that emitter
  returned, so the endpoint cannot drift from what the build prints. A handler is
  one property key rather than one route — the emitter keys its invokers by the
  handler, so a method carrying two route decorators is one entry with one verdict
  — and that key rule is the one part of the emitter's output this endpoint cannot
  read back, which is why it lives in one function. A project whose every handler
  was declined is still reported: a build writes no module there and names the
  first decline it found, and those per-handler reasons are exactly what this
  endpoint exists to explain.
- `controllers` is empty exactly when no verdicts are available. A project with no
  configuration file, no controller under its source root, a source root outside
  the project, two controllers sharing a class name, or an analyzer that would not
  load reports once under `Devtools` and leaves the list empty, so a consumer never
  reads "this project declares no controllers" out of a failure. The framework half
  is served either way, which is the degradation this endpoint promises: one field
  group, never the endpoint.
- The log stream is built when the module is registered, not when the socket
  starts, and the logger is patched in place rather than replaced. Registration is
  the only moment this package holds the application's logger before the boot
  writes, so a stream that began at `onStart` would have none of the lines the
  boot reports about itself — the graph it served, the modules it initialized, the
  routes it resolved — which are most of what a log stream is worth. That timing
  is a rule and not an arrangement: a tap moved into the server for tidiness
  silently drops those lines. The logger is the object the application and the
  platform both hold, so a wrapper would be a logger the framework never uses and
  a replacement one the application never sees: patching its methods keeps one
  object, still prints every line it printed before, and records every call
  whatever the logger's own level filter would print, because `LoggerService` has
  no notion of an enabled level and re-applying a rule this package cannot read
  would be enforcing a filter it does not own. A tap is attempted at every level
  on its own, and the boundary is two-sided: a level patched before a refusal is a
  tap that installed, so it records and the stream is published, while a logger
  whose **first** assignment refuses — a frozen one refuses them all — is left as
  it is and earns no endpoint, because that is the shape where a stream would have
  nothing to state and would announce a silence the logger is not keeping. A
  refusal costs one level rather than that level and every one after it: the level
  that refused keeps the method it had and the remaining levels are still
  attempted, which is what makes the stream's level list the whole truth about
  what it can hold. A refusal is either half of the pair a tap needs, and both
  halves are caught per level: a live object — a getter, a `Proxy` — refuses the
  **read** of a level as readily as the assignment to it, and the reachability
  check reads levels too, so a read that escaped would fail the module's
  declaration rather than cost one level, which is the one outcome this package
  may never have. A level nothing can be read from is a level that cannot be
  recorded, answered as a refusal rather than thrown. A tap is this package's
  convenience and never the application's
  contract. One logger records into one stream: a logger this package has already
  answered for is answered with the stream that is recording rather than a second
  one nothing writes into. A logger nothing could be installed on has no stream to
  answer with, so it is answered with the absence again — and, because the tap
  remembers only what it installed, a later tap retries rather than remembering an
  absence as a stream. The stream holds the
  lines written through that one object — the platform's own, and an
  application's where it logs through the same reference, because the container
  hands no logger to a provider, so nothing reaches `/logs` that the application
  did not route through the logger it handed over.
- `DevtoolsOptions.logger` is the application's handover, and however many values
  arrive at it there are two outcomes. A `LoggerService` is tapped and records.
  Everything else publishes no `/logs` at all: the option omitted, `false`, a
  value that is not a logger, which a JavaScript caller can pass whatever the type
  says, and a logger whose first assignment refuses the patch — a frozen one
  refuses them all — where the tap installs nothing and a published stream would
  announce a silence that logger is not keeping. The endpoint states a stream and
  a registration with none to state serves no endpoint, the way a record with no
  compiled root serves no `/graph`, so the dispatcher's `404` is the answer. `false` is not the empty window it once
  answered: it states that the application has no logger object to hand over,
  which is not the fact "nothing is being logged" — an application that passes
  `false` here and a logger to `AponiaFactory.create`, which is what forwarding an
  option value looks like, logs normally, and a registration cannot tell that
  logger from one the factory built for itself. Absence is true in every one of
  those configurations and an empty window is true in only one. The handover is a
  condition this package states rather than hides: the framework never exposes the
  logger it builds for itself, so an array of levels tells the platform to build a
  logger of its own and an application that names one has nothing to hand over.
  The option doc, the README, and `llms.txt` all say so, because the consequence
  is a silent absence otherwise.
- The log buffer is bounded at a capacity this package chooses, because the spec
  bounds the buffer and names no number. One value lives in the logging domain and
  is stated once; the capacity is not a per-call decision, so it is not repeated
  per call site. A forgotten consumer cannot grow the process past it.
- The cursor is the buffer's write count, not an index into what is retained,
  which is what keeps it monotonic across the drops. A `since` older than the
  window slides to the front of it, one ahead of every write answers nothing, and
  neither is an error: the answer always carries the cursor to poll from next, and
  that cursor never goes backwards. The two cursor endpoints read their cursor
  from the query string through `URL` with one reader between them, because one
  rule with two copies is two rules the day one changes, and a `since` that is not
  a safe integer reads as no cursor at all rather than as a `400` a poller cannot
  act on. A negative one is handed to the buffer as it is: the clamp that makes a
  cursor older than the window read what is retained lives there and only there,
  so the endpoints do not restate a rule the buffer already answers.
- An entry is projected to text when the line is written, never when a request
  reads it: a logger's arguments are `unknown`, and an `Error` or a value that
  refers to itself would otherwise fail the payload on the request that asked for
  it. The projection never publishes a stack — a stream a page reads is no place
  for one — and never guesses a logger's own configured context, which is private
  to it; the context is the last string argument the caller named, or empty.
- `/requests` is the one endpoint that publishes what the application **did**
  rather than what it **is**, and everything it records is recorded by default:
  every option under `capture` is an opt-out, because a development tool that
  required two opt-ins before it showed a header is one nobody opens. `false` is
  the shorthand for `{ enabled: false }`, and it is not the `logger` case: the
  requests are the application's own, so a registration that captures nothing
  still serves `/requests` answering an empty record rather than no endpoint, and
  "this registration was told to record nothing" is itself a fact the record
  states.
- A partly patched logger publishes a stream and names the levels it reached. The
  refusal boundary is two-sided — the **first** assignment refusing is the
  absence, a later one is a tap that installed — and the side that publishes is
  all-or-nothing at the endpoint and never at the level, while the level list
  inside the payload is exact. An entry states only the level it was written at,
  so the level list is what tells an absent `debug` line apart from a `debug` level
  the tap never reached; without it those two facts would read the same, and the
  field exists so the payload answers "which levels does this stream hold" rather
  than leaving it to be inferred from a silence. A stream and the endpoint that
  serves it are the whole fact this package has to publish.
- A record is opened by the boot that serves it, one per application, and never at
  registration. The platform hands one registration to every boot of the module
  class that declared it, so a record built when the module registered would be
  one window for every application in the process, and each application's socket
  would serve the traffic of the others. What files one application's record apart
  from another's is the application's own object — `application.store` at
  `onStart`, `context.store` in a hook — which is the one value both halves see
  that belongs to the application rather than to the registration, and its shape
  is Elysia's: this package files by its identity and never reads it. The spec
  states the same boundary from the other side, that the record is in memory per
  boot and a restart is a new record, so a second `listen()` serves a new empty
  window rather than extending one a socket that is gone was serving. That is the
  one place the record parts company with the log stream, whose lines span sockets
  because the object it records does.
- The request-side facts are read at arrival and the answer-side facts at
  completion, and the split is a fact about the installed Elysia rather than a
  preference: by the after-response phase the socket's request no longer states
  its header list — a probe reads an empty `Headers` there, and the six headers a
  client sent as soon as the request phase iterated them — so an entry assembled
  entirely from that context would state that the application answered requests
  carrying no headers at all. The arrival stamp holds the method, the path, the
  query string, and the headers the policy kept, and the completion reads the
  route, the status, the parsed body, and the message the answer published — every
  one of them before the single `await` that reads the answer's body, because the
  context is Elysia's for the duration of the hook. The closing reading is taken
  by the after-response hook itself, as its first statement, before it reads a
  single field off the context: every read the completion side makes is this
  package's own work, and the same reason holds for the one `await`, so a
  duration that included any of them would report work the application never did.
  The reading is handed to `complete`, which never takes one of its own — that is
  what keeps the arrival lookups and the whole of `toRequestRecord` outside the
  measurement rather than merely most of it. The stamp is keyed by the
  `Request` object in a `WeakMap` and spent by the completion that reads it: a
  request this registration never saw ends in nothing at all, because nothing
  stamped it, while one whose answer never reached the hook keeps the entry
  written when it arrived and gains no second one. `arrive` refuses to stamp and
  to write while the policy records nothing, and while no boot has opened a record
  for the application that received the request.
- `durationMs` measures the request from this package's arrival hook to a reading
  the completion hook takes before its first read of the context, and it is
  documented as what it is rather than as what it would ideally be: the route, the
  status, and the parsed body are outside the measurement and the tool does not
  charge the application for reading its own record. It does not exclude
  everything this package does: the arrival hook's own URL and header capture is
  inside, because the opening stamp precedes the reads that need the request
  while it is whole, so the field is not "the time the application spent on the
  route". The microtask spent reading a readable `5xx` answer's published body
  is outside as well, which is why the reading is handed in before that read
  happens rather than taken after it. Narrowing the measurement further means
  moving the opening stamp past the arrival reads it currently precedes, which
  changes what the endpoint reports rather than tidying it.
- A body is read through one serializer with one guard, and a body the serializer
  refuses is stated rather than dropped: `JSON.stringify` throws on a body that
  refers to itself or carries a `BigInt`, both of which an application's own
  validation transform or parse hook can hand a route, and the hook this record is
  written from may not throw. The entry stores the literal `[unserializable]` for
  that body, because `undefined` is reserved for the request that carried none: a
  missing `body` would read as a request with no body, which is a claim about the
  request rather than an absence to leave out. Dropping the guard fails the answer
  the record describes, and dropping the literal turns a body the tool could not
  read into a request that never had one. A literal JSON `null` is that rule read
  the other way: the client carried a body, and the installed Elysia reads it as
  `null` while a request that carried none reads `undefined`, so it is stored as
  the text it arrived as rather than folded into that absence.
- The pair of hooks is two answers a maintainer may not merge, narrow, or make
  return: the arrival hook rides the request phase, which Elysia merges from a used
  plugin unfiltered, while the completion hook is declared `{ as: "global" }`,
  which is the option the installed Elysia reads for an after-response hook to
  reach routes the plugin does not own — with the local scope the record stays
  empty however many requests the application answers. A hook that returned a
  truthy value would be the answer itself, which is the one thing `/requests`
  claims it cannot change. A request a plugin answers by returning a `Response`
  from its own `onRequest` runs no later phase at all, so the completion hook
  never sees it — and the entry written at arrival is what records it, with
  `status` and `durationMs` `null`. That entry is not a fallback that invents an
  answer: it states that this record observed none, which is a fact about the
  request rather than a guess at it, and without it the request would be
  indistinguishable from one that never arrived. Both hook phases run in mount
  order, so the arrival hook records a request only when it runs before whatever
  answers it: a plugin mounted ahead of the devtools registration answers first,
  and this record is not in the path that answered. One request therefore writes
  two entries, and two consequences follow. The id they share is allocated by an
  arrival counter of the capture's own rather than read from the record's write
  count, because that count is the cursor and it counts entries — an id read from
  it would differ between one request's two entries and group nothing. The
  counter is per capture rather than per record, so an id never repeats across
  two boots in one process, because a consumer polling through a `listen()` must
  not group two different requests. And the record's bound counts entries rather
  than requests, at twice the request window it names.
- `path` is the pattern when a route matched and the path that arrived when none
  did, and `/routes` is the table that tells the two apart: a pattern the
  application mounted is in it and a path that arrived without matching one is not.
  The check for a matched route is for a string, because the installed Elysia
  leaves `route` unset rather than empty for everything that matched nothing —
  including a request a plugin refused before matching, which is why a refusal that
  reached the after-response phase is recorded like any other answer. `url` states
  the path and query string as they arrived, so a token passed as a query parameter
  is captured in it: that is a fact about the record rather than a defect in it,
  `url` is what joined to the pattern in `path` tells a consumer what was asked
  for, and `redact` — empty by default — is the answer for an application pointed
  at traffic that is not a development environment's. Redaction replaces a named
  header with the literal and keeps its place, so a consumer can see that one was
  sent and that the tool was told not to show it.
- `error` carries the failure's message: what the answer published, or — for an
  unhandled failure the platform mapped — the exception that mapping answered. It
  is present on a `5xx` whose Problem Details body this after-response hook can
  still read, and on the mapped failure the sentence below names; every other
  failure carries none, because a `4xx` is an answer rather than a
  failure. A `404`, a validation `422`, and an `HttpError` a route threw on purpose
  carry none, and a `5xx` a handler built itself carries none either, because its
  body is the one the client already holds. The mapped failure is the one whose
  message comes from the exception rather than from the answer, and it is read from
  the boot's own record of the exception the mapping answered: the mapping answers
  one fixed sentence for every unhandled failure and its `Response` is not on the
  after-response context either, so without that record this hook could state only
  that an unhandled failure said nothing at all. That record is the platform's,
  handed over at `onStart` and read defensively — a copy of the platform older than
  this release carries no such field, and the entry then states the absence it
  stated before the field existed. The map is consulted only where the published
  body yielded nothing readable, so it never replaces what the client received.
  `error` is still never the context's `error`, and still never the exception's
  stack: this package registers no error hooks and reports an exception where it
  always was, under `ExceptionsHandler` in the log stream, in the one-line
  projection that stream uses and this endpoint restates. `status` is the status
  the client received: `set.status` is a number
  for every answer Elysia composed, while an answer a handler built leaves it at
  the default and carries the real status on its own `Response`.
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
  answer a promise: `/aot`'s analyzer loads itself on its first request.
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

`tests/devtools-module.test.ts` covers the module path and
`tests/devtools-plugin.test.ts` the option path, and the second file is the
counterpart rather than a copy: it asserts the surface, the log stream, the
lifecycle, and the disabled absence over the option, because that is what a
shared construction has to be shown to deliver. Neither file asserts the
build-time decline rule — that rule is `@aponiajs/cli`'s, and its own lanes hold
it.

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

The bind address is asserted through what a start reports, not through what it
returns: the default names `127.0.0.1` and reports no row, each loopback
spelling a registration can name — the address, `localhost`, its other case, and
`::1` — binds without a row, and a host outside loopback binds the address it
named, answers on it, and reports exactly one row naming the `host` option, that
address, and `/requests`. A widened bind that is refused reports the refusal and
no exposure row, because a socket that never started exposed nothing; that case
is also what pins the bracketed form of an IPv6 address, and it names a host
outside loopback — `::` rather than the loopback `::1` — because with a loopback
host no exposure row could appear however the code was ordered, so the guarantee
would be untestable there.

The boundary the socket cases cannot reach is pinned directly, against
`isLoopbackHost`. It is exported from `server/devtools-server.ts` for this
package's own cases, marked `@internal` and deliberately kept off the barrel,
because three of the near misses — `127.1`, `::ffff:127.0.0.1`, and the expanded
`0:0:0:0:0:0:0:1` — bind successfully on this machine: a socket case over them
would report what the resolver did rather than what the check decided, and with
a warning assertion it could not tell an exposure row from a refusal. The case
lists the silent spellings and the reported ones, including `localhost\n` (a
trailing newline is what a copied value carries, and `$` without `m` refuses it),
and reports the spelling that moved rather than a boolean.

`/aot`'s analysis is a project on disk, so its cases write one into a temporary
directory and `process.chdir` into it, restoring the working directory after each
case: the root a build defaults to is the process's own, and the endpoint is
proved over HTTP rather than by calling its builder. Its laziness is proved in a
`Bun.spawnSync` child that reads Bun's module registry before the import, after
it, and after the first request, because the parent process may already hold the
analyzer through another test file's imports — a snapshot taken there could only
ever show that nothing was loaded _again_. The refusals this package mirrors are
asserted against the command's own sentences, which the case reads back by calling
`generateInvokers` with `dryRun` from the same root: a copy of a sentence inside
the case, or a prefix of one, could not tell a faithful mirror from a paraphrase.

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

The log stream is asserted where a test can quietly stop asserting anything: the
ring and the cursor. A read is checked against the exact lines it answers with
rather than their count, the lines are written in an order that fails if the
buffer kept the newest instead of the oldest, and the cases read from three
different cursors — one older than the window, one inside it, one ahead of every
write — so an implementation that treated the cursor as an offset into what is
retained cannot pass. A poll is asserted for what it must _not_ repeat: the
second read names the line written since the first and nothing the first already
saw. The capacity case writes more lines than the buffer holds and states which
ones are gone.

The tap is asserted against a logger the case owns, because what it must not
change is the object: the case keeps its own record of the calls it received and
writes through its own reference, so a tap that swallowed a line, wrapped the
logger instead of patching it, or failed to write through is visible, and the
second-tap case pins that one logger answers with one stream. The refusal is
pinned on both sides it can land on: a logger that refuses its **first** assignment
— a frozen one, asserted by freezing the case's own logger — answers no stream at
all, and one that accepts a level and then refuses the next is a tap that
installed, so it records and publishes with the refusing level keeping its method
and every level after it still patched. What the tap reports about itself is
pinned the same way, against the concrete logger: a level the object does not carry
is not named, a level that refuses its assignment costs only itself — the last
level in the order proves the loop kept going — and the payload a boot serves names
the levels reached, so a stream that never holds `debug` and one whose tap never
reached `debug` are told apart over HTTP rather than only in the tap. The other
half of a refusal is pinned where it is the sharper failure: a level whose getter
throws is a level the tap cannot read, so the case asserts the tap answers rather
than throwing, that the level is not named, and that the levels after it are — and
a logger whose every read throws is answered with no stream at all. The
reachability check is asserted the same way and from its own module, because it
reads levels before the tap does and a throw there fails the declaration: a value
whose readable levels come after an unreadable one, and a `Proxy` that throws on
every read, are both refused rather than thrown out of, with a callable logger
beside them as the control. The module that declares a registration over such a
logger is then booted over HTTP, which is what makes the claim end to end: the
declaration survived the read that threw, and the payload states that level as
unreached. The stream is
then asserted over a real
boot, where the lines the boot wrote before `onStart` must appear — the case a tap
installed when the socket starts would fail, and the assertion that says why the
tap belongs to the registration — and where the application's own next line must
arrive after the cursor the previous answer carried. A registration with no stream
to publish is asserted to serve no endpoint rather than an empty one, and the four
ways of arriving there are pinned separately — an omitted option, `false`, a level
array, the value the option does not accept and a JavaScript caller can still
pass, and a logger whose first assignment refuses the patch — so the rule is
asserted at each end a caller reaches it from rather than by one path, and the
other end — a partly patched logger whose stream must be served — is pinned the
same way.

`/requests` is asserted over the socket, and its cases are the decisions the record
makes rather than the fields it carries. The pair of hooks is pinned where it is a
boundary rather than a style: the scope decision is the case that would leave the
record empty, and the unanswered case pins the entry written at arrival — a request
a plugin answers by returning a `Response` from its own `onRequest` runs no later
phase, so it is recorded once, with `status` and `durationMs` `null`, and the case
asserts that absence rather than the missing entry a completion-only writer would
have left. The two entries of one answered request are pinned together, because
grouping by `id` is the rule the whole shape serves: the pending entry and the
answer share the id, the pending one states `null` where the answer states the
answer, and a poll whose cursor sits between them is served the superseding entry —
the case a consumer stuck on the pending shape would fail. The record's ownership
is asserted from both ends a process can reach: two registrations keep one window
each, and two applications built from one module class — one registration, one
plugin, two applications — keep the first application's traffic out of the second
one's window, which is the case a record held in one variable fails. A second
`listen()` is asserted to serve a new empty window, because the record belongs to
the boot. The policy is asserted at the ends a caller reaches it from: `capture:
false` answers `{ cursor: 0, entries: [] }` and writes no arrival entry either,
the two opt-outs leave their field out of the entry rather than present and empty,
a redacted header keeps its place with the literal, and a body past `bodyLimit` is
cut and marked. What the record
states about an answer is asserted against the answer rather than the exception: a
thrown `HttpError` carries the message the platform published, a `404` and a
handler's own `5xx` carry none, and a handler's own `Response` states the status
the client received rather than the one `set.status` still reads. The unhandled
failure is asserted from the other side, because its message is nowhere on the
answer: the entry the record holds is compared with the line `/logs` states for
the same exception, so the two surfaces cannot drift apart, and a case pins that
the projection publishes no stack — with the presence of `error` asserted before
the comparison, because an absent field would satisfy a `not.toContain` on its
own and prove nothing. The comparison runs over three thrown values — an `Error`,
one that is not, and a value neither projection can state at all — because the
projection has a branch per shape and a case that only ever threw `Error`s could
not tell a faithful restatement from one that agreed on that branch alone; the
third pins the literal both surfaces fall back to, since a value that refuses
`JSON.stringify` and the plain string form alike has to read the same on both.
The projection is also asserted for what it may not do to the request it is
reporting on: a case throws such a value through an application whose logger the
registration has tapped, and requires the client to receive the platform's
Problem Details answer all the same and `/logs` to state a line for it, because
that projection runs inside the patched logger method the platform's error hook
calls, where a throw would replace the application's answer with the engine's own
page. A request that
matched no route is recorded with the path that arrived and shown not to be in
`/routes`, and a request a plugin refused before matching is recorded the same way
with the status its answer carried. Polling is asserted not to add to the record:
the second answer is read from the cursor the first one carried and holds nothing.
The arrival facts are pinned where they are read rather than where they are
written, because the two moments differ: an entry built from the after-response
context alone is the case the header assertions fail. The helpers a case reads the
record through name the half they want, because both entries of a request carry
the same `url` and `method`: a search over the window is a search over the answered
entries, and a case that matched the pending one would read `null` where it expects
an answer.

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
