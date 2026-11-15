# 09 · Logging

**Use when:** reading bootstrap output, quieting it in tests, or sending logs
somewhere else.

The default logger prints Nest-shaped lifecycle lines:

```text
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaFactory] Starting Aponia application...
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [InstanceLoader] GreetingModule dependencies initialized +2ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RoutesResolver] GreetingController {/greetings}: +1ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RouterExplorer] Mapped {/greetings, GET} route +0ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaApplication] Aponia application successfully started +3ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaApplication] Application is running on: http://localhost:3000 +0ms
```

Each context names a responsibility: `AponiaFactory` for bootstrap start,
`InstanceLoader` for an initialized module, `RoutesResolver` for a controller,
`RouterExplorer` for a mapped route, `AponiaApplication` for readiness and for a
failure that stopped `listen()`.

## Configurations

```ts
await AponiaFactory.create(AppModule); // default logger
await AponiaFactory.create(AppModule, { logger: false }); // silent
await AponiaFactory.create(AppModule, { logger: ["error"] }); // filtered levels
await AponiaFactory.create(AppModule, { logger: myLogger }); // your LoggerService
```

Levels cascade, so `log` includes `warn`, `error`, and `fatal`. Tests normally
pass `{ logger: false }`.

A `LoggerService` of your own implements `log`, `fatal`, `error`, and `warn`;
`debug` and `verbose` are optional, so a logger that has only the four is
complete. The lifecycle lines in the sample above pass their subsystem name —
`RoutesResolver`, `InstanceLoader` — as the final string argument, and a logger
that keeps it can tell the subsystems apart. A method may throw, which is why the
framework guards some calls and not others; [the logging
reference](../logging.md#custom-logger) states which, and what happens to a
logger that refuses at one.

The address in the final line comes from the running server, not from the
requested port, and is also available as `application.getUrl()`. Calling it
before `listen()` throws `APPLICATION_NOT_LISTENING`.

Next: [10 · Errors](./10-errors.md) · Deep dive: [logging](../logging.md)
