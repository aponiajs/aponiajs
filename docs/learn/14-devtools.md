# 14 · Devtools

**Use when:** you want to see what the running application compiled and what
answered every request that reached the record, without adding a log line to a
handler.

`@aponiajs/devtools` mounts an HTTP API on the application itself, under
`/__devtools`, on the address the application already answers. It is a leaf
package an application installs deliberately: nothing in the framework depends
on it, and mounting it registers its wildcard route on the application's own
table — remove the registration and the application answers its own `404` for
`/__devtools/meta`, and `/routes` and `/flow` lose the row the mount contributes.

```bash
bun add @aponiajs/devtools@beta
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
framework never reads an environment variable to choose its own behaviour,
because an environment variable is not a security boundary. An application that
declares a configuration reads one itself, through
[`provideConfiguration`](../configuration.md); that read is the application's,
not the framework's. A registration that is not
enabled mounts nothing at all on either path: an inert module on one, and an
`undefined` the factory mounts nothing for on the other.

The module spelling has a build-time cost. `aponia build` lowers an `imports`
entry only when it is a single identifier naming a declaration read from the
project's own source, and a registration returns a `DynamicModule` rather than
such a declaration, so the module that names one is reported as `DECLINED` in
every spelling. The artifact the build leaves behind then holds no declaration
for that root — it is written without the module, or replaced with an empty
record when that root was the only module a build could have lowered — so the
boot refuses it and compiles the decorated graph instead: the registration
mounts, and the declared-graph boot is given up. The option spelling is the way
around it: it is not an `imports` entry, so the root stays declarable. It pays
for that with the graph instead: no module declares the plugin, so `bun run
inspect` does not list it and no generated artifact carries it. Both prices are
in [the guide](../devtools.md), and the `DECLINED module` line a build prints
names the declaration behind it.

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
| `logger`  | The logger `/logs` records, or `false`.                     |
| `capture` | What `/requests` records: an opt-out per field, or `false`. |

The surface is a mount rather than a server: it registers one wildcard route,
`ALL /__devtools/*`, on the application's own route table. Two consequences
follow, and both are the point rather than accidents. It answers wherever the
application answers — under `application.handle()` as well as `listen()` — and an
application route that claims a devtools path wins it, because the two owners sit
in one table and the more specific route answers. And it is reachable wherever
the application is, so `enabled` is how an application keeps it out of
production: this is a development surface, and `/requests` records request
headers and bodies by default with no warning. A registration names no port and
no host, because the application already owns both.

## Read it

While the application listens, `http://localhost:3000/__devtools` answers seven
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
curl http://localhost:3000/__devtools/routes
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
carrying the same `id`, so you group by `id` and keep the last entry each request
has in the window you read. An entry whose `status` is `null` is a request the
record saw arrive and read no answer for — the record's own view, not a promise
about the application: a poll that lagged more than one window behind never reads
an answer FIFO eviction already dropped. The record belongs to the application
rather than to a listener, so a second `listen()` continues the same window
instead of starting an empty one.

## Three answers this chapter will not let you misread

- **An interceptor half is a stage because the route runs it.** Which halves run
  is the boot's own record, read from the instance the platform calls, so a half
  written as a class field (`interceptBefore = () => {}`) is published like any
  other. The fallback below is where that rule stops holding: a stage list derived
  from a `prototype` can disagree with what runs in both directions. A record that
  carries no such field — a copy of the platform older than
  this release — falls back to each class token's `prototype`, which answers for
  the class the token names rather than for the object the platform calls, so it
  is wrong in both directions: it publishes a half only when that token declares
  one there, which omits a field-declared half, and it states one for a token
  whose provider supplied an object of another shape — the object the platform
  calls in its place.
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
  while it is whole — and so is the pending entry's build and write, which the
  stamp also precedes.

The full list, including what the record leaves out on purpose, is in
[the devtools guide](../devtools.md).

## What it is not

No UI, no assets, no browser bundle: the payloads are the product and a consumer
renders them. Nothing it serves mutates application state — every endpoint is a
read. Its one wildcard route lives in the application's own table, so `/routes`
and `/flow` report one more row, `ALL /__devtools/*`, than the same application
without the surface, and an application route that claims a devtools path wins
it.

Next: [15 · Files](./15-files.md) · Deep dive: [devtools](../devtools.md)
