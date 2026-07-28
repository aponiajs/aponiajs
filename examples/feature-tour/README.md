# Feature tour example

Every implemented AponiaJS use case in one runnable application. Source
directories and test files are numbered by use case, so a file name says what it
demonstrates: `basic-foundation` is the smallest possible application, this one
is the map.

## Source layout

```text
src/
|-- 01-providers/           value, factory, class, and alias providers
|   |-- provider-tokens.ts          tokens for the values that are not classes
|   |-- settings.service.ts         a class provider built from those tokens
|   |-- settings.controller.ts      reads the resolved values over HTTP
|   `-- providers.module.ts         one exported surface, one private provider
|-- 02-modules/             module imports, exports, and shared singletons
|   |-- catalog.service.ts          business behavior, injected by constructor
|   `-- catalog.module.ts           imports 01, exports its own service
|-- 03-validation/          Standard Schema and platform-native validation
|   |-- item.schema.ts              Zod body, Elysia `t` query and headers
|   |-- validation.controller.ts    routes that answer 422 on bad input
|   `-- validation.module.ts
|-- 04-http-methods/        every HTTP method decorator on one resource
|   |-- http-methods.controller.ts
|   `-- http-methods.module.ts
|-- 05-request-parameters/  every parameter decorator, named and whole
|   |-- request-parameters.controller.ts
|   `-- request-parameters.module.ts
|-- 06-native-plugins/      native Elysia plugins, mounted and typed
|   |-- clock.plugin.ts             decorate, state, global/scoped/local derive
|   |-- budget.plugin.ts            a plugin configured from the container
|   |-- plugin-context.controller.ts
|   `-- native-plugins.module.ts
|-- 07-descriptors/         the same framework without decorators
|   `-- metrics.descriptors.ts      defineModule + defineElysiaController
|-- app.module.ts           composes every module above
`-- main.ts                 bootstrap with the configureNative escape hatch
```

## Test layout

Each suite covers the use case it is numbered after, and
`test/application.ts` holds the shared request helpers.

| Suite                               | Covers                                                            |
| ----------------------------------- | ----------------------------------------------------------------- |
| `01-providers.e2e-spec.ts`          | Each provider kind, private providers, singleton identity         |
| `02-modules.e2e-spec.ts`            | Exported services, import cycles, ambiguous and invalid exports   |
| `03-validation.e2e-spec.ts`         | Accepted and rejected bodies, queries, and headers                |
| `04-http-methods.e2e-spec.ts`       | Every method decorator, misses, and unmapped paths                |
| `05-request-parameters.e2e-spec.ts` | Every parameter decorator, named, whole, and absent               |
| `06-native-plugins.e2e-spec.ts`     | Decorators, state, derive scopes, dedupe by key, key validation   |
| `07-descriptors.e2e-spec.ts`        | Hand-written descriptors beside decorated modules, frozen results |
| `08-logging.e2e-spec.ts`            | Silent logging, and a custom `LoggerService` receiving the lines  |
| `09-lifecycle.e2e-spec.ts`          | `handle`, `listen`, `getUrl`, `close`, and `configureNative`      |

## Run

From the repository root:

```bash
bun run example:feature-tour   # listens on PORT, default 3100
bun run test:examples          # runs every example suite, as CI does
```

`bun run --cwd examples/feature-tour test` runs this example's suites alone.
