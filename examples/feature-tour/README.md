# Feature tour example

Every implemented AponiaJS use case in one runnable application, with an
end-to-end test asserting each. `basic-foundation` is the smallest possible
application; this one is the map.

## Use case map

| Use case                                    | Where                                              | Route                |
| ------------------------------------------- | -------------------------------------------------- | -------------------- |
| Value, factory, class, and alias providers  | `src/config/config.module.ts`                      | —                    |
| Tokens and `@Inject`                        | `src/config/config.tokens.ts`, `config.service.ts` | —                    |
| A provider kept private to its module       | `src/config/config.module.ts`                      | —                    |
| Module imports and exports                  | `src/catalog/catalog.module.ts`                    | —                    |
| Standard Schema body validation             | `src/catalog/catalog.schema.ts`                    | `POST /items`        |
| Platform-native query validation            | `src/catalog/catalog.schema.ts`                    | `GET /items/search`  |
| Every HTTP method decorator                 | `src/catalog/catalog.controller.ts`                | `/items`             |
| Every request parameter decorator           | `src/parameters/parameters.controller.ts`          | `/parameters/*`      |
| Native plugin, mounted and typed            | `src/plugins/clock.plugin.ts`                      | `GET /status`        |
| Native plugin configured from the container | `src/plugins/budget.plugin.ts`                     | `GET /status/budget` |
| Descriptors without decorators              | `src/descriptors/metrics.module.ts`                | `GET /metrics`       |
| Application-level escape hatch              | `src/main.ts`                                      | —                    |

## Run

From the repository root:

```bash
bun run example:feature-tour
```

The application listens on `PORT`, defaulting to `3100`, so it can run beside
`bun run example:basic`.

## Test

```bash
bun test ./examples/feature-tour/test/feature-tour.e2e-spec.ts
```

The suite builds the real application with `AponiaFactory.create` and asserts
through `application.handle(new Request(...))`, including the `422` a failed
validation produces.
