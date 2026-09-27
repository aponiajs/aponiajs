# 14 · Devtools

**Use when:** you want to see what the running application compiled and what
answered every request that reached it, without adding a route to it or a log
line to a handler.

`@aponiajs/devtools` starts a second HTTP server beside the application — on
loopback unless the registration names another host — and serves what the boot
compiled and what the application did. It is
a leaf package an application installs deliberately, and it is not part of the
runtime: removing it changes nothing about how an application answers.

```bash
bun add @aponiajs/devtools
```

## Register it

Two spellings mount the same plugin, and the difference is what a build can read
rather than what runs. The factory option is the one that keeps an application
booting from its generated descriptor artifact:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { devtoolsPlugin } from "@aponiajs/devtools";
import { appLogger } from "./logger.ts";

const application = await AponiaFactory.create(AppModule, {
  logger: appLogger,
  plugins: [devtoolsPlugin({ enabled: Bun.env.NODE_ENV !== "production", logger: appLogger })],
});
```

The other spelling is a module import:

```ts
import { Module } from "@aponiajs/common";
import { DevtoolsModule } from "@aponiajs/devtools";

@Module({
  imports: [
    DevtoolsModule.register({
      enabled: Bun.env.NODE_ENV !== "production",
      logger: appLogger,
    }),
  ],
})
export class AppModule {}
```

`enabled` is the switch on both, and it is the application's decision — the
framework never reads an environment variable on your behalf, because an
environment variable is not a security boundary. A registration that is not
enabled mounts nothing at all on either path: an inert module on one, and an
`undefined` the factory mounts nothing for on the other.

The module spelling has a build-time cost. A registration is a call expression,
and `aponia build` lowers a module only when every `imports` entry names its
declaration with a single identifier, so the module that declares one is
reported as `DECLINED`. Where other modules are still lowered the boot then
compiles the decorated graph instead — the declared-graph boot is given up — and
where every module is declined the artifact on disk keeps serving the graph it
already had, which carries no registration, so the devtools never mount and
nothing says so. The option spelling is the way out of both: it is not an
`imports` entry, so the root stays declarable. It pays for that with the graph
instead: no module declares the plugin, so `bun run inspect` does not list it and
no generated artifact carries it. Both prices are in
[the guide](../devtools.md), and the `DECLINED module` line a build prints is
what tells you which case you are in.

`logger` is the application's handover: pass the **same** object you give
`AponiaFactory.create`, whether you hand it to the module or to `devtoolsPlugin`.

The registration patches that logger in place, so everything it already prints
it still prints, and the lines the boot reports about itself are in the stream
from the beginning. A registration with no logger to record from serves no
`/logs` at all rather than an empty stream — a silence the application is not
keeping is not what a `200` should say.

| Option    | Meaning                                                     |
| --------- | ----------------------------------------------------------- |
| `enabled` | Whether the devtools mount at all. Required.                |
| `port`    | The port to bind. Defaults to `8000`.                       |
| `host`    | The address to bind. Defaults to `127.0.0.1`.               |
| `logger`  | The logger `/logs` records, or `false`.                     |
| `capture` | What `/requests` records: an opt-out per field, or `false`. |

The default address is loopback because a debugging aid should not be reachable
by default. `host` exists because a container that publishes its port, a remote
development box, and a phone on the same network are all real cases — and a bind
outside loopback is never silent: the start reports one row under `Devtools`
naming the `host` option, the address the socket took, and `/requests`, which
records request headers and bodies by default. `127.0.0.1`, anything in
`127.x.x.x`, `::1`, and `localhost` are the loopback spellings the row is
skipped for; the check is syntactic and resolves nothing, so any other name
reports. `localhost` is the one name accepted without being resolved, so a hosts
file that mapped it to one of this machine's public addresses would bind it in
silence — the price of a check with no lookup in it.

## Read it

While the application listens, `http://127.0.0.1:8000/__devtools` answers seven
`GET` endpoints:

| Endpoint   | Answers                                                     |
| ---------- | ----------------------------------------------------------- |
| `meta`     | The contract version, the releases in play, the start time  |
| `graph`    | The module graph the boot compiled                          |
| `routes`   | The routes the application actually answers                 |
| `flow`     | The stages each route passes through, and its filters       |
| `logs`     | The log stream, from a cursor                               |
| `requests` | Every request that reached the record, and what answered it |
| `aot`      | What a build decided about the project's invokers           |

```bash
curl http://127.0.0.1:8000/__devtools/routes
```

`meta` comes first for a consumer, because it carries `contract` — the version
of the wire shape every other payload obeys. The cursor endpoints are polled:
send the cursor the previous answer carried, and the answer holds the entries
written since. `/logs` answers `{ cursor, entries, levels }` — `levels` being the
`LoggerService` levels the tap reached — and `/requests` answers
`{ cursor, entries }`, because a request has no level. The cursor never goes
backwards, and a cursor older than the retained window or ahead of every write
is answered with what there is rather than an error. `/requests` counts entries
rather than requests, and that is the one thing to know about its shape: a
request writes one entry when it arrives and a second when it is answered, both
carrying the same `id`, so you group by `id` and keep the last entry for each.
An entry whose `status` is `null` is a request the record saw arrive and never
saw answered.

## Three answers this chapter will not let you misread

- **A class-field interceptor half does not appear in `/flow`.** The stage a
  route runs is decided from the class tokens the plan carries, read through
  their `prototype`, so a half written as a field
  (`interceptBefore = () => {}`) runs while the payload omits its stage. An
  interceptor declared as a prototype method is reported in full.
- **A stream states the levels it reached.** If the logger accepts one level and
  refuses the next, the stream covers every level it could patch and names them in
  `levels`; the level that refused is absent from that list, so a stream that never
  carries `debug` and one whose `debug` lines were never written are told apart
  rather than read the same.
- **A stream records the calls, not what the console printed.** `LoggerService`
  has no notion of an enabled level, so a line the logger's own filter would have
  suppressed is still in the stream.
- **`durationMs` measures the hook, not the route.** It starts at the arrival
  hook and ends before the completion hook reads anything at all, so everything
  the completion side does — the route, the status, and the parsed body among it
  — is outside the measurement. The arrival hook's own URL and header capture is
  inside, because the opening stamp comes before the reads that need the request
  while it is whole.

The full list, including what the record leaves out on purpose, is in
[the devtools guide](../devtools.md).

## What it is not

No UI, no assets, no browser bundle: the payloads are the product and a consumer
renders them. No route on the application. Nothing it serves mutates application
state — every endpoint is a read. The address is `127.0.0.1` unless you name a
`host`, and a port it cannot take is reported under `Devtools` and leaves the
application running.

Next: nothing — this is the last chapter. ·
Deep dive: [devtools](../devtools.md)
