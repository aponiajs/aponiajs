# 14 · Devtools

**Use when:** you want to see what the running application compiled and what it
answered, without adding a route to it or a log line to a handler.

`@aponiajs/devtools` starts a second HTTP server beside the application, on
loopback, and serves what the boot compiled and what the application did. It is
a leaf package an application installs deliberately, and it is not part of the
runtime: removing it changes nothing about how an application answers.

```bash
bun add @aponiajs/devtools
```

## Register it

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

`enabled` is the switch, and it is the application's decision — the framework
never reads an environment variable on your behalf, because an environment
variable is not a security boundary.

A registration is a dynamic module, and `aponia build` lowers a module only when
every `imports` entry is a single identifier: the module that declares one is
reported as `DECLINED`. So the registration is paid for — an application whose
other modules are still lowered boots from its decorators instead, and one whose
every module is declined keeps serving the descriptor artifact it already had,
which carries no registration. Both cases are in [the guide](../devtools.md),
and the `DECLINED module` line a build prints is what tells you which one you
are in.

`logger` is the application's handover: pass the **same** object you give
`AponiaFactory.create`.

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { appLogger } from "./logger.ts";

const application = await AponiaFactory.create(AppModule, { logger: appLogger });
```

The registration patches that logger in place, so everything it already prints
it still prints, and the lines the boot reports about itself are in the stream
from the beginning. A registration with no logger to record from serves no
`/logs` at all rather than an empty stream — a silence the application is not
keeping is not what a `200` should say.

| Option    | Meaning                                                     |
| --------- | ----------------------------------------------------------- |
| `enabled` | Whether the devtools mount at all. Required.                |
| `port`    | The loopback port to bind. Defaults to `8000`.              |
| `logger`  | The logger `/logs` records, or `false`.                     |
| `capture` | What `/requests` records: an opt-out per field, or `false`. |

## Read it

While the application listens, `http://127.0.0.1:8000/__devtools` answers seven
`GET` endpoints:

| Endpoint   | Answers                                                    |
| ---------- | ---------------------------------------------------------- |
| `meta`     | The contract version, the releases in play, the start time |
| `graph`    | The module graph the boot compiled                         |
| `routes`   | The routes the application actually answers                |
| `flow`     | The stages each route passes through, and its filters      |
| `logs`     | The log stream, from a cursor                              |
| `requests` | The requests the application answered, from a cursor       |
| `aot`      | What a build decided about the project's invokers          |

```bash
curl http://127.0.0.1:8000/__devtools/routes
```

`meta` comes first for a consumer, because it carries `contract` — the version
of the wire shape every other payload obeys. The cursor endpoints answer
`{ cursor, entries }` and are polled: send the cursor the previous answer
carried, and the answer holds the entries written since. The cursor never goes
backwards, and a cursor older than the retained window or ahead of every write
is answered with what there is rather than an error.

## Three answers this chapter will not let you misread

- **A class-field interceptor half does not appear in `/flow`.** The stage a
  route runs is decided from the class tokens the plan carries, read through
  their `prototype`, so a half written as a field
  (`interceptBefore = () => {}`) runs while the payload omits its stage. An
  interceptor declared as a prototype method is reported in full.
- **A partly patchable logger's stream does not say what it missed.** If the
  logger accepts one level and refuses the next, the stream covers the levels
  the tap reached, and no entry states that the others are missing — a stream
  that never carries `debug` and one whose `debug` lines were never written
  look the same.
- **`durationMs` measures the hook, not the route.** It starts at the arrival
  hook and ends after this package has read the route, the status, and the
  parsed body, so this package's own reads of the request and the answer are
  inside it.

The full list, including what the record leaves out on purpose, is in
[the devtools guide](../devtools.md).

## What it is not

No UI, no assets, no browser bundle: the payloads are the product and a consumer
renders them. No route on the application. Nothing it serves mutates application
state — every endpoint is a read. The address is always `127.0.0.1`, with no
option to widen it, and a port it cannot take is reported under `Devtools` and
leaves the application running.

Next: nothing — this is the last chapter. ·
Deep dive: [devtools](../devtools.md)
