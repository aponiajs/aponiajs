# @aponiajs/common — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The contract layer every other package depends on: decorators, descriptors,
tokens, providers, errors, and logging. Its only runtime dependency is
`reflect-metadata`.

| File                  | Owns                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| `decorators.ts`       | `@Module`, `@Controller`, `@Injectable`, `@Inject`, HTTP method decorators |
| `route-parameters.ts` | `@Body`, `@Query`, `@Param`, `@Headers`, `@Cookie`, `@Req`, `@Res`, `@Ctx` |
| `route-schema.ts`     | `RouteSchema`, `RouteValidator`, `RouteContext`, `routeSchemaSlots`        |
| `module.ts`           | `ModuleDefinition`, `DynamicModule`, `defineModule`                        |
| `provider.ts`         | `provideValue`, `provideFactory`, `provideClass`, `provideAlias`           |
| `token.ts`            | `createToken`, `Token`, `TokenValues`                                      |
| `controller.ts`       | The platform-neutral controller descriptor                                 |
| `error.ts`            | `AponiaError` and the closed `AponiaErrorCode` union                       |
| `logger.ts`           | `LoggerService` and the default structured logger                          |

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
- Everything a public API returns is frozen.
- Failures throw `AponiaError` with a code from the closed union. Extend the
  union rather than throwing a bare `Error`.
- Adding a route schema slot means updating `routeSchemaSlots`, `RouteContext`,
  and the platform hook builder together.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. This
package's `tsconfig.json` has no `experimentalDecorators`, so Bun compiles TC39
decorators and a decorator applied normally records nothing. Apply decorators
manually in tests, as `tests/contracts.test.ts` does.
