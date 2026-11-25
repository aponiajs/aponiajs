# @aponiajs/common — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The contract layer every other package depends on: decorators, descriptors,
tokens, providers, errors, and logging. Its only runtime dependency is
`reflect-metadata`.

| Domain           | Owns                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `configuration/` | The configuration token that carries its own schema                                                 |
| `decorators/`    | `@Module`, `@Controller`, `@Injectable`, `@Inject`, `applyDecorators`, and HTTP method decorators   |
| `routing/`       | Request decorators, route schemas, validators, DTOs, versioning, SSE, serialization, `RouteContext` |
| `modules/`       | `ModuleDefinition`, `DynamicModule`, `defineModule`, `forwardRef`, and `ModuleRef`                  |
| `providers/`     | Provider contracts and descriptor factories                                                         |
| `tokens/`        | Injection token contracts and helpers                                                               |
| `enhancers/`     | Enhancer decorators and metadata, the guard/interceptor/filter contracts, and `Reflector`           |
| `exceptions/`    | `AponiaError`, `HttpException`, `HttpStatus`, `IntrinsicException`, and the built-in exceptions     |
| `interfaces/`    | The type-only contracts every domain shares: module, provider, token, route, lifecycle, logger      |
| `services/`      | `LoggerService` implementations, log-value rendering, and the logger observer                       |
| `pipes/`         | Pipe contracts, `@UsePipes()`, `ValidationPipe`, and the built-in transformation pipes              |
| `websockets/`    | Gateway, message, parameter, server, response, and lifecycle contracts                              |
| `async-context/` | Registered async-context boundaries for background work                                             |
| `mcp/`           | MCP decorators and their metadata                                                                   |
| `microservices/` | `@MessagePattern()`/`@EventPattern()` metadata                                                      |
| `module-utils/`  | `ConfigurableModuleBuilder` and the shared async-options lowering                                   |

Runtime implementations live under the domain that owns them; type-only
contracts live in `interfaces/<name>.interface.ts`. A `*.types.ts` file remains
only where the mirrored Nest package has one. `src/index.ts` is the package's
only public barrel.

## Invariants

- No Elysia, HTTP, or Bun runtime API belongs here. Platform-native validators
  are matched structurally through `ValidatorSchema`, the marker union every
  TypeBox 1 builder declares on the type it constructs (`~kind`, plus `~refine`,
  `~codec`, and `~unsafe` from the modifier wrappers), so an Elysia `t` schema
  arrives with no runtime edge into this package. Reading the value such a
  schema produces needs the type-level `StaticDecode` mapper, which is imported
  as a type only: `typebox` stays a declared compile-time contract and never a
  runtime dependency.
- Async-context boundaries are registered, not imported. A runtime that owns an
  `AsyncLocalStorage` registers its `exit` through
  `registerAsyncContextExit`; background work calls
  `runOutsideAsyncContexts` so it cannot inherit a request identity.
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
- `Scope` uses Nest's numeric values (`DEFAULT = 0`, `TRANSIENT = 1`,
  `REQUEST = 2`). `ProviderScope` also accepts the legacy strings for one
  release; `normalizeProviderScope` lowers them and warns once per spelling, so
  the container only ever runs a normalized lifetime. `durable: true` is
  meaningful only beside `Scope.REQUEST` and groups requests by the parent
  context id a registered `ContextIdStrategy` returns. Every `provide*` factory
  accepts and freezes a trailing `scope` and `durable` option. Singleton
  instantiates per module, transient instantiates per injection, and request
  instantiates per incoming request context. Resolving an unsupported scope
  fails with `UNSUPPORTED_PROVIDER_SCOPE`.
- `HttpStatus` is Nest's numeric status set and the platform's response-status
  parameter decorator at once: `HttpStatus.CREATED` is `201`, and
  `@HttpStatus()` still records the parameter binding. `HttpException`,
  `IntrinsicException`, and the built-in `*Exception` classes live in
  `exceptions/`. `ValidationPipe` and `StandardSchemaValidationPipe` validate
  against the Standard Schema a `@Validation()` model carries;
  `ClassSerializerInterceptor` applies `@SerializeOptions()`; `StreamableFile`
  is the response body a serializer leaves untouched. This name collision is
  documented in `docs/build/migrating-from-nest.md` as the one namespace
  deviation.
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

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. This
package's `tsconfig.json` declares `experimentalDecorators` and
`emitDecoratorMetadata` as every package must, so decorators are applied the
ordinary way in tests, as `src/enhancers/enhancer-decorators.spec.ts` does.
