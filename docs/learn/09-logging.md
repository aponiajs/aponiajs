# 09 · Logging

**Use when:** reading bootstrap output, quieting it in tests, or sending logs
somewhere else.

The default logger prints Nest-shaped lifecycle lines:

```text
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaFactory] Starting Aponia application...
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [InstanceLoader] GreetingModule dependencies initialized +2ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RoutesResolver] GreetingController {/greetings}: +1ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RouterExplorer] Mapped {/greetings, GET} route +0ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaApplication] Application is running on: http://localhost:3000 +0ms
```

Each context names a responsibility: `AponiaFactory` for bootstrap start,
`InstanceLoader` for an initialized module, `RoutesResolver` for a controller,
`RouterExplorer` for a mapped route, `AponiaApplication` for readiness.

## Three configurations

```ts
await AponiaFactory.create(AppModule); // default logger
await AponiaFactory.create(AppModule, { logger: false }); // silent
await AponiaFactory.create(AppModule, { logger: ["error"] }); // filtered levels
await AponiaFactory.create(AppModule, { logger: myLogger }); // your LoggerService
```

Levels cascade, so `log` includes `warn`, `error`, and `fatal`. Tests normally
pass `{ logger: false }`.

The address in the final line comes from the running server, not from the
requested port, and is also available as `application.getUrl()`. Calling it
before `listen()` throws `APPLICATION_NOT_LISTENING`.

Next: [10 · Errors](./10-errors.md) · Deep dive: [logging](../logging.md)
