# @aponiajs/common — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The contract layer every other package depends on: decorators, descriptors,
tokens, providers, errors, and logging. Its only runtime dependency is
`reflect-metadata`.

| Domain         | Owns                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| `decorators/`  | `@Module`, `@Controller`, `@Injectable`, `@Inject`, HTTP method decorators |
| `routing/`     | Request decorators, route schemas, validators, and `RouteContext`          |
| `modules/`     | `ModuleDefinition`, `DynamicModule`, and `defineModule`                    |
| `providers/`   | Provider contracts and descriptor factories                                |
| `tokens/`      | Injection token contracts and helpers                                      |
| `controllers/` | The platform-neutral controller descriptor                                 |
| `errors/`      | `AponiaError` and the closed `AponiaErrorCode` union                       |
| `logging/`     | `LoggerService` and the default structured logger                          |
| `websockets/`  | Gateway, message, parameter, server, response, and lifecycle contracts     |

Runtime implementation and `*.types.ts` contracts stay beside each other in
their owning domain. `src/index.ts` is the package's only public barrel.

## Invariants

- No Elysia, HTTP, or Bun runtime API belongs here. Platform-native validators
  are matched structurally through `NativeSchema` (`static`/`params`) so TypeBox
  never becomes a dependency.
- Decorators only write `reflect-metadata` entries under
  `Symbol.for("aponia.*.metadata")`. They build no graph, no routes, no
  container. `@Injectable()` stays a no-op that exists for
  `emitDecoratorMetadata`.
- Metadata is read with `Reflect.getOwnMetadata`, so a subclass never inherits a
  parent's module or controller metadata. Keep it that way.
- `@Validation()` records one raw `RouteValidator` under
  `Symbol.for("aponia.validation.metadata")`. Validation-model metadata is
  own-only and immutable, and resolving it preserves the original validator
  instance.
- Everything a public API returns is frozen.
- `defineModule` normalizes omitted collections to frozen empty tuples while
  retaining exact declared import, controller, provider, and export tuples.
  Do not intersect those fields with the broad `ModuleDefinition` arrays.
- Failures throw `AponiaError` with a code from the closed union. Extend the
  union rather than throwing a bare `Error`.
- Adding a route schema slot means updating `routeSchemaSlots`, `RouteContext`,
  and the platform hook builder together.
- Route schema slots accept either raw validators or validation-model classes.
  Keep raw validators as the descriptor-first compatibility path, and test
  Standard Schema values before treating callable inputs as model constructors.
- Status-specific response schema maps are immutable metadata: copy and freeze
  the map while retaining each validator instance.
- WebSocket decorators remain platform-neutral metadata. Gateways are module
  providers; `common` must not import Elysia socket or server types.
- `@WebSocketGateway()` defaults to `/ws`. `@SubscribeMessage()` events,
  message parameters, and server properties are own-only immutable metadata
  under `Symbol.for("aponia.websocket-*.metadata")` keys.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. This
package's `tsconfig.json` has no `experimentalDecorators`, so Bun compiles TC39
decorators and a decorator applied normally records nothing. Apply decorators
manually in tests, as `tests/contracts.test.ts` does.
