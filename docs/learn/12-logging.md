# 12 · Logging

**Use when:** reading bootstrap output, quieting tests, or sending logs elsewhere.

The default logger prints Nest-shaped lifecycle lines:

```text
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [InstanceLoader] GreetingModule dependencies initialized +2ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RoutesResolver] GreetingController {/greetings}: +1ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RouterExplorer] Mapped {/greetings, GET} route +0ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaApplication] Application is running on: http://localhost:3000 +0ms
```

`AponiaFactory` reports bootstrap start, `InstanceLoader` reports initialized modules, `RoutesResolver` reports controllers, `RouterExplorer` reports mapped routes, and `AponiaApplication` reports readiness and listen failures.

## Configuration

```ts
await AponiaFactory.create(AppModule); // default logger
await AponiaFactory.create(AppModule, { logger: false }); // silent
await AponiaFactory.create(AppModule, { logger: ["error"] }); // filtered levels
await AponiaFactory.create(AppModule, { logger: myLogger }); // custom logger
```

Levels cascade, so `log` includes `warn`, `error`, and `fatal`. Tests normally pass `{ logger: false }`.

A custom `LoggerService` implements `log`, `fatal`, `error`, and `warn`. `debug` and `verbose` are optional.

The address in the final line comes from the running server and is available as `application.getUrl()`. Calling it before `listen()` throws `APPLICATION_NOT_LISTENING`.

Next: [13 · Native plugins](./13-native-plugins.md) · Deep dive: [logging](../build/logging.md)
