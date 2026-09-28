# Logging

Aponia follows the Nest system-logging shape while retaining its own product
name. The default logger is enabled during bootstrap and uses the following
sequence:

```text
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaFactory] Starting Aponia application...
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RoutesResolver] Booting GreetingModule from the generated module descriptors, so the declared graph serves this application. +1ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [InstanceLoader] GreetingModule dependencies initialized +2ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RoutesResolver] GreetingController {/greetings}: +1ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RouterExplorer] Mapped {/greetings, GET} route +0ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [WebSocketsController] ChatGateway {/chat}: +0ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [WebSocketsController] Subscribed to "chat.send" message +0ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaApplication] Aponia application successfully started +3ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaApplication] Application is running on: http://localhost:3000 +0ms
```

The lifecycle contexts intentionally mirror the responsibilities in Nest:

- `AponiaFactory` reports bootstrap start;
- `RoutesResolver` reports which graph serves the application before anything is
  lowered, then each controller and its base path;
- `InstanceLoader` reports each initialized module after its providers have
  been instantiated;
- `WebSocketsController` reports each gateway path and subscribed message
  event;
- `RouterExplorer` reports every mapped HTTP method and complete path;
- `AponiaApplication` reports readiness after the server starts listening, and
  reports a failure that stopped `listen()`.

`RoutesResolver` is also where a supplied artifact is reported as refused. Both
the generated route invokers and the generated module descriptors record the
framework release they were built against, and neither is used when that release
is not the one running; the module descriptors are also not used when they hold no
declaration for the root module the application names. Each case logs one line
naming what it read, and the application boots from the decorated declarations it
was given, so a stale generated file shows up in the log as a cold start rather
than as a route that behaves unexpectedly.

The displayed address comes from the Elysia/Bun server instance after the
listener has started. It is not assembled from the requested port.

The same value is available programmatically:

```ts
await application.listen(3000);
console.log(application.getUrl());
```

Calling `getUrl()` before `listen()` throws an
`APPLICATION_NOT_LISTENING` error.

## Application options

Logging is enabled by default:

```ts
const application = await AponiaFactory.create(AppModule);
```

Disable all system logs:

```ts
const application = await AponiaFactory.create(AppModule, {
  logger: false,
});
```

Enable a maximum verbosity. Levels are cascading, so `log` includes `warn`,
`error`, and `fatal`:

```ts
const application = await AponiaFactory.create(AppModule, {
  logger: ["error", "warn", "log"],
});
```

Supported levels are `fatal`, `error`, `warn`, `log`, `debug`, and `verbose`.

## Console logger

Use `ConsoleLogger` when output formatting must be configured:

```ts
import { ConsoleLogger } from "@aponiajs/common";

const application = await AponiaFactory.create(AppModule, {
  logger: new ConsoleLogger({
    colors: false,
    prefix: "Orders",
    timestamp: true,
  }),
});
```

The text format contains the prefix, process ID, local timestamp, aligned level,
message, and optional elapsed time, with the context between the level and the
message when one resolves.

For production log aggregation, enable newline-delimited JSON:

```ts
const application = await AponiaFactory.create(AppModule, {
  logger: new ConsoleLogger({
    json: true,
  }),
});
```

Each JSON line carries `level`, `pid`, and `timestamp`, plus `message` and, when
one resolves, `context`. A `context` that resolves to nothing is left out rather
than written empty. A `message` `JSON.stringify` refuses is not dropped: the line
is written again with `[unrenderable]` in the `message` field. One it drops
without refusing — because the value, or what its `toJSON()` returns, is
`undefined`, a function, or a symbol — leaves no `message` field at all. The
[custom logger](#custom-logger) section states how a context resolves.

## Application logging

Feature code can use the same context-based style:

```ts
import { Injectable, Logger } from "@aponiajs/common";

@Injectable()
export class GreetingService {
  private readonly logger = new Logger(GreetingService.name);

  createGreeting(): string {
    this.logger.log("Creating greeting");
    return "Hello, AponiaJS!";
  }
}
```

## Custom logger

Pass any implementation of `LoggerService` to replace the system logger:

```ts
import type { LoggerService } from "@aponiajs/common";

class ApplicationLogger implements LoggerService {
  log(message: unknown, ...parameters: unknown[]): void {}
  fatal(message: unknown, ...parameters: unknown[]): void {}
  error(message: unknown, ...parameters: unknown[]): void {}
  warn(message: unknown, ...parameters: unknown[]): void {}
  debug(message: unknown, ...parameters: unknown[]): void {}
  verbose(message: unknown, ...parameters: unknown[]): void {}
}

const application = await AponiaFactory.create(AppModule, {
  logger: new ApplicationLogger(),
});
```

The lifecycle lines pass their subsystem name as the final parameter, which lets
a custom logger tell the subsystems apart. The context a call states is that
final argument after the message, when it is a string. `ConsoleLogger` falls
back to its own — the one it was constructed with, or the last `setContext()`
named — while a logger you write sees only the argument.

A method of your logger may throw. The framework never reads a successful call as a promise this
contract makes, so it guards the call sites that report a failure: an unhandled failure is reported
through `error` from inside the route's error hook — whose return value is the response the client
receives — and a declared filter that throws is reported the same way before the route's error path
declines to what answers next, so the Problem Details response is returned whether or not the logger
reported the failure. `listen` guards its report too, so the failure the caller is handed is still the
engine's. The stopping half of the lifecycle guards its report as well, so a teardown hook that throws
while the application is closing is reported and the remaining hooks still run: one pool that refuses to
close cannot stop `close()` from finishing. The devtools surface guards the row it writes for a project
whose route analysis could not be read, so a logger that refuses it
cannot turn `/aot`'s degraded half into a
failed request. A logger that refuses at any of those sites is reported on `stderr` by a direct write
rather than swallowed — the line naming the refusal as well as the report — because the channel that
would normally carry the diagnostic is the one that failed. Everywhere else a throw is a throw — the
framework guards the sites that report a failure and not the ones that report progress, so a logger that
fails while the boot logs its routes fails the boot. The framework's own logger needs no such care for
the value it is handed: `ConsoleLogger` renders that value, or states the literal a value it cannot
render reads as.

## Stating a value

`renderLogValue` turns a logged value into the text a surface states it in: a string is its own text,
a function is its name, an `Error` is its name and message with no stack, and everything else is its
JSON form with the plain string form behind it. A value that refuses both of those forms is stated as
`[unrenderable]` rather than allowed to throw, so a surface can report any value it is handed — a
thrown one included — without the report becoming a failure of its own. Two surfaces in this framework
record a thrown value, and both state one through it: the devtools log stream's entry for a line, and
the exception the platform's default mapping records for `/requests`. One definition rather than a copy
each, so two surfaces reporting one failure cannot disagree about it, and the literal a value that
refuses everything is stated as is the same word on both by construction. Reach for it when you publish
a surface of your own and need to state a value the way the framework's does. The console logger prints
its own form for a terminal reader and answers the same literal when a value refuses it.
