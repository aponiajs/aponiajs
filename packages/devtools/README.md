# @aponiajs/devtools

```bash
bun add @aponiajs/devtools
```

Opt-in devtools for a running Aponia application. The package is a leaf: nothing
in the framework depends on it, and an application installs it deliberately.

**It requires Bun at runtime.** The surface is built on the runtime's own
globals: `import.meta.dir` while the handler build resolves the Elysia the
application installed, and `Bun.Glob` and `Bun.file` while `/aot` reads the
project. A Node process cannot serve this mount — `import.meta.dir` reads
`undefined` there, so a request through the mount fails in the handler build and
answers `500` where the same boot answers `200` under Bun. The requirement
belongs to the surface rather than to the framework around it: the platform, the
container, and the generators run wherever an Aponia application runs, and an
application that never registers this package never loads it.

The surface is a mount, not a server: it registers one wildcard route,
`ALL /__devtools/*`, on the application's own route table, and answers wherever
the application answers — under `application.handle()` as well as `listen()`.
Two consequences follow, and both are the owner's decision rather than a side
effect. An application route that claims a devtools path wins it, because the two
owners sit in one table and the more specific route answers. And the surface is
reachable wherever the application is, so `enabled` is how an application keeps
it out of production: this is a development surface, and `/requests` records
request headers and bodies by default with no warning. A registration names no
port and no host, because the application already owns both.

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
  `enabled` gate, the same plugin: the same mount at the same path, the same
  endpoints, the same
  log stream, beside the plugins a module contributes. `devtoolsPlugin` answers
  `undefined` when the registration is disabled, and the factory mounts nothing
  for that value — not an inert plugin — so neither path can produce a boot that
  believes it mounted a surface it did not.
- **Disabled mounts nothing.** A disabled registration is an inert module on the
  module path and an `undefined` entry on the option path: no provider, no
  plugin, and no route either way.
- **Enabled is a plugin, not a provider.** The plugin is merged into the root
  application where a module contributes it, so its wildcard route and its
  request hooks sit in the application's own route table beside the routes a
  controller mounted — which a boot-time provider could not do.
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
- **The surface is a route, so `/routes` and `/flow` report it.** A
  devtools-enabled application carries one more row than the same application
  without it — `ALL /__devtools/*` for the mount, which `/routes` reports as the
  table really is rather than re-deriving one without it.
- **The surface stops with the application.** `close()` removes its route with
  the application, so nothing outlives the listener that mounted it.
- **The log stream is the application's own, and it is handed over twice.** Pass
  the same logger to the registration — `DevtoolsModule.register` or
  `devtoolsPlugin` — and to `AponiaFactory.create`:
  registration patches that object **in place**, so every line it writes — the
  framework's and the application's — is recorded without anything being replaced,
  and the stream starts there, before the boot writes, so the lines a boot reports
  about itself are in it. That is the condition this option states rather than
  hides: the framework never exposes the logger it builds for itself, so an
  application that names `false`, names a level array, or names nothing at all has
  no object to record from, and a logger no level could be patched on — every
  assignment refused, as a frozen one refuses them all — records nothing either; a
  registration with no stream to publish serves no `/logs` rather than an empty
  stream that would read as "nothing is being logged". The boundary is the number
  of levels patched, never where the first refusal landed: a logger the tap
  patched at least one level of — one that accepts a level and refuses the next,
  or one whose `log` refuses while its `fatal` accepts — publishes its stream, and
  the payload names the levels the tap reached, so a level it could not patch — one
  the logger does not declare, or one that refused the assignment — is stated as
  unreached rather than left to be inferred from an absent entry. The one filter
  the stream cannot read is the logger's own: `LoggerService` has no notion of an
  enabled level, so a line the console would have suppressed is still recorded.
  The patch is a mutation of a logger the application holds too, and the stream
  holds the lines written through that one object — the platform's own, and an
  application's where it logs through the same reference, because the container
  hands no logger to a provider.
- **`GET /__devtools/meta` is the contract.** It answers the devtools contract
  version, the release that booted the application, the Elysia release installed
  in the application's own tree (`null` when there is none), which release
  supplied each artifact the boot adopted (`null` for one it did not), and when
  it first answered for this application. A reader checks `contract` first and proceeds only on a
  shape it knows: this release answers `2`, because a `/requests` entry gained
  `id`, its `status` and `durationMs` became nullable, and one request began
  writing two entries.
- **`GET /__devtools/graph` describes the graph the application compiled.** It
  answers the modules with their imports, controllers, providers, dependencies
  and exports, and the WebSocket gateways with their events. The graph is the one
  the boot compiled — the descriptor artifact's when it adopted one — never the
  decorated classes it replaced, and it carries no routes: a route a controller
  declares and a route the application answers are two different questions.
- **`GET /__devtools/routes` reports the routes the application answers.** The
  table is read when the request arrives, so a route mounted on the native
  application after the boot appears too. Each route carries the method and path
  the table states, the module, controller and handler the boot recorded, the
  context fields its handler binds, and `source`: `"generated"` when a build-time
  invoker serves it, `"compiled"` when the running platform does, or `null` when
  no boot recorded it — a native WebSocket route, or a route mounted outside the
  boot — or when the record states a binding this release does not write, which a
  foreign copy of the platform can. A route no plan and no callback describes reports empty names rather than
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
  as its own `error` array is, with the Problem Details mapping last. Which
  interceptor halves a route runs is the boot's own record, read from the
  instance the platform calls while the class resolved, so a half written as a
  class field (`interceptBefore = () => {}`) is reported like any other. A
  record that carries no such field — a copy of the platform older than this
  release — falls back to each class token's `prototype`, which answers for the
  class the token names rather than for the object the platform calls, so it is
  wrong in both directions: it publishes a half only when that token declares
  one there, which omits a field-declared half, and it states one for a token
  whose provider supplied an object of another shape — the object the platform
  calls in its place.
- **`GET /__devtools/logs?since=<cursor>` streams what the application logged.**
  The registration takes the logger the application also gives
  `AponiaFactory.create`, patches it in place, and records every line into a
  bounded buffer from the moment the module registers — and a registration with no
  stream to serve, because it named none, named `false`, named something that is
  not a logger, or named one no level could be patched on, serves no `/logs`
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
  by it and takes the last entry each request has in the window it reads — the
  answer wherever the answer is still there to read. One configuration is where
  it is not, and the absence is the poll's rather than the application's: a
  consumer lagging more than one window behind never reads an answer FIFO eviction
  has already dropped. The first entry is written when
  the request arrives and states `status: null` and `durationMs: null` — this
  record saw the request and read no answer for it, which is neither an invented
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
  one; `error` carries the failure's message
  — what the answer published, or, for an unhandled failure the platform mapped,
  the exception that mapping answered — so it is present on a `5xx` whose Problem
  Details body the tool can read and on that mapped failure, absent on a `4xx`,
  which is an answer rather than a failure, and absent where there is nothing to
  read: a `5xx` a handler built itself. An unhandled failure the platform mapped is the one failure whose
  message comes from the exception rather than the answer: the mapping answers one
  fixed sentence for every such failure and its `Response` is not on the
  after-response context either, so the boot records the exception the mapping
  answered, and the entry publishes the same account `/logs` states for it, with no
  stack, both through one definition — `@aponiajs/common`'s `renderLogValue` —
  rather than through a copy each, so the two surfaces cannot disagree about one
  failure. That rendering does not fold, so a message that itself spans lines is
  published with them; the fold-to-one-line rendering is the other one, this
  package's own `oneLine`, which the row written for a failure of its own
  guard — the route analysis it could not read —
  embeds, and it answers the literal `[unrenderable]` for any value whose read
  refuses, including a value the shared rendering still states — `{}`, or
  `[object Object]`. A thrown value neither
  can state reads as the
  literal `[unrenderable]` on both, because that rendering is total: it runs in
  the route's own `error` hook before the answer is built, and the logger call
  beneath it is guarded, so a logger that refuses the line is announced on
  `stderr` rather than costing the answer. Everything is recorded by default —
  `capture` is an opt-out on each field, never a permission, because a tool that
  needed two opt-ins before it showed a header is one nobody opens. Two facts are
  stated rather than softened: a token passed as a query parameter is captured in
  `url`, which is what `capture.redact` is for, and a request that matched no
  route has no pattern to report — `path` carries the path that arrived, and
  `/routes` is the table that tells the two apart. The record belongs to one
  application rather than to a listener, so a second `listen()` continues it
  rather than beginning a new one. One boundary
  is Elysia's rather than this package's: both hook phases run in mount order, so a
  plugin mounted ahead of the devtools registration that answers from its own
  `onRequest` ends the request before this record's hook runs, and that request
  appears nowhere.
  `durationMs` is measured from the moment the request reached this package's
  arrival hook to a reading the completion path takes before its first read of
  the context — so the route, the status, the parsed body, and the one microtask
  spent reading a readable `5xx` answer's published body are outside it. The
  arrival hook's own URL and header capture is still inside, because the opening
  stamp precedes the reads that need the request while it is whole, and so is the
  pending entry's build and write, because the stamp precedes those too — so the
  field is not "the time the application spent on the route".
- **`GET /__devtools/aot` reports what a build decided beside what the boot did
  with it.** `graph` and `invokers` are the boot record's: which root the
  container compiled, and the boot's verdict on the generated invoker artifact,
  with the refusal's own sentence — and no `reason` key at all when there was no
  refusal, because a reason belongs to a refusal. `graph` states the shape of the
  root that was compiled, never what the project declares: `"declared"` is not an
  endorsement of your source, and the silent case above reports it for a
  registration the compiled graph does not carry. `controllers` is the verdict
  `aponia build` reaches for the project the application was started in: every
  `@Controller()` class its analysis reads, and per handler — one entry per
  property key, however many routes it declares — `"generated"` when the emitter
  renders an invoker for it, `"compiled"` when it declines and the running
  platform keeps compiling it, with the emitter's own reason. `@aponiajs/cli` is
  imported on the first request to this endpoint and never at boot, because it
  carries `ts-morph` and a formatter that an application which never polls this
  endpoint should not load; the analysis is read once per process, and an
  unreachable one leaves `controllers` empty and reports why once under
  `Devtools` rather than failing the endpoint or answering it per poll. That
  report is guarded, so a logger that throws on it
  cannot turn the degraded half into a failed request. The
  project root is the process's working directory — the same root `aponia build`
  defaults to — and the endpoint is served only for a record that states the two
  boot facts it publishes. Two failures are not one: a record that states neither
  is a path this surface does not serve — the dispatcher's `404`, with `/meta` and
  the rest of the surface answering as they always did — while a project the
  analysis cannot read still answers, with the boot's half beside an empty
  controller list.
- Every endpoint is a `GET`: any other method answers `405` before the path is
  read, and a path the surface does not serve answers `404`.

```bash
curl http://localhost:3000/__devtools/meta
```

## Documentation

- [Devtools guide](../../docs/devtools.md): the endpoint contract, the accepted
  limitations, and how a consumer polls it.
- [Published packages](../../docs/packages.md): the npm catalog and install
  commands.
- [Repository guide](../../AGENTS.md): how the framework is organized.
