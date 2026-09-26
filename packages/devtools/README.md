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
- **The log stream is the application's own.** The boot record names the logger
  the application logs through — the object the factory built or the one it was
  handed, whichever the application asked for — and starting the devtools server
  patches that object **in place** so every line it writes is recorded without
  the application handing anything over twice. The patch is a mutation of a
  logger the platform and the application both hold, and it is the only way to
  see the lines: a wrapper would see only what goes through the wrapper. The
  stream holds what was written through that one object, and the container hands
  no logger to a provider, so a provider's own logger is not part of it.
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
  The stream is the logger the boot decided on, read from the boot record and
  recorded from the moment the socket starts — so the lines the application
  writes while it serves are the lines this answers, whatever it named at the
  factory: a `LoggerService`, a list of levels, or nothing at all. `logger: false`
  publishes the stream empty, and an application no boot produced serves no
  `/logs`. Each poll names the cursor the previous answer carried and is answered
  with `{ cursor, entries }`, where an entry is
  `{ level, context, message, timestamp }`. A cursor older than the retained
  window is answered with what is retained and one ahead of every write with
  nothing: neither is an error, and the cursor never goes backwards.
- Every endpoint is a `GET`: any other method answers `405` before the path is
  read, and a path the server does not serve answers `404`.

```bash
curl http://127.0.0.1:8000/__devtools/meta
```

## Documentation

- [Published packages](../../docs/packages.md): the npm catalog and install
  commands.
- [Repository guide](../../AGENTS.md): how the framework is organized.
