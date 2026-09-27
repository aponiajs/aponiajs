# @aponiajs/devtools

```bash
bun add @aponiajs/devtools
```

Opt-in devtools for a running Aponia application. The package is a leaf: nothing
in the framework depends on it, and an application installs it deliberately.

Registration is the opt-in, and `enabled` is the switch:

```ts
import { Module } from "@aponiajs/common";
import { DevtoolsModule } from "@aponiajs/devtools";

@Module({
  imports: [
    DevtoolsModule.register({
      enabled: Bun.env.NODE_ENV !== "production",
    }),
  ],
})
export class AppModule {}
```

The second spelling mounts the same plugin through
`AponiaFactory.create`'s `plugins` option, for the application that cannot put
the registration in an `imports` array:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { devtoolsPlugin } from "@aponiajs/devtools";

const application = await AponiaFactory.create(AppModule, {
  plugins: [
    devtoolsPlugin({
      enabled: Bun.env.NODE_ENV !== "production",
      logger: appLogger,
    }),
  ],
});
```

- **Both spellings mount the same thing.** The same options object, the same
  `enabled` gate, the same plugin: the same socket, the same endpoints, the same
  log stream, beside the plugins a module contributes. `devtoolsPlugin` answers
  `undefined` when the registration is disabled, and the factory mounts nothing
  for that value — not an inert plugin — so neither path can produce a boot that
  believes it mounted a surface it did not.
- **Disabled mounts nothing.** A disabled registration is an inert module on the
  module path and an `undefined` entry on the option path: no provider, no
  plugin, and no socket either way.
- **Enabled is a plugin, not a provider.** The devtools plugin runs at
  `onStart`, after every route has mounted, which is what lets it see the route
  table a boot-time provider cannot.
- **The module path costs the root module its generated descriptor.** A
  registration is a call, and `aponia build` lowers a module only when every
  `imports` entry is a single identifier, so the module that declares it is
  reported as `DECLINED module <Root>: …`. An application that hands over that
  artifact then boots from decorators instead — the registration mounts and the
  declared-graph boot is given up — and one whose root is the only module a build
  can lower gets no descriptor written at all, so the artifact on disk keeps
  serving the graph it already held and the registration does not mount. Read the
  `DECLINED module` line a build prints. `devtoolsPlugin` is the way around the
  whole limitation: an option is not an `imports` entry, so the root stays
  declarable.
- **The option path is not in the module graph.** No module declares the plugin,
  so nothing about it reaches `bun run inspect` or the artifact
  `aponia build` writes. That is the price of the bullet above, not a defect in
  it, and `imports` stays the place for a plugin a module can name.
- **`onStart` requires `listen()`.** An application that only calls `handle()`
  publishes nothing and is otherwise unaffected.
- **Loopback by default.** The default is loopback because a debugging aid
  should not be reachable by default. The devtools server binds `127.0.0.1` on
  `port` (default `8000`) unless `host` names another address, which a container
  that publishes its port, a remote development box, and a phone on the same
  network may all need. A bind outside loopback is never silent: the start
  reports one row under `Devtools` naming the `host` option, the address the
  socket took, and `/requests` — which records request headers and bodies by
  default, so the row states what is now reachable rather than leaving the
  reader to infer it. `127.0.0.1`, any `127.x.x.x`, `::1`, and `localhost` are
  the loopback spellings the warning is skipped for; the check is this package's
  own and resolves nothing, so any other name warns. `localhost` is the one name
  accepted without being resolved, and that is stated rather than hidden: a
  hosts file that mapped it to one of this machine's public addresses would bind
  it in silence.
- **The log stream is the application's own, and it is handed over twice.** Pass
  the same logger to the registration — `DevtoolsModule.register` or
  `devtoolsPlugin` — and to `AponiaFactory.create`:
  registration patches that object **in place**, so every line it writes — the
  framework's and the application's — is recorded without anything being replaced,
  and the stream starts there, before the boot writes, so the lines a boot reports
  about itself are in it. That is the condition this option states rather than
  hides: the framework never exposes the logger it builds for itself, so an
  application that names `false`, names a level array, or names nothing at all has
  no object to record from, and a logger whose first level refuses the patch — a
  frozen one refuses every level — records nothing either; a registration with no
  stream to publish serves no `/logs` rather than an empty stream that would read
  as "nothing is being logged". A logger that accepts one level and refuses the
  next is not that case: a level was patched, so the stream is served, and the
  payload names the levels the tap reached, so a level it could not patch — one
  the logger does not declare, or one that refused the assignment — is stated as
  unreached rather than left to be inferred from an absent entry. The one filter
  the stream cannot read is the logger's own: `LoggerService` has no notion of an
  enabled level, so a line the console would have suppressed is still recorded.
  The patch is a mutation of a logger the application holds too, and the stream
  holds the lines written through that one object — the platform's own, and an
  application's where it logs through the same reference, because the container
  hands no logger to a provider.
- **A taken port never fails a boot.** The refused bind is reported under
  `Devtools`, and the application continues without the devtools server.
- **The socket stops with the application.** `close()` stops the devtools server
  the plugin started, so a restart binds a fresh socket instead of finding the
  port still held.
- **`GET /__devtools/meta` is the contract.** It answers the devtools contract
  version, the release that booted the application, the Elysia release installed
  in the application's own tree (`null` when there is none), which release
  supplied each artifact the boot adopted (`null` for one it did not), and when
  the server started. A reader checks `contract` first and proceeds only on a
  shape it knows: this release answers `2`, because a `/requests` entry gained
  `id`, its `status` and `durationMs` became nullable, and one request began
  writing two entries.
- **`GET /__devtools/graph` describes the graph the application compiled.** It
  answers the modules with their imports, controllers, providers, dependencies
  and exports, and the WebSocket gateways with their events. The graph is the one
  the boot compiled — the descriptor artifact's when it adopted one — never the
  decorated classes it replaced, and it carries no routes: a route a controller
  declares and a route the server answers are two different questions.
- **`GET /__devtools/routes` reports the routes the application answers.** The
  table is read when the request arrives, so a route mounted on the native
  application after the boot appears too. Each route carries the method and path
  the table states, the module, controller and handler the boot recorded, the
  context fields its handler binds, and `source`: `"generated"` when a build-time
  invoker serves it, `"compiled"` when the running platform does, or `null` when
  no boot recorded it — a native WebSocket route, or a route mounted outside the
  boot. A route no plan and no callback describes reports empty names rather than
  guessed ones, which is also what a callback's route reports for its handler:
  the property key that built it exists only while the callback runs.
- **`GET /__devtools/flow` reports the stages each route passes through.** The
  stages a route's own hooks and schema state — a plugin's `derive` and
  `resolve`, any other lifecycle hook, and each validation slot — are read from
  the mounted table when the request arrives, which is why this payload has no
  boot-time variant. The stages its enhancers state — a `guard`, an
  `interceptBefore`, an `interceptAfter` — come from the compiled plan, because
  the platform lowers them into one `beforeHandle` and one `afterHandle` where
  their order is no longer legible; each names the class it runs and the scope
  that declared it. A compiled hook is published as its parts and never as a
  hook stage, and a contributed hook can only be identified — by the checksum
  Elysia stamps, never by a plugin name the route does not carry. The route's
  filters are a list beside the stages rather than a stage in the chain, ordered
  as its own `error` array is, with the Problem Details mapping last. One
  limitation is stated rather than hidden: an interceptor half declared as a
  class field (`interceptBefore = () => {}`) does not appear. The stage a route
  runs is decided from the class tokens the plan carries, read through their
  `prototype` — the object an instance's methods resolve through — so a field is
  run while its stage is omitted. A half declared as a prototype method is
  reported in full.
- **`GET /__devtools/logs?since=<cursor>` streams what the application logged.**
  The registration takes the logger the application also gives
  `AponiaFactory.create`, patches it in place, and records every line into a
  bounded buffer from the moment the module registers — and a registration with no
  stream to serve, because it named none, named `false`, named something that is
  not a logger, or named one whose first level refuses the patch, serves no `/logs`
  rather than an empty stream.
  Each poll names the cursor the previous answer carried and is answered with
  `{ cursor, entries, levels }`, where an entry is
  `{ level, context, message, timestamp }` and `levels` names the `LoggerService`
  levels the tap reached on the logger it was handed.
  A cursor older than the retained window is answered with what is retained and
  one ahead of every write with nothing: neither is an error, and the cursor never
  goes backwards.
- **`GET /__devtools/requests?since=<cursor>` reports the requests that reached
  the record, and what answered them.** The record is `/logs`' cursor rules over a
  different fact — every other endpoint says what the application _is_, this one
  says what it _did_ — so each poll names the cursor the previous answer carried
  and is answered with `{ cursor, entries }` under them, including an empty record
  when a registration was told to capture nothing. It carries no `levels`, because
  a request has no level to report, and its cursor counts entries rather than
  requests: one request writes two of them. An entry carries
  `id`, and **one request's two entries carry the same `id`**, so a consumer groups
  by it and takes the last entry for each request. The first entry is written when
  the request arrives and states `status: null` and `durationMs: null` — this
  record saw the request and saw nothing answer it, which is neither an invented
  status nor a missing entry, and is what makes a request a plugin answered from
  its own `onRequest` legible instead of absent. The second is written when the
  answer completes, and carries the
  `method`, the `path` (the route pattern that matched, or the path that arrived
  when none did), the `url` as it arrived, the `status`, the `durationMs`, the
  `timestamp`, the request's `headers`, and the `body` the route parsed, truncated
  at `capture.bodyLimit`, while a body this package cannot serialize — a cyclic
  one, or one carrying a `BigInt`, which an application's own validation can make
  — is stored as `[unserializable]` rather than left out, because a missing `body`
  would read as a request that carried none; a body that arrived as a literal JSON
  `null` is stored as the text `null` for the same reason, since the client carried
  one; `error` is what the answer published
  and never the exception, so it is present on a `5xx` whose Problem Details body
  the tool can read, absent on a `4xx`, which is an answer rather than a failure,
  and absent where there is nothing to read — a `5xx` a handler built itself. An
  unhandled failure the platform mapped is the second source rather than a second
  exception to the rule: the mapping's answer is not on the after-response context
  either, so the boot records the message it mapped as it answers, and the entry
  publishes the same one-line account `/logs` states for the exception, with no
  stack. Everything is recorded by default —
  `capture` is an opt-out on each field, never a permission, because a tool that
  needed two opt-ins before it showed a header is one nobody opens. Two facts are
  stated rather than softened: a token passed as a query parameter is captured in
  `url`, which is what `capture.redact` is for, and a request that matched no
  route has no pattern to report — `path` carries the path that arrived, and
  `/routes` is the table that tells the two apart. The record belongs to one
  application and one boot, so a second `listen()` begins a new one. One boundary
  is Elysia's rather than this package's: both hook phases run in mount order, so a
  plugin mounted ahead of the devtools registration that answers from its own
  `onRequest` ends the request before this record's hook runs, and that request
  appears nowhere.
  `durationMs` is measured from the moment the request reached this package's
  arrival hook to a reading the completion path takes before its first read of
  the context — so the route, the status, the parsed body, and the one microtask
  spent reading a readable `5xx` answer's published body are outside it. The
  arrival hook's own URL and header capture is still inside, because the opening
  stamp precedes the reads that need the request while it is whole, so the field
  is not "the time the application spent on the route".
- **`GET /__devtools/aot` reports what a build decided beside what the boot did
  with it.** `graph` and `invokers` are the boot record's: which root the
  container compiled, and the boot's verdict on the generated invoker artifact,
  with the refusal's own sentence — and no `reason` key at all when there was no
  refusal, because a reason belongs to a refusal. `graph` states the shape of the
  root that was compiled, never what the project declares: `"declared"` is not an
  endorsement of your source, and the silent case above reports it for a
  registration the compiled graph does not carry. `controllers` is the verdict
  `aponia build` reaches for the project the server was started in: every
  `@Controller()` class its analysis reads, and per handler — one entry per
  property key, however many routes it declares — `"generated"` when the emitter
  renders an invoker for it, `"compiled"` when it declines and the running
  platform keeps compiling it, with the emitter's own reason. `@aponiajs/cli` is
  imported on the first request to this endpoint and never at boot, because it
  carries `ts-morph` and a formatter that an application which never polls this
  endpoint should not load; the analysis is read once per process, and an
  unreachable one leaves `controllers` empty and reports why once under
  `Devtools` rather than failing the endpoint or answering it per poll. The
  project root is the process's working directory — the same root `aponia build`
  defaults to — and the endpoint is served only for a record that states the two
  boot facts it publishes. Two failures are not one: a record that states neither
  is a path this server does not serve — the dispatcher's `404`, with `/meta` and
  the rest of the surface answering as they always did — while a project the
  analysis cannot read still answers, with the boot's half beside an empty
  controller list.
- Every endpoint is a `GET`: any other method answers `405` before the path is
  read, and a path the server does not serve answers `404`.

```bash
curl http://127.0.0.1:8000/__devtools/meta
```

## Documentation

- [Devtools guide](../../docs/devtools.md): the endpoint contract, the accepted
  limitations, and how a consumer polls it.
- [Published packages](../../docs/packages.md): the npm catalog and install
  commands.
- [Repository guide](../../AGENTS.md): how the framework is organized.
