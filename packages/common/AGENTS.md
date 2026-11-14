# @aponiajs/common — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The contract layer every other package depends on: decorators, descriptors,
tokens, providers, errors, and logging. Its only runtime dependency is
`reflect-metadata`.

| Domain           | Owns                                                                            |
| ---------------- | ------------------------------------------------------------------------------- |
| `configuration/` | The configuration token that carries its own schema                             |
| `decorators/`    | `@Module`, `@Controller`, `@Injectable`, `@Inject`, HTTP method decorators      |
| `routing/`       | Request decorators, route schemas, validators, and `RouteContext`               |
| `modules/`       | `ModuleDefinition`, `DynamicModule`, and `defineModule`                         |
| `providers/`     | Provider contracts and descriptor factories                                     |
| `tokens/`        | Injection token contracts and helpers                                           |
| `controllers/`   | The platform-neutral controller descriptor                                      |
| `errors/`        | `AponiaError` and the closed `AponiaErrorCode` union                            |
| `logging/`       | `LoggerService` and the default structured logger                               |
| `lifecycle/`     | The five type-only provider lifecycle contracts                                 |
| `websockets/`    | Gateway, message, parameter, server, response, and lifecycle contracts          |
| `enhancers/`     | Enhancer decorators, guard, interceptor, filter, and host contracts             |
| `pipes/`         | Pipe contracts, `@UsePipes()`, and built-in parameter transformation pipes      |
| `middleware/`    | Middleware contracts (`AponiaMiddleware`, `MiddlewareConsumer`, `AponiaModule`) |

Runtime implementation and `*.types.ts` contracts stay beside each other in
their owning domain. `src/index.ts` is the package's only public barrel.

## Invariants

- No Elysia, HTTP, or Bun runtime API belongs here. Platform-native validators
  are matched structurally through `ValidatorSchema`, the marker union every
  TypeBox 1 builder declares on the type it constructs (`~kind`, plus `~refine`,
  `~codec`, and `~unsafe` from the modifier wrappers), so an Elysia `t` schema
  arrives with no runtime edge into this package. Reading the value such a
  schema produces needs the type-level `StaticDecode` mapper, which is imported
  as a type only: `typebox` stays a declared compile-time contract and never a
  runtime dependency.
- Decorators only write `reflect-metadata` entries under
  `Symbol.for("aponia.*.metadata")`. They build no graph, no routes, no
  container. `@Injectable()` stays a no-op that exists for
  `emitDecoratorMetadata`.
- Metadata is read with `Reflect.getOwnMetadata`, so a subclass never inherits a
  parent's module or controller metadata. Keep it that way. Constructor
  dependencies are the deliberate exception: `design:paramtypes` and the
  explicit `@Inject()` token map are both read with `Reflect.getMetadata`,
  because a subclass without its own constructor runs the parent's constructor
  and must resolve the parent's declared tokens. Own metadata still wins, so a
  subclass that declares its own constructor keeps its own tokens.
- `@All()` records the `ALL` method, which the platform mounts as an
  all-methods route. `@Header()` and `@HttpCode()` record own-only metadata
  under `Symbol.for("aponia.response-headers.metadata")` and
  `Symbol.for("aponia.http-code.metadata")`; a malformed declaration throws a
  `TypeError` at the decoration site. `@Ip()` records the `ip` parameter kind,
  and the platform answers the peer address or `undefined` when its runtime
  cannot state one.
- `@Validation()` records one raw `RouteValidator` under
  `Symbol.for("aponia.validation.metadata")`. Validation-model metadata is
  own-only and immutable, and resolving it preserves the original validator
  instance.
- `@Optional()` records parameter indexes under
  `Symbol.for("aponia.optional-parameters.metadata")`, and
  `getConstructorDependencies` wraps those entries with `optionalDependency`.
  `ModuleRef` is the abstract token a module-bound reference implements; both
  surfaces stay platform-neutral. The reference resolves a cached instance
  (`get`), a per-request instance (`resolve`), and a fresh uncached instance
  (`create`).
- `@Serialize()` records a serializer under
  `Symbol.for("aponia.response-serializer.metadata")`. A method serializer
  overrides a controller serializer; both are read by the platform after the
  handler and its interceptor `after` halves.
- `@Version()` records a URI version under
  `Symbol.for("aponia.version.metadata")`. The platform prefixes a versioned
  route with `/v<version>`; a handler declaration overrides a controller
  declaration.
- `@Sse()` records a Server-Sent Events marker under
  `Symbol.for("aponia.sse.metadata")`. The platform sets the event-stream
  headers before the handler; the application's payload is wrapped with `sse()`.
- `createDto` derives a strongly typed DTO class constructor from a Standard
  Schema v1 validator, associating the validation metadata and freezing the
  base class.
- Everything a public API returns is frozen.
- `ProviderScope` supports `"singleton"`, `"request"`, and `"transient"` via
  the `Scope` enum (`Scope.DEFAULT`, `Scope.REQUEST`, `Scope.TRANSIENT`), and
  every `provide*` factory accepts and freezes a trailing `scope` option.
  Singleton instantiates per module, transient instantiates per injection,
  and request instantiates per incoming request context. Resolving an unsupported
  scope fails with `UNSUPPORTED_PROVIDER_SCOPE`.
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
- Enhancer decorators write own-only frozen metadata under
  `Symbol.for("aponia.enhancer-*.metadata")`: one declaration object per class
  and one map keyed by property per prototype. `@Catch()` records on the filter
  class itself, so the matched types travel with the class that names it. A
  decorator called with no class, or with a value that is not a class, throws a
  `TypeError` at the decoration site.
- `ExecutionContext` carries the route's class, handler, and mounted
  `{ method, path }` beside the shared `ArgumentsHost` surface. One transport
  exists, so `getType()` and Nest's per-transport dispatch are not carried.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. This
package's `tsconfig.json` declares `experimentalDecorators` and
`emitDecoratorMetadata` as every package must, so decorators are applied the
ordinary way in tests, as `tests/enhancer-decorators.test.ts` does.
