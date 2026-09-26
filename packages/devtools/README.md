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

- **Disabled mounts nothing.** A disabled registration is an inert module: no
  provider, no plugin, and no socket.
- **Enabled is a plugin, not a provider.** The devtools plugin runs at
  `onStart`, after every route has mounted, which is what lets it see the route
  table a boot-time provider cannot.
- **`onStart` requires `listen()`.** An application that only calls `handle()`
  publishes nothing and is otherwise unaffected.
- **Loopback only.** The devtools server binds `127.0.0.1` on `port` (default
  `8000`), with no way to widen the address.
- **The log stream is the application's own, and it is handed over twice.** Pass
  the same logger to `DevtoolsModule.register` and to `AponiaFactory.create`:
  registration patches that object **in place**, so every line it writes — the
  framework's and the application's — is recorded without anything being replaced,
  and the stream starts there, before the boot writes, so the lines a boot reports
  about itself are in it. That is the condition this option states rather than
  hides: the framework never exposes the logger it builds for itself, so an
  application that names `false`, names a level array, or names nothing at all has
  no object to record from, and a registration that names one of those serves no
  `/logs` rather than an empty stream that would read as "nothing is being logged".
  The patch is a
  mutation of a logger the application holds too, and the stream holds the lines
  written through that one object — the platform's own, and an application's where
  it logs through the same reference, because the container hands no logger to a
  provider.
- **A taken port never fails a boot.** The refused bind is reported under
  `Devtools`, and the application continues without the devtools server.
- **The socket stops with the application.** `close()` stops the devtools server
  the plugin started, so a restart binds a fresh socket instead of finding the
  port still held.
- **`GET /__devtools/meta` is the contract.** It answers the devtools contract
  version, the release that booted the application, the Elysia release installed
  in the application's own tree (`null` when there is none), which release
  supplied each artifact the boot adopted (`null` for one it did not), and when
  the server started.
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
  as its own `error` array is, with the Problem Details mapping last.
- **`GET /__devtools/logs?since=<cursor>` streams what the application logged.**
  The registration takes the logger the application also gives
  `AponiaFactory.create`, patches it in place, and records every line into a
  bounded buffer from the moment the module registers — and a registration with no
  logger object to record from, because it named none, named `false`, or named
  something that is not one, serves no `/logs` rather than an empty stream.
  Each poll names the cursor the previous answer carried and is answered with
  `{ cursor, entries }`, where an entry is `{ level, context, message, timestamp }`.
  A cursor older than the retained window is answered with what is retained and
  one ahead of every write with nothing: neither is an error, and the cursor never
  goes backwards.
- Every endpoint is a `GET`: any other method answers `405` before the path is
  read, and a path the server does not serve answers `404`.

```bash
curl http://127.0.0.1:8000/__devtools/meta
```

## Documentation

- [Published packages](../../docs/packages.md): the npm catalog and install
  commands.
- [Repository guide](../../AGENTS.md): how the framework is organized.
