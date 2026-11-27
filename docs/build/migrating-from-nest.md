# Migrating from NestJS

AponiaJS keeps the authoring model Nest teaches — decorators, modules, providers,
guards, interceptors, filters, pipes — and runs it on Elysia instead of Express
or Fastify. Most application code moves by changing imports; the places it does
not are listed below.

## Verified sources

Everything in this page was read from the sources below, fetched on 2026-11-24.
Pin the same revisions when checking a later claim, because a page path and a
package export both move.

| Source                                                                | Revision                                                                                                                                | What it pins                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`nestjs/docs.nestjs.com`](https://github.com/nestjs/docs.nestjs.com) | [`8decee4911aacaabfbd7d8c67a48af350c560501`](https://github.com/nestjs/docs.nestjs.com/commit/8decee4911aacaabfbd7d8c67a48af350c560501) | Every documentation path in this page                     |
| [`nestjs/nest`](https://github.com/nestjs/nest) v11.1.6               | [`35c3ded6dbf3f23f917ae88d0ed966932788cae6`](https://github.com/nestjs/nest/commit/35c3ded6dbf3f23f917ae88d0ed966932788cae6)            | `Scope`, `ModuleRef`, lifecycle ordering, testing builder |
| `@nestjs/cli` 12.0.15                                                 | [`32eaf76c7de0f8fbb63d4a313d5109c0308c1115`](https://github.com/nestjs/nest-cli/commit/32eaf76c7de0f8fbb63d4a313d5109c0308c1115)        | `aponia-cli.json` defaults and builder names              |

The numeric `Scope` values below were read from
`@nestjs/common@11.1.6/interfaces/scope-options.interface.d.ts`; the package
declares `DEFAULT = 0`, `TRANSIENT = 1`, and `REQUEST = 2`.

## Documentation paths

These are the paths that exist at the pinned documentation revision. Several
older links moved; use these, not the ones a pre-v12 article prints.

### Fundamentals

| Topic                   | Path                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| Controllers             | `content/controllers.md`                                                |
| Providers and injection | `content/components.md`, `content/fundamentals/dependency-injection.md` |
| Modules                 | `content/modules.md`, `content/fundamentals/dynamic-modules.md`         |
| Middleware              | `content/middlewares.md`                                                |
| Exception filters       | `content/exception-filters.md`                                          |
| Pipes                   | `content/pipes.md`                                                      |
| Guards                  | `content/guards.md`                                                     |
| Interceptors            | `content/interceptors.md`                                               |
| Custom decorators       | `content/custom-decorators.md`                                          |
| Injection scopes        | `content/fundamentals/provider-scopes.md`                               |
| Circular dependency     | `content/fundamentals/circular-dependency.md`                           |
| Module reference        | `content/fundamentals/module-reference.md`                              |
| Lifecycle events        | `content/fundamentals/lifecycle-events.md`                              |
| Execution context       | `content/fundamentals/execution-context.md`                             |
| Unit testing            | `content/fundamentals/unit-testing.md`                                  |
| Lazy modules            | `content/fundamentals/lazy-loading-modules.md`                          |
| Application context     | `content/application-context.md`                                        |

### Application, data, HTTP, and security

The old `content/techniques/` directory no longer exists. These are the working
pages.

| Topic              | Path                                                               |
| ------------------ | ------------------------------------------------------------------ |
| Configuration      | `content/application/configuration.md`                             |
| Validation         | `content/application/validation.md`                                |
| Serialization      | `content/application/serialization.md`                             |
| Task scheduling    | `content/application/task-scheduling.md`                           |
| Queues             | `content/application/queues.md`                                    |
| Events             | `content/application/events.md`                                    |
| Logging            | `content/application/logger.md`                                    |
| HTTP client        | `content/application/http-client.md`                               |
| Caching            | `content/data/caching.md`                                          |
| Database overview  | `content/data/overview.md`                                         |
| Drizzle            | `content/data/drizzle.md`                                          |
| Versioning         | `content/http/versioning.md`                                       |
| Cookies            | `content/http/cookies.md`                                          |
| Sessions           | `content/http/sessions.md`                                         |
| Security headers   | `content/security/helmet.md`                                       |
| Compression        | `content/http/compression.md`                                      |
| Uploads            | `content/http/file-upload.md`                                      |
| Streaming          | `content/http/streaming-responses.md`                              |
| Server-sent events | `content/http/server-sent-events.md`                               |
| Authentication     | `content/security/authentication.md`                               |
| Authorization      | `content/security/authorization.md`                                |
| Passport           | `content/recipes/passport.md`                                      |
| Swagger            | `content/openapi/introduction.md`, `content/openapi/decorators.md` |
| Health checks      | `content/reliability/terminus.md`                                  |
| Locks              | `content/reliability/locks.md`                                     |
| MVC                | `content/http/mvc.md`                                              |
| Serverless         | `content/faq/serverless.md`                                        |

### Transport and workspace

| Topic         | Path                                                                 |
| ------------- | -------------------------------------------------------------------- |
| Microservices | `content/microservices/basics.md`                                    |
| GraphQL       | `content/graphql/quick-start.md`, `content/graphql/resolvers-map.md` |
| WebSockets    | `content/websockets/gateways.md`                                     |
| Workspaces    | `content/cli/workspaces.md`                                          |
| Libraries     | `content/cli/libraries.md`                                           |
| `nest new`    | `content/first-steps.md`                                             |
| CLI usage     | `content/cli/usages.md`                                              |

## Verified library matrix

Each row names the published version and the commit its npm manifest records.
`gitHead` is absent for two packages, so their release tag is stated instead.

| Nest package             | Version | Commit                                                    |
| ------------------------ | ------- | --------------------------------------------------------- |
| `@nestjs/config`         | 12.1.1  | `0b7e9b25c2993547c8c8276d18af6976980455c7`                |
| `@nestjs/jwt`            | 12.0.5  | `11a32a6a01fb90c6bdd941186d85078b9e6d55d4`                |
| `@nestjs/throttler`      | 6.8.0   | tag `v6.8.0` = `919f9c7613d8eec5b991a1ec65630a506749d98d` |
| `@nestjs/terminus`       | 12.2.0  | `65c11ea838ebf745c3dad22ca837b18c49b403cb`                |
| `@nestjs/cache-manager`  | 12.0.5  | `5225db57e4812749a80e7aa251ec0d9c8e23da57`                |
| `@nestjs/bullmq`         | 12.0.2  | `e1161aa41c204d583d8d4869a6234efc942464c8`                |
| `@nestjs/passport`       | 12.0.2  | `72aba26b99902d0ce37086a18d4d4ab916652400`                |
| `@nestjs/swagger`        | 12.1.2  | `49ace31c3ea82d44287e8749f8eeafadc91243be`                |
| `@nestjs/schedule`       | 12.0.4  | `9cab45d743760d59cc3a1f1de7ea16850c2acb6c`                |
| `@nestjs/event-emitter`  | 12.0.3  | `fe03a9ef9034541c20fe530a3c40b45990ed3137`                |
| `@nestjs/testing`        | 12.6.0  | `1e890042e3b8bd7b19eab88d09d13a9a5297ad50`                |
| `@nestjs/http-client`    | 0.0.3   | tag `0.0.3` = `2a13ae2470ffefe70056f9bb23d5bfae51cd0134`  |
| `@nestjs/authentication` | 0.1.7   | `5ecc23436ca82794eeb84c970190d05c03f275da`                |
| `@nestjs/authorization`  | 0.1.4   | `d418075b9548c5d864926d645e3bd01d62d53a0c`                |
| `@nestjs/locks`          | 0.0.6   | `0bfefc49f97b55526746f207aff646a2d6a02501`                |
| `@nestjs/drizzle`        | 0.0.2   | `9df9a39d89e7c6091d63b1018f3d548997b87881`                |

Verified API facts that the mapping depends on:

- `@nestjs/http-client` exports `HttpClientModule`, `HTTP_CLIENT_MODULE_OPTIONS`,
  `getHttpClientToken`, `HttpClient`, `HttpClientInterceptor`,
  `HttpClientFactoryOptions`, `HttpClientOptionsFactory`,
  `HttpResponse`, `HttpClientError`, and `toHttpException`. It replaces the
  Axios-based `@nestjs/axios`.
- `@nestjs/authentication` exports `AuthenticationModule`,
  `AUTHENTICATION_MODULE_OPTIONS`, `AuthenticationGuard`, `@Public`,
  `@Authenticate`, `@CurrentUser`, `@CurrentSession`, `SignInService`,
  `TokenService`, `PasswordHasher`, `SessionService`, `SessionCookieProvider`,
  `MfaService`, `OidcService`, `MagicLinkService`, `EmailVerificationService`,
  `ApiKeyProvider`, `JwtBearerProvider`, `AuthenticationRegistry`, and
  `AuthenticationEvents`.
- `@nestjs/authorization` exports `AuthorizationModule`,
  `AUTHORIZATION_MODULE_OPTIONS`, `AuthorizationGuard`,
  `AuthorizationService`, `AuthorizationError`, `AuthorizationEvents`, and its
  decorator set.
- `@nestjs/locks` exports `LocksModule`, `LOCKS_MODULE_OPTIONS`, `Locks`, `Lock`,
  `LocksContext`, `@OnOneInstance`, and `@WithoutOverlapping`.
- `@nestjs/drizzle` exports its module from `dist/index.js` and no
  `MODULE_OPTIONS_TOKEN`; verify its registration methods before adopting a
  repository API. This release keeps Aponia's Drizzle boundary and does not
  claim an API this revision does not state.

## Packages

| NestJS                     | AponiaJS                                      |
| -------------------------- | --------------------------------------------- |
| `@nestjs/common`           | `@aponiajs/common`                            |
| `@nestjs/core`             | `@aponiajs/core`                              |
| `@nestjs/platform-express` | `@aponiajs/platform-elysia` (Elysia)          |
| `@nestjs/config`           | `provideConfiguration` from `platform-elysia` |
| `@nestjs/swagger`          | `@aponiajs/openapi`                           |
| `@nestjs/terminus`         | `health: true` on the Elysia application      |
| `@nestjs/websockets`       | gateway decorators in `@aponiajs/common`      |
| `@nestjs/bull`             | `@aponiajs/queue` (process-local)             |
| TypeORM or Prisma layer    | `@aponiajs/database` (Drizzle)                |

## Boot

```ts
// NestJS
const app = await NestFactory.create(AppModule);
await app.listen(3000);

// AponiaJS
const app = await AponiaFactory.create(AppModule);
await app.listen(3000);
```

`AponiaFactory.create` compiles the decorated classes into frozen descriptors
before anything mounts, so a duplicate token, an unresolved dependency, or a
cycle fails the boot instead of the first request. The same descriptors can be
written by hand with `defineModule` and `defineController`, which is what makes
generated code and decorator code equal at runtime.

A `forRoot()`-style registration returns `dynamicModule({ module, providers })`.
The helper derives `id` from the class name and a fresh `instanceId`, so a
Nest-shaped registration does not have to state the two Aponia-only identity
fields; passing either one still overrides the derivation. A `forRoot()` may
return `Promise<DynamicModule>`; both boot paths, `createApplicationContext`,
and `LazyModuleLoader` await it. Calling the synchronous `compileRootModule`
with such an import refuses with `INVALID_MODULE`.

### Choosing the runtime

`AponiaFactory` imported from `@aponiajs/platform-elysia` boots Elysia, the way
`NestFactory.create` boots Express. Another runtime states its adapter, either
positionally or as an option:

```ts
import { AponiaFactory } from "@aponiajs/platform-core";
import { honoAdapter } from "@aponiajs/platform-hono";

const app = await AponiaFactory.create(AppModule, honoAdapter());
await app.listen(3000);
```

| NestJS                                                | AponiaJS                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `NestFactory.create(AppModule)`                       | `AponiaFactory.create(AppModule)`                                                                                              |
| `NestFactory.create(AppModule, new ExpressAdapter())` | `AponiaFactory.create(AppModule, elysiaAdapter())`                                                                             |
| `NestFactory.create(AppModule, new FastifyAdapter())` | `AponiaFactory.create(AppModule, honoAdapter())`, or `h3Adapter()`                                                             |
| `NestFactory.createApplicationContext(AppModule)`     | `AponiaFactory.createApplicationContext(AppModule)` from `@aponiajs/platform-elysia`, for a worker or command with no listener |

## The application object

The Elysia, Hono, and H3 platforms return the same managed application surface —
`handle`, `tryHandle`, `listen`, `getUrl`, `get`, `getHttpAdapter`,
`getHttpServer`, `close`, and every Nest configuration method in the table below.
A configuration method records its state and `init()` re-runs the boot once; the
factory options remain the descriptor path and state the same configuration
without a re-run. Where a runtime cannot state what a method describes, the
method still exists and fails with `UNSUPPORTED_PLATFORM_FEATURE` rather than
being silently absent.

The delivery adapters (`@aponiajs/nitro` and
`@aponiajs/serverless`) keep their narrower documented surface. Each forwards a
request to an application already booted on a platform and adds no application
members of its own.

| NestJS                                                             | AponiaJS                                                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `await NestFactory.create(AppModule)`                              | `await AponiaFactory.create(AppModule)`; the graph is compiled, mounted, and started during the call                                       |
| `app.init()`                                                       | `app.init()`; a method called after `create` is applied when `init()` runs, and a boot with nothing configured is never re-run             |
| `app.listen(port)`                                                 | `app.listen(port)`; resolves with the application itself                                                                                   |
| `app.getUrl()`                                                     | `app.getUrl()`; throws `APPLICATION_NOT_LISTENING` before `listen`                                                                         |
| `app.getHttpAdapter()`                                             | `app.getHttpAdapter()`; the runtime's own application object, so there is no `.getInstance()` step                                         |
| `app.getHttpServer()`                                              | `app.getHttpServer()`; the runtime's server — the bound Bun server on Hono and H3, Elysia's own on Elysia — absent until `listen`          |
| `app.enableShutdownHooks()`                                        | `app.enableShutdownHooks()`; the same effect as `listen(port, { shutdownSignals: true })`                                                  |
| `app.useGlobalGuards(...)`                                         | `app.useGlobalGuards(...)`; also `useGlobalInterceptors`, `useGlobalPipes`, `useGlobalFilters`                                             |
| `app.setGlobalPrefix("api")`                                       | `app.setGlobalPrefix("/api")`; the factory's `prefix` option states the same thing without a re-run                                        |
| `app.enableVersioning({ type: VersioningType.URI })`               | `@Version()` on the controller or handler; the URI mount needs no option                                                                   |
| `app.enableVersioning({ type: VersioningType.HEADER, header })`    | `app.enableVersioning({ type: "header", header: "x-api-version" })`, or the factory's `versioning` option                                  |
| `app.enableVersioning({ type: VersioningType.CUSTOM, extractor })` | `app.enableVersioning({ type: "custom", extractor })`                                                                                      |
| `app.enableCors(options?)`                                         | `app.enableCors(options?)`; the factory's `cors` option states the same policy                                                             |
| `app.useSecurityHeaders(options?)`                                 | `app.useSecurityHeaders(options?)`; must be called once, before `init()`                                                                   |
| `app.useBodyParser(...)`                                           | not provided; the platform reads the body once, and `maxBodyBytes` bounds it                                                               |
| `app.use(middleware)`                                              | a module's `configure(consumer)` with `AponiaMiddleware`, or a native plugin                                                               |
| `app.useWebSocketAdapter(adapter)`                                 | the runtime adapter passed to `AponiaFactory.create`                                                                                       |
| `app.useLogger(logger)`                                            | `app.useLogger(logger)`; also `flushLogs()` for the buffered-log call a migration carries                                                  |
| `app.resolve(token)`                                               | `app.get(token)` for a singleton; a request-scoped provider is resolved inside its request and fails `MISSING_REQUEST_CONTEXT` outside one |
| `app.close()`                                                      | `app.close()`; idempotent                                                                                                                  |

## Testing

| NestJS                                                                          | AponiaJS                                                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Test.createTestingModule({ ... })`                                             | `Test.createTestingModule({ ... })` from `@aponiajs/testing`                             |
| `.overrideProvider(X).useValue(value)`                                          | the same, plus `useClass`, `useFactory`, and `useExisting`                               |
| `.overrideProvider(X).useFactory({ factory, inject })`                          | the same options shape                                                                   |
| `.overrideProvider(X).useClass(cls)`                                            | the same                                                                                 |
| `.overrideGuard` / `.overrideInterceptor` / `.overrideFilter` / `.overridePipe` | the same four names                                                                      |
| `.overrideModule(X).useValue(...)`                                              | the same; the match is by reference, and a dynamic module's factory is not re-run        |
| `.useMocker(token => ...)`                                                      | the same; `undefined` leaves that provider as it is                                      |
| `.setLogger(logger)`                                                            | the same; it is the logger `createAponiaApplication` installs                            |
| `.compile()`                                                                    | `.compile()`, asynchronous                                                               |
| `moduleRef.get(X)`                                                              | `.get(X)`; a request-scoped provider needs `.resolve`                                    |
| `moduleRef.resolve(X, contextId?)`                                              | `.resolve(X, contextId?)`; no context id creates a fresh sub-tree                        |
| `moduleRef.createNestApplication()`                                             | `moduleRef.createAponiaApplication(options?)`                                            |
| `await app.init()`                                                              | none; the application boots when it is created                                           |
| `request(app.getHttpServer()).get("/x")`                                        | `application.handle(new Request("http://localhost/x"))`; no port and no test HTTP client |

`HttpAdapterHost.httpAdapter` is `undefined` immediately after `compile()`,
exactly as Nest documents.

## What maps directly

`@Module`, `@Controller`, `@Injectable`, `@Inject`, `@UseGuards`,
`@UseInterceptors`, `@UseFilters`, `@UsePipes`, `@SetMetadata`,
`applyDecorators`, `@Catch`,
`@Body`, `@Query`, `@Param`, `@Headers`, `@Ip`, `@All`, `@Header`,
`@HttpCode`, and the HTTP method decorators keep their names and meaning. The
lifecycle interfaces keep theirs too:
`onModuleInit`, `onApplicationBootstrap`, `beforeApplicationShutdown`,
`onModuleDestroy`, `onApplicationShutdown`.

`@Injectable()` is optional and stays a no-op; it exists so
`emitDecoratorMetadata` records constructor types. Providers are resolved by
token, and a provider that is not exported from its module is invisible to an
importer — the same visibility rule Nest enforces.

Provider object literals keep their Nest shape: `{ provide, useClass, useValue,
useFactory, useExisting, inject? }` is accepted and lowered to the canonical
provider. A decorated `useClass` without `inject` infers its constructor
dependencies; a descriptor written by hand states `inject`.

`ConfigurableModuleBuilder` generates the `forRoot`/`forRootAsync` pair and the
options token a configurable module exposes; `forFeature` declares one named
feature registration of a module. A factory may return the options object or a
Promise for it; the boot awaits the factory before providers that inject the
options token resolve, and runs the same validation on the resolved value as on
a literal. `useClass` and `useExisting` are both lowered by the shared
`moduleOptionsProviders`, and a factory class's constructor dependencies come
from `design:paramtypes`.

Aponia's plugin packages name their canonical registration `forRoot`, matching
the Nest library convention. The beta `register` spelling remains as a
deprecated alias that delegates to `forRoot`, so a migration can rename call
sites at its own pace; new code uses `forRoot`.

## Injection scopes

`Scope` uses Nest's numeric values: `Scope.DEFAULT` is `0`, `Scope.TRANSIENT`
is `1`, and `Scope.REQUEST` is `2`. The legacy strings `"singleton"`,
`"transient"`, and `"request"` are accepted for one release, lowered on read,
and reported once per spelling with a deprecation warning.

`@Injectable({ scope: Scope.REQUEST })` constructs one instance per request.
A request-scoped dependency bubbles outward along the injection chain, so a
provider or controller that reaches one is request-scoped whatever it declares.
Request-scoped and transient instances run no lifecycle hooks, because they do
not exist when the hooks run.

`{ scope: Scope.REQUEST, durable: true }` marks a durable provider. A registered
`ContextIdStrategy` attaches a parent context id to each request's child id;
every request the strategy maps to one parent shares that provider's subtree.
Register the strategy with `ContextIdFactory.apply(...)`.

`REQUEST`, `CONTEXT`, and `INQUIRER` are injectable tokens from
`@aponiajs/core`. `REQUEST` is the active request object, `CONTEXT` is the
active context, and `INQUIRER` is the provider that asked for the dependency.
`ContextIdFactory.create()`, `getByRequest(request)`, and
`ModuleRef.registerRequestByContextId(request, contextId)` are the context-id
surface.

## Module reference

`ModuleRef` matches Nest:

| Call                                             | Behavior                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `get(X)`                                         | resolves what the receiving module can see; a token it cannot reach raises `MISSING_PROVIDER` |
| `get(X, { strict: false })`                      | resolves from the whole graph                                                                 |
| `get(X, { each: true })`                         | returns every instance of the token                                                           |
| `resolve(X)`                                     | builds a fresh sub-tree                                                                       |
| `resolve(X, contextId)`                          | shares the sub-tree a context id names                                                        |
| `create(X)`                                      | constructs a class without caching it; a request-scoped class needs a context                 |
| `registerRequestByContextId(request, contextId)` | makes `REQUEST` answer that request under the id                                              |

`get` cannot retrieve a scoped provider, exactly as Nest states: use `resolve`.

## Lifecycle events

Lifecycle hooks run once per hooked module class, provider, or controller.
`onModuleInit` and `onApplicationBootstrap` order modules by distance from the
root — deepest imports and global modules first, the root last — and keep each
module's own declaration order. `beforeApplicationShutdown`, `onModuleDestroy`,
and `onApplicationShutdown` reverse the module order, so the root tears down
before the modules it imports. Request-scoped and transient instances are
excluded from every pass.

A hook that throws while starting fails the boot; a hook that throws while
stopping is reported through the system logger and the remaining hooks still
run. `enableShutdownHooks()` or `listen(port, { shutdownSignals: true })` is the
opt-in that installs the signal handler.

## Enhancements

`APP_GUARD`, `APP_INTERCEPTOR`, `APP_FILTER`, and `APP_PIPE` keep their names and
meaning. A module may declare the same token more than once; every registration
runs in declaration order. An array under the token is expanded where it was
declared, so its entries run at that position. These four tokens are the only
ones exempt from the duplicate-provider rule.

The `APP_*` tokens are pseudo-providers: they name a set of enhancers, so
`application.get(APP_GUARD)` and `ModuleRef.get(APP_GUARD)` refuse with
`MISSING_PROVIDER` instead of answering one instance. A class entry resolves in
the module that declared it; a class no module provides fails with
`MISSING_PROVIDER` rather than being constructed with no dependencies.

## Common surface

`@aponiajs/common` exports `HttpException`, `HttpStatus`, `IntrinsicException`,
the built-in exception classes (`BadRequestException`, `NotFoundException`, and
the rest), `ValidationPipe`, `StandardSchemaValidationPipe`,
`ClassSerializerInterceptor`, `@SerializeOptions`, `StreamableFile`,
`VersioningType`, and `VERSION_NEUTRAL`.

`HttpStatus` is Nest's numeric status set and Aponia's parameter decorator at
once: `HttpStatus.CREATED` is `201`, and `@HttpStatus()` still names the
platform's response-status parameter. Nest has no parameter decorator with that
name, so this is the one namespace collision recorded here.

`HttpError` stays the RFC 9457 subclass in `platform-core` and is re-exported
from `@aponiajs/platform-elysia`. A migrated `HttpException` is accepted by the
default boundary through its `status` and `getResponse()` members; a filter that
wants Problem Details catches it and answers `HttpError`.

## What changes

**Validation is not class-validator.** A route declares a Standard Schema
validator (Zod, Valibot, ArkType) or an Elysia/TypeBox schema, either directly or
through a `@Validation()` model class. One model is one schema: create, update,
and path contracts are separate classes rather than one DTO with groups.
`ValidationPipe` reads the Standard Schema a `@Validation()` model carries; a
parameter whose type is not a model passes through.

**Handlers receive the Elysia context.** `@Req()` gives the platform-neutral
`RouteContext`; the handler's second argument is the native Elysia context when a
route needs plugin decorators. There is no manual reply object: return a value, throw `HttpError`, or set a
status through `@HttpStatus()`.

**Interceptors and filters use plain values.** A returned Promise is awaited.
There is no RxJS in the runtime; a generator result is not supported where Nest
would stream an Observable. An interceptor declares `interceptBefore` and
`interceptAfter` rather than `intercept(context, next)`.

**Errors are RFC 9457 Problem Details by default.** `HttpError` and
`httpErrors` answer `application/problem+json` with no stack or cause. Any other
thrown value becomes a `500` through the system logger unless a filter answers
it first. A thrown `HttpException` is declined by the default mapping and
answered by Elysia through its own status path.

`@Session()` is available from `@aponiajs/session`: it injects the session the
plugin loaded, or one field of its data. `@HostParam()` injects the request
host, and `@HostParam("tenant")` injects its first label; the framework does not
route by subdomain.

**Mapped DTO types call your validator's own combinators.**
`partialSchema`, `pickSchema`, `omitSchema`, and `intersectSchema` call the
validator's own `partial`/`pick`/`omit`/`extend`; a validator that exposes no
such operation is refused with `INVALID_VALIDATION_MODEL` rather than
approximated. The one-schema-per-class rule still holds: the derived schema is
its own `@Validation()` class.

**Configuration is validated once.** A module declares its schema; the value is
parsed at boot and fails with `INVALID_CONFIGURATION_VALUE`. No package reads
`process.env` on the application's behalf.

**The web layer is a platform.** Elysia is the default: native plugins mount
through `PluginModule` and `definePlugin`, and a handler can read what a plugin
adds when the controller's context type names it. On Hono, H3, and Nitro the
kernel serves the route and `PlatformRouteContext` states the request fields;
Elysia plugins, `HandlerContext` merging, and Eden types are not carried there.
Express middleware and Nest's `NestMiddleware` are replaced by `AponiaMiddleware`
over the same route plan, or by a native plugin when the behavior is genuinely
request-scoped.

## Documented deviations

| Nest                                                                                                             | AponiaJS                                                                                                            | Why                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_GUARD`, `APP_INTERCEPTOR`, `APP_PIPE`, and `APP_FILTER` are defined in `@nestjs/core`                       | defined in `@aponiajs/common` and re-exported from `core/src/constants.ts`                                          | the one-way `common ← core` direction forbids moving the definition (the first namespace deviation)                                                              |
| `ModuleRef` is defined in `@nestjs/core`                                                                         | defined in `@aponiajs/common` and re-exported from `@aponiajs/core`                                                 | the same one-way direction; the second namespace deviation                                                                                                       |
| `@nestjs/*` libraries build from `lib/`                                                                          | this workspace builds from `src/`                                                                                   | the published barrel is `src/index.ts`, and the repository's own guards enforce it                                                                               |
| Nest types a contract as `interfaces/<name>.interface.ts`, a flat `<name>.interface.ts`, or a local `*.types.ts` | mirrored, one file per original basename: `interfaces/<original-basename>.interface.ts`                             | a merged interface file would invent a contract Nest does not have, and a `*.types.ts` that emits runtime values is split into `interfaces/` plus `constants.ts` |
| `common/constants.ts` holds the `APP_*` names                                                                    | no `common/src/constants.ts`; the values live in their defining modules and `core/src/constants.ts` re-exports them | one canonical declaration, placed where the dependency direction allows it                                                                                       |
| a memory refresh-token and revocation store are examples only                                                    | `memory-refresh-token.store.ts` and `memory-revocation.store.ts` ship as the bounded built-in stores                | the framework guarantees a working default while a distributed store stays the application's                                                                     |
| Jest and Supertest                                                                                               | Bun's test runner, `application.handle`, and a mirror Vite+ lane                                                    | Bun is the documented runtime; the Vite+ lane is the Aponia-only conformance lane                                                                                |
| Bun-first generated applications                                                                                 | `--type esm\|cjs` and `--test-runner vitest\|jest` are opt-in modes                                                 | the root guide requires Bun for the documented runtime and package manager                                                                                       |
| `HttpStatus` is only an enum                                                                                     | `HttpStatus` is Nest's numeric set and Aponia's parameter decorator                                                 | the parameter decorator predates the exception surface and stays compatible                                                                                      |
| Swagger's `SwaggerModule` is a static class                                                                      | `@aponiajs/openapi` exposes a static surface and keeps its module registration                                      | Aponia mounts routes through its own module graph                                                                                                                |

## CLI

| NestJS CLI                     | AponiaJS CLI                        |
| ------------------------------ | ----------------------------------- |
| `nest new`                     | `aponia new` / `bun create aponia`  |
| `nest generate resource users` | `aponia generate resource users`    |
| `nest generate module`         | `aponia generate module`            |
| `nest generate library`        | `aponia g library <name> --publish` |

The verified `@nestjs/cli` defaults are `language: "ts"`, `sourceRoot: "src"`,
`entryFile: "main"`, `exec: "node"`, `projects: {}`, `monorepo: false`,
`compilerOptions.builder: { type: "tsc", options: { configPath } }`,
`compilerOptions.webpack: false`, `compilerOptions.plugins: []`,
`compilerOptions.assets: []`, `compilerOptions.manualRestart: false`, and
`generateOptions: {}`. `aponia-cli.json` follows that interface; `collection`
names `@aponiajs/schematics`, and the Bun command replaces `exec`.

## Not available

Express- or Fastify-specific middleware is out of scope for this release;
message transports are available through `@aponiajs/microservices`, and Web
Fetch and AWS Lambda adapters through `@aponiajs/serverless`. Blade views and
templates are available through `@aponiajs/view`. WebSocket
gateways speak the documented JSON envelope rather than Socket.IO namespaces,
rooms, or acknowledgement callbacks; on Hono, H3, and Nitro the socket is a
`GatewaySocket` with `emit`, and on Elysia it is the native `ElysiaWS`.

## Checklist

1. Replace the framework, platform, and config imports.
2. Move DTOs to `@Validation()` classes and declared route schemas.
3. Replace manual replies with return values, `HttpError`, or `@HttpStatus()`.
4. Replace `Scope` strings with `Scope.DEFAULT`, `Scope.REQUEST`, and
   `Scope.TRANSIENT`; keep `durable` only on a request-scoped provider.
5. Replace a global enhancer list under one `APP_*` token with repeated
   registrations only if the declaration order matters; both run the same way.
6. Point Swagger at `@aponiajs/openapi` and Terminus-style checks at a route of
   your own beside `health: true` on the Elysia platform.
7. Replace the ORM layer with `@aponiajs/database` or keep it behind providers.
8. Run `bun run check` and `bun run test:coverage`; a missing
   `design:paramtypes` shows up as an empty route plan, so check the
   application's own `tsconfig.json` first.
