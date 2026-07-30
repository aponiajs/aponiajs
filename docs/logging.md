# Logging

Aponia follows the Nest system-logging shape while retaining its own product
name. The default logger is enabled during bootstrap and uses the following
sequence:

```text
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaFactory] Starting Aponia application...
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [InstanceLoader] GreetingModule dependencies initialized +2ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [WebSocketsController] ChatGateway {/chat}: +0ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [WebSocketsController] Subscribed to "chat.send" message +0ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RoutesResolver] GreetingController {/greetings}: +1ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RouterExplorer] Mapped {/greetings, GET} route +0ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaApplication] Aponia application successfully started +3ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaApplication] Application is running on: http://localhost:3000 +0ms
```

The lifecycle contexts intentionally mirror the responsibilities in Nest:

- `AponiaFactory` reports bootstrap start;
- `InstanceLoader` reports each initialized module after its providers have
  been instantiated;
- `WebSocketsController` reports each gateway path and subscribed message
  event;
- `RoutesResolver` reports each controller and its base path;
- `RouterExplorer` reports every mapped HTTP method and complete path;
- `AponiaApplication` reports readiness after the server starts listening.

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
context, message, and optional elapsed time.

For production log aggregation, enable newline-delimited JSON:

```ts
const application = await AponiaFactory.create(AppModule, {
  logger: new ConsoleLogger({
    json: true,
  }),
});
```

Each line contains `level`, `pid`, `timestamp`, `message`, and `context`.

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

System events pass their subsystem name as the final parameter, allowing custom
loggers to preserve contextual filtering.
