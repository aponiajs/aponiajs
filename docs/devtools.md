# Devtools

`@aponiajs/devtools` publishes an HTTP API — loopback by default, and widened
only by naming a host — that answers what a running application **is** and what
it **did**: the module graph it compiled, the routes
it actually answers, the stages each route passes through, the lines its logger
wrote, the requests it answered, and what a build decides about its invokers.

It is a leaf package: nothing in the framework depends on it, and an application
installs it deliberately. It ships no UI, no assets, and no browser bundle —
the payloads are the product, and a consumer renders them. Nothing it serves
mutates application state: every endpoint is a read.

The devtools server is a separate `Bun.serve` socket. It registers no route on
the application, so it can be enabled, disabled, or fall over without changing
a single answer the application gives.

## Registration

Registration is the opt-in, and `enabled` is the switch:

```ts
import { Module } from "@aponiajs/common";
import { DevtoolsModule } from "@aponiajs/devtools";

@Module({
  imports: [
    DevtoolsModule.register({
      enabled: Bun.env.NODE_ENV !== "production",
      port: 8000,
      logger: appLogger,
      capture: { redact: ["authorization"] },
    }),
  ],
})
export class AppModule {}
```

| Option    | Meaning                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| `enabled` | Whether the devtools mount at all. Required, and the only required option.                                 |
| `port`    | The port to bind. Defaults to `8000`.                                                                      |
| `host`    | The address to bind. Defaults to `127.0.0.1`; anything outside loopback is reported once under `Devtools`. |
| `logger`  | The logger `/logs` records, or `false`. See [the log stream](#logs).                                       |
| `capture` | What `/requests` records: an opt-out per field, or `false` for none of it.                                 |

`enabled: false` is not a plugin that does nothing. It is an inert module — no
provider, no native plugin, and therefore no socket — so a boot that mounts it
answers exactly as a boot that never imported the package. The condition above
is the application's own decision; the framework never reads an environment
variable on the application's behalf, because an environment variable is not a
security boundary.

A registration is an import of a **dynamic** module, and that has a build-time
consequence. A module is lowered into `descriptors.generated.ts` only when every
`imports`, `controllers`, and `exports` entry names its declaration with a single
identifier, so a root module that declares `DevtoolsModule.register(...)` in its
`imports` is reported as `DECLINED module <Root>: …` and is not lowered. The
platform refuses the artifact whole when it holds no declaration for the root the
application named, so an application whose other modules are still lowered boots
from its decorators instead — the registration mounts, and `/aot` reports
`graph: "decorated"` for the root it compiled. Whether the declared-graph boot is
worth giving up is the application's decision, and
[the last limitation below](#accepted-limitations) states the case where the
cost is a registration that does not mount at all.

### Mounting it without a module import

`devtoolsPlugin` builds the same plugin for the application that cannot put the
registration in an `imports` array — which is every application that wants to
keep booting from its committed descriptor artifact:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { devtoolsPlugin } from "@aponiajs/devtools";

const application = await AponiaFactory.create(AppModule, {
  logger: appLogger,
  plugins: [
    devtoolsPlugin({
      enabled: Bun.env.NODE_ENV !== "production",
      port: 8000,
      logger: appLogger,
    }),
  ],
});
```

It takes the same options, gates on the same `enabled`, and mounts the same
thing: the same socket, the same endpoints, the same log stream, beside the
plugins a module contributes. An entry is an `undefined` rather than an inert
plugin when the registration is disabled, and the factory mounts nothing for
that value, so neither path can produce a boot that believes it mounted a
devtools surface it did not.

The price is the other side of the same coin: no module declares a plugin
mounted this way, so nothing about it reaches the module graph, `bun run
inspect`, or the artifact `aponia build` writes. `imports` is where a plugin
whose source a module can name belongs
([native plugins](./native-plugins.md#the-plugins-option) documents the option
itself); this is for the plugin a module cannot declare, and it is what the
generated application starter does.

Three facts about the socket:

- **The address defaults to `127.0.0.1`, and `host` is what moves it.** A
  debugging aid should not be reachable by default, so a registration that names
  no host gets loopback; the option exists because a container that publishes
  its port, a remote development box, and a phone on the same network are all
  real cases. Widening the bind is permitted and never silent: the start reports
  one row under `Devtools` naming the `host` option, the address the socket
  took, and `/requests` — which records request headers and bodies by default,
  so binding it where the network can reach it puts credentials on the network.
  A row that said only "reachable from the network" would leave the reader to
  guess that. `127.0.0.1`, any `127.x.x.x`, `::1`, and `localhost` are
  the loopback spellings the warning is skipped for; the check names them rather
  than resolving anything, so **any other name is reported**, and every other
  value — `0.0.0.0` included — with it. `localhost` is the one name accepted
  without being resolved, and that is stated rather than hidden: a hosts file
  that mapped it to one of this machine's public addresses would bind it in
  silence. That is the price of a check with no lookup in it, accepted with the
  alternative in view — a resolver in a debugging aid's start path would decide
  what to warn about from the machine it happens to run on.
- **A taken port never fails a boot.** The refused bind is reported under the
  `Devtools` context with the reason, and the application continues without the
  devtools server. Only a start that succeeded becomes the socket the plugin
  holds.
- **`onStart` requires `listen()`.** The devtools API starts when the
  application starts listening, after every route has mounted — which is what
  lets it see the route table. An application that only calls
  `application.handle()` — a test, typically — publishes nothing and is
  unaffected. `close()` stops the devtools socket with the application, so a
  restart binds a fresh one instead of finding the port still held.

## The API

Seven endpoints, all `GET`, all under `/__devtools`:

| Endpoint               | Answers                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `/__devtools/meta`     | The contract version, the releases in play, and the start time        |
| `/__devtools/graph`    | The module graph the boot compiled                                    |
| `/__devtools/routes`   | The routes the application answers, with the binding that serves each |
| `/__devtools/flow`     | The stages each route passes through, and its filters                 |
| `/__devtools/logs`     | The application's log stream, from a cursor                           |
| `/__devtools/requests` | The requests the application answered, from a cursor                  |
| `/__devtools/aot`      | What a build decides, beside what the boot did                        |

```bash
curl http://127.0.0.1:8000/__devtools/meta
```

Any other method answers `405` before the path is read, and a path this server
does not serve answers `404`. Some paths are served conditionally, and the same
`404` is the answer when they are not: an endpoint whose fact the boot record
does not hold is not registered rather than answered with a guess, exactly as a
registration with no log stream to publish serves no `/logs`. The sections below
say which.

### `contract`, and `/meta`

A consumer reads `meta` first and decides whether to proceed:

```ts
{
  contract: 1,              // the version of this wire shape
  framework: "0.6.0-alpha.22", // the release that booted the application
  elysia: "1.4.30",         // the release installed in the application's own tree, or null
  artifacts: {              // which release supplied each adopted artifact
    invokers: null,         // null: the boot adopted none
    descriptors: "0.6.0-alpha.22",
  },
  startedAt: "2026-09-26T12:00:00.000Z",
}
```

`contract` is the one field whose meaning never changes: it is the version of
the payload shape, and it moves when a field changes meaning. `framework` is
independent of it on purpose — a devtools release can read an older boot and has
to say which one it read. For an application no `AponiaFactory` boot produced,
`framework` falls back to the release serving the payload, and every artifact
that boot did not adopt reads `null` rather than a guess.

`elysia` names only an Elysia installed in the application's own tree, found by
walking up from the application rather than through Bun's global install cache,
so a project that installed nothing reads `null` instead of naming a release it
never ran against.

### `/graph`

The compiled module graph: the id of the root module, every module with its
imports, controllers, providers, dependencies and exports, and every gateway
with its events. It describes the graph the boot **compiled** — the descriptor
artifact's graph when the boot adopted one, the lowered declared graph
otherwise — never the decorated classes, and it is the same projection
`bun run inspect` prints.

It carries no `routes` key. The graph states the routes a controller _declares_
while `/routes` states the routes the server _answers_, and publishing both
under one name would leave a consumer choosing between two answers to one
question. `/routes` is authoritative for routes.

A record this release cannot lower — one no boot wrote, or one a copy of the
platform this release does not own wrote — serves no `/graph` at all: the
dispatcher's `404`. There is no fact to publish there, so there is nothing to
report.

### `/routes`

Every route the application answers, read from the mounted table **when the
request arrives**. A route mounted on the native application after the boot
therefore appears too.

```ts
{
  routes: [
    {
      method: "GET",
      path: "/users/:id",
      module: "UsersModule",
      controller: "UsersController",
      handler: "read",
      source: "generated",
      parameters: [{ index: 0, kind: "param", property: "id" }],
    },
  ],
}
```

- `source` is the binding the boot decided on: `"generated"` for a build-time
  invoker, `"compiled"` for the running platform's own compilation or for a
  route a callback mounted, and `null` when no boot recorded the route — a
  native WebSocket route (which reports `"WS"` as its method), or one mounted
  outside the boot. `null` never means "an unknown binding".
- A route no plan and no callback describes reports an empty name rather than a
  guessed one: a callback's route names its module and controller and no
  handler, because the property key that built it exists only while the callback
  runs, and the mounted table keeps no trace of it.
- Entries are sorted by path, method, controller, handler, and module, in
  code-unit order, so two polls of one server answer the same order.

### `/flow`

The stages each mounted route passes through, the order it runs them in, and the
filters that answer when it throws. Read from two sources, because each owns
half of the answer: the mounted route entry owns the hooks and validation slots
Elysia itself holds, and the compiled plan owns the route's guards and
interceptors, which the platform lowers into one `beforeHandle` and one
`afterHandle` where their order is no longer legible.

A stage's `kind` is one of `derive`, `validate`, `resolve`, `hook`, `guard`,
`interceptBefore`, `bind`, `invoke`, `handler`, or `interceptAfter`. A compiled
hook is published as its parts and never as a `hook` stage, each part names the
class it runs and the scope that declared it, and a stage is present only when
the route actually runs it. `id` and `next` are stated per stage, so a renderer
draws a graph rather than assuming a chain.

Filters are a list on the route, never a stage in the chain, because they run
when a guard or the handler threw rather than on every request.

**A limitation to read before trusting `/flow`: an interceptor half declared as
a class field does not appear.** The stage a route runs is decided from the
class tokens the plan carries, read through their `prototype` — the object an
instance's methods resolve through. A half written as a field
(`interceptBefore = () => {}`) is an instance property instead, so the platform
runs it while the payload omits its stage. `/flow`'s answer is complete for
interceptors declared as prototype methods and incomplete for those declared as
fields; the omission is the one part of this endpoint that is silent rather than
stated.

### `/logs`

`GET /__devtools/logs?since=<cursor>` answers `{ cursor, entries }`, where an
entry is `{ level, context, message, timestamp }`. `context` is the last string
argument the caller named — the subsystem name the framework's own logger prints
— or the empty string; the logger's configured context is private to it and is
never guessed at.

**The cursor is the stream's write count, not an index into what is retained.**
It counts every line recorded, including the ones dropped since, which is what
keeps it monotonic and makes it usable as a poll marker. A `since` older than
the retained window is answered with the whole window, and one ahead of every
write with nothing: neither is an error, the answer always carries the cursor to
poll from next, and that cursor never goes backwards. The same rule and the same
shape serve `/requests`.

Recording requires the logger, and the handover is a condition this endpoint
states rather than hides: pass the **same** object to `DevtoolsOptions.logger`
and to `AponiaFactory.create`.

```ts
const application = await AponiaFactory.create(AppModule, { logger: appLogger });
```

The registration patches that object in place — no wrapper, no replacement — so
every line it already printed is still printed through the same object the
application holds, and the stream starts at registration, before the boot
writes: the lines a boot reports about itself are in it. It records every call,
whatever the logger's own level filter would print, because `LoggerService` has
no notion of an enabled level and re-applying a filter this package cannot read
would be enforcing a filter it does not own.

A registration with no stream to publish serves **no `/logs`** — the
dispatcher's `404` — rather than an empty stream, which would announce a silence
the application is not keeping. That is the answer for an omitted option,
`logger: false`, an array of levels (the value that tells the platform to build
a logger of its own, which the application never holds), any value that is not a
logger, and a logger whose **first** assignment refuses the patch.

The all-or-nothing boundary is at the endpoint, not at the level. A logger that
accepts one level and then refuses the next publishes a stream: a tap genuinely
installed, so it records the levels the tap reached, the refusing level keeps the
method it had, and the levels after it are never reached. **The payload does not
say which levels are missing** — an entry states the level it was written at, so
a level absent from a stream has two readings that read the same in the payload:
nothing was written at it, or the tap never reached it. A stream that never
carries `debug` cannot be told from one whose `debug` lines were never written.

### `/requests`

`GET /__devtools/requests?since=<cursor>` answers the same `{ cursor, entries }`
shape over a different record: what the application **did** rather than what it
**is**. The record is written by a pair of hooks the module contributes, not by
the application, so it observes rather than participates — it cannot change what
a route receives or what it answers.

Everything is captured by default, and every option under `capture` is an
opt-out, never a permission. A development tool that required two opt-ins before
it showed a header is one nobody opens.

| Option      | Default | Effect when turned off                                                |
| ----------- | ------- | --------------------------------------------------------------------- |
| `enabled`   | `true`  | Records nothing at all; `false` is shorthand for `{ enabled: false }` |
| `headers`   | `true`  | Leaves `headers` off the entry                                        |
| `body`      | `true`  | Leaves `body` off the entry                                           |
| `bodyLimit` | `16384` | How many characters of a body are stored                              |
| `redact`    | `[]`    | Empty by default: the tool shows what arrived                         |

An entry carries:

```ts
{
  method: "POST",
  path: "/users",            // the pattern that matched, or the path that arrived
  url: "/users?page=1",      // the path and query string as they arrived
  status: 201,
  durationMs: 3.2,
  timestamp: "2026-09-26T12:00:00.000Z",
  headers: { authorization: "[redacted]", "content-type": "application/json" },
  body: "{\"name\":\"Ada\"}",
}
```

An opt-out is observable on the wire: a field left out is absent, which is a
different fact from a request that carried none. Four further rules:

- **A token passed as a query parameter is captured in `url`.** That is a fact
  about the record rather than a defect in it — `url` is what joined to the
  pattern in `path` tells a consumer what was asked for — and `capture.redact`
  is the answer for an application pointed at traffic that is not a development
  environment's. Redaction replaces a named header with `[redacted]` and keeps
  its place, so a consumer can see that one was sent and that the tool was told
  not to show it.
- **A body the client sent is stated, never dropped.** One this package cannot
  serialize is stored as `[unserializable]`, and one that arrived as a literal
  JSON `null` is stored as the text `null`: `undefined` is reserved for the
  request that carried none, so a missing `body` never stands for a body the
  client sent.
- **A request that matched no route is recorded, and the record says so**:
  `path` carries the path that arrived rather than a pattern, and `/routes` is
  the table that tells the two apart, because a pattern the application mounted
  is in it and a path that arrived without matching one is not.
- **`error` is what the answer published, never the exception.** It is present on
  a `5xx` whose Problem Details body this hook can still read — the message is
  that body's `detail` — and absent everywhere else. A `4xx` is an answer rather
  than a failure, so a `404`, a validation `422`, and an `HttpError` a route
  threw on purpose all carry none; an unhandled failure the platform mapped and a
  `5xx` a handler built itself carry none either, because their `Response` cannot
  be read from where the record is written. An exception is reported where it
  always was, under `ExceptionsHandler` in `/logs`.

The record belongs to one application and one boot: a second `listen()` serves a
new empty window rather than extending one a socket that is gone was serving.

`durationMs` is measured from the moment the request reached this package's
arrival hook to a reading taken at the entry of the completion hook. The closing
reading now precedes the reads this package makes of the answer, so the route,
the status, and the parsed body it stores are outside the measurement — as is the
one `await` that reads a readable `5xx` answer's published body, which is why that
read happens after the stamp. The arrival hook's own URL and header capture is
still inside it, because the opening stamp is that hook's first statement and the
reads which need the request while it is whole necessarily follow it. The field is
therefore the time from arrival to the completion hook's entry with this package's
answer-side work taken out, and it is not a CPU profile of the handler.

### `/aot`

What a build decided, beside what the boot did with it. The two halves have
different owners and fail differently.

- `graph` — `"declared"` or `"decorated"` — is which root the container
  compiled, and `invokers` is the boot's verdict on the generated invoker
  artifact: `accepted`, and the refusal's own sentence in `reason` when there was
  one. There is **no `reason` key at all** when there was no refusal, because a
  reason belongs to a refusal.
- `controllers` is `@aponiajs/cli`'s analysis of the project the process was
  started in — the source root `aponia.json` names, walked the way `aponia build`
  walks it — giving each `@Controller()` class and, per handler, `"generated"`
  when the emitter renders an invoker for it or `"compiled"` when it declines,
  with the emitter's own reason. A handler is one property key, however many
  routes its decorators declare.

`graph` states the shape of the root that was compiled, never what the project
declares, so **`"declared"` is not an endorsement of your source**. A root module
that registers a dynamic module is declined by `aponia build`, and where nothing
else could be declared the artifact the project already had keeps serving: such
an application reports `graph: "declared"` for a source tree that declares a
registration the compiled graph does not carry, and `/__devtools` never mounts.
`"decorated"` is the other side of that same decline, taken when other modules
were still lowered — the registration is in the graph it names, and the
declared-graph boot was given up for it. The `DECLINED module` line a build
prints is what separates the two, and [the limitation
below](#accepted-limitations) states the same case from the build's side.

`@aponiajs/cli` is imported on the first request to this endpoint and never at
boot, because it carries `ts-morph` and a formatter an application that never
polls the endpoint should not load. The result — including a failure — is cached
for the life of the process, so a project fixed on disk keeps reading as
unreadable until the process restarts.

The two degradations are different and are not to be collapsed:

- A record that does not state the two boot facts this endpoint publishes serves
  **no `/aot`** — the dispatcher's `404` — while every other endpoint keeps
  answering. That is an absence: there is nothing to publish.
- A record this release can read beside a project the analysis cannot still
  answers, with `controllers` empty and one row under `Devtools` naming why. That
  is a degraded half, not an absence, and `controllers` is empty exactly when no
  verdicts are available — never as a way of saying "this project declares no
  controllers".

## Accepted limitations

These are the boundaries this package states rather than hides.

- **Data freshness is per boot.** The server publishes what it read at startup.
  In development `bun --watch` restarts on every save, so this is current; a
  long-running process does not re-read the filesystem. `/routes` and `/flow` are
  the exceptions by design: the mounted route table belongs to the running
  application, which may mount another route before it listens.
- **`onStart` requires `listen()`.** An application that only uses `handle()`
  publishes nothing.
- **A stale invoker artifact is still served.** If a handler's parameter
  decorators change and the committed artifact is not regenerated, the platform
  uses the stale invoker and binds the handler's arguments as the old source
  described. The version stamp catches release drift, not source drift. This
  package reports what happened; it does not prevent it.
- **`elysiaController` callback routes appear in `/routes` but contribute no
  symbol-keyed handler name.** They are read off the mounted application, which
  knows the path and method but not the class property that built them.
- **A root module that registers the devtools is not lowered into the descriptor
  artifact.** The build declines it, because a registration is a call and an
  `imports` entry has to be a single identifier. Where other modules are still
  lowered the artifact is rewritten without the root, the boot refuses it and
  compiles the decorated graph instead: the registration mounts, and the
  declared-graph boot is given up. Where the root is the only module a build can
  lower, no descriptor is written at all, so the artifact on disk keeps serving
  the graph it already held — a graph without the registration — and the
  registration appears to do nothing. That silence is why the `DECLINED module`
  line a build prints is the one to read, and
  [`devtoolsPlugin`](#mounting-it-without-a-module-import) is the way around the
  whole limitation: an option is not an `imports` entry, so the root stays
  declarable and the surface still mounts.
- **A class-field interceptor half is invisible to `/flow`.** The platform runs
  it; the payload omits its stage. See [`/flow`](#flow).
- **A partly patched logger's stream does not name the levels it missed.** See
  [`/logs`](#logs).
- **`durationMs` still includes this package's own reading of the request at
  arrival.** The completion side's reads are outside it, but the arrival hook's
  URL and header capture sits between the two stamps. See
  [`/requests`](#requests).
- **The request record is not complete.** A request refused before a route
  matched has no route identity: the entry carries the path it asked for and
  names no controller, module, or handler. A request the runtime never reached —
  one the server itself rejected, or one whose client disconnected before an
  answer — is not recorded at all. The record says what the application
  answered, not everything that was asked of it.
- **Response bodies are not captured.** Buffering every answer costs in
  proportion to the traffic rather than to the question being asked, and the
  request is usually what is being debugged. An application whose answers are
  worth recording has `application.handle` and its own tests.

## Documentation

- [Package README](../packages/devtools/README.md): the option surface and the
  endpoint contract in brief.
- [Logging](./logging.md): the logger `/logs` records.
- [Introspection](./introspection.md): the projection `/graph` publishes.
- [Execution enhancers](./enhancers.md): the stages `/flow` reports.
- [Published packages](./packages.md): the npm catalog.
