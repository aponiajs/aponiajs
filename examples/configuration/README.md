# Configuration

The application declares the shape of its configuration once. `src/config.ts` holds the
Standard Schema and the transform that gives the application the names it reads,
`AppModule` declares the provider that validates the process environment while the
application boots, `AppService` receives the validated value by injection, and
`src/main.ts` listens on the port it reads back through `application.get(AppConfig)`.

Nothing reads a key twice and nothing coerces a string by hand: `PORT=abc` fails the boot
with `INVALID_CONFIGURATION_VALUE` and an issue whose `path` names `PORT`, where
`Number(Bun.env.PORT ?? 3100)` would have passed `NaN` to `listen`.

## Run

```bash
bun run example:configuration
```

The port comes from `PORT`, defaulting to `3100`; `SERVICE_NAME` renames the service the
route reports.

## Test

```bash
bun run --cwd examples/configuration test
```

`test/configuration.e2e-spec.ts` boots the real module against an environment the test
chooses — saving and restoring every key it sets, because the example reads the process
environment by design. It asserts the transformed value the route reports, the schema's
default when the key is absent, the refusal of `PORT=abc` with the key named in
`details.issues`, and that `application.get(AppConfig)` answers the one object the
container cached.
