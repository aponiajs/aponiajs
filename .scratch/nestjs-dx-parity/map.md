# NestJS 1:1 DI & DX Parity

## Destination

A clear, decision-complete specification across `@aponiajs/common`, `@aponiajs/core`, `@aponiajs/platform-core`, `@aponiajs/platform-elysia`, `@aponiajs/platform-hono`, `@aponiajs/platform-h3`, `@aponiajs/config`, `@aponiajs/openapi`, `@aponiajs/events`, `@aponiajs/rate-limit`, `@aponiajs/auth`, `@aponiajs/testing`, `@aponiajs/microservices`, and `@aponiajs/cli` so a NestJS application's exact usage patterns and concepts from `nestjs/nest` and `docs.nestjs.com` work 1:1 while preserving Aponia's Bun/Elysia strengths.

## Notes

- **Domain**: AponiaJS framework public contracts, DI container, HTTP/WS/RPC execution pipelines, configuration, OpenAPI/ecosystem modules, testing lifecycle, and CLI schematics.
- **Performance research dossier**: [`research-performance.md`](./research-performance.md) (Bun/Elysia/Hono/H3/TypeBox hot-path audit & zero-waste optimization blueprint paired with Issues 01–10).
- **Reference baselines**: [`nestjs/nest`](https://github.com/nestjs/nest) v11.1.6 and [`nestjs/docs.nestjs.com`](https://github.com/nestjs/docs.nestjs.com) (pinned in `docs/build/migrating-from-nest.md`).
- **Required skills per session**: `grilling`, `domain-modeling` (and `prototype` for `prototype` tickets; `research` for `research` tickets). Always follow root `AGENTS.md`, `RULES.md`, and the owning package `AGENTS.md`.
- **Standing decisions (settled during Q1–Q11 NestJS 1:1 grilling)**:
  - **Compatibility posture**: Maximum 1:1 NestJS DX & API parity via compatible aliases, adapters, and closing behavioral gaps while preserving Aponia's Bun/Elysia strengths (Standard Schema, zero-RxJS runtime, Elysia sucrose static compilation on routes that do not opt into `intercept(ctx, next)`, and descriptor authoring via `defineModule`/`defineController`).
  - **DI & Enhancers**: Support property-based `@Inject()`/`@Optional()` on class fields; `Reflector.createDecorator<T>()`; `DiscoveryService` + `MetadataScanner` + `ModulesContainer`; `forwardRef` on re-exported modules; allow both classes and instances in `@UseGuards`/`@UseInterceptors`/`@UsePipes`/`@UseFilters` and parameter pipes; auto-instantiate undeclared enhancer/pipe classes using the controller's module DI scope (reusing declared providers when present).
  - **Controllers & Routing**: `@Post()` defaults to `201 Created` (unless `@HttpCode`/`@Res`/`@Redirect` overrides); `@Controller` accepts `string | string[] | ControllerOptions` (`path`, `host`, `scope`, `version`) with real subdomain host matching for `@HostParam`; routes accept `string[]` paths and `@Redirect()`; expose `@Res({ passthrough?: true })`/`@Response()`/`@Next()`, `HttpStatus` type+value parity, and `@Session()` bridged via `@aponiajs/common` + `@aponiajs/session`; support `VersionValue[]` + `defaultVersion[]` + `prefix: false` in `@Version()`/`enableVersioning()`; accept leading-slash-optional `setGlobalPrefix('api', { exclude })`.
  - **Middleware & ExecutionContext**: `RequestMethod` works as both value (`RequestMethod.GET`) and type; functional middleware supported in `consumer.apply(fn)` and `app.use(fn)`; `NestMiddleware` 3-arg `use(req, res, next)` supported alongside `AponiaMiddleware` 2-arg `use(ctx, next)`; `ArgumentsHost` adds `getArgs()`/`getArgByIndex()`; `HttpArgumentsHost` adds `getResponse()` (`.status(code).json(body)`/`.send()`/`.header()` facade) and `getNext()`; `RouteContext` exposes `method`/`url`; `createParamDecorator` receives `ExecutionContext` (updating `@CurrentUser`/`@Session` and fixing `metatype`/`custom` `data` in `parameter-binding.ts`); ship `BaseExceptionFilter`.
  - **Interceptors**: Zero-RxJS `NestInterceptor` (`intercept(context, next: CallHandler)`) supporting BOTH `await next.handle()` (`PromiseLike`) AND `.pipe(...)` with built-in operators (`tap`, `map`, `catchError`, `timeout`, `of`, `throwError`, `lastValueFrom`), alongside `interceptBefore`/`interceptAfter`, wrapping only routes that declare `intercept()`.
  - **Pipes, File Upload & Serialization**: Add `@Exclude()`/`@Expose()`/`@Transform()` in `@aponiajs/common` honored by `ClassSerializerInterceptor` (zero `class-transformer`); add `FileValidator`/`MaxFileSizeValidator`/`FileTypeValidator`/`ParseFilePipeBuilder` + `FileInterceptor`/`FilesInterceptor`/`FileFieldsInterceptor`/`AnyFilesInterceptor`; built-in pipes throw `HttpException` subclasses carrying `code: "INVALID_PIPE_VALUE"`; expose `PartialType`/`PickType`/`OmitType`/`IntersectionType`.
  - **Application & Testing Lifecycle**: Expose `NestFactory`, `NestModule`, `NestMiddleware`, `INestApplication`, `INestApplicationContext`; `app.useGlobalGuards/Interceptors/Filters/Pipes` accept both instances and classes; `moduleRef.createNestApplication(adapter?, options?)` is synchronous, shares `TestingModule`'s container instances, and defers `onModuleInit`/`onApplicationBootstrap` until `await app.init()` / `await app.listen()` (keeping `createAponiaApplication()` backward-compatible).
  - **Configuration & Ecosystem**: Introduce `@aponiajs/config` (`ConfigModule.forRoot`/`forFeature`, `registerAs`, `ConfigType`, `ConfigService` with `get`/`getOrThrow`, Standard Schema validation, keeping `provideConfiguration`); add `SwaggerModule` (`createDocument`, `setup`) + `DocumentBuilder` + core `@Api*` decorators in `@aponiajs/openapi`; add ecosystem aliases (`EventEmitter2` in `@aponiajs/events`, `ThrottlerModule`/`ThrottlerGuard`/`@Throttle`/`@SkipThrottle` in `@aponiajs/rate-limit`, `JwtModule` in `@aponiajs/auth`).
  - **Transports & CLI**: Execute `@UseGuards`/`@UseInterceptors`/`@UsePipes`/`@UseFilters`/`APP_*` with `switchToRpc()`/`RpcException` on microservices and `switchToWs()`/`WsException` on WebSockets; keep `@aponiajs/*` imports in CLI templates while aligning generated patterns with NestJS DX (`ConfigModule.forRoot`, `PartialType`, DTO/resource ergonomics).
- **Working tree note**: Branch `tanya` currently holds uncommitted edits in 23 `packages/*/README.md` files and `scripts/documentation.spec.ts` unrelated to this map; keep code changes separate when execution begins.

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

## Not yet specified

- Exact `@aponiajs/config` `.env` file loading precedence, variable expansion, and `forFeature` partial config scoping edge cases.
- Exact `CallHandler` RxJS-operator interoperability boundary if user code imports real `rxjs` alongside built-in operators.
- Exact `@Res({ passthrough: true })` / `@Next()` behavior with Elysia native response hooks, `StreamableFile`, `@HttpCode`, and `@Header`.
- Exact hybrid DTO / `@Validation()` model ergonomics in `aponia generate resource` and `ValidationPipe` when `PartialType` wraps class models.
- Microservice enhancer metadata vs transport failure envelope boundaries across all nine broker adapters and `grpcTransport`.
- Cross-package implementation ordering, `ROADMAP.md` / `docs/build/migrating-from-nest.md` / `docs/build/enhancers.md` updates, coverage-gate sequencing, and `1.0.0-beta` release hygiene.

## Out of scope

- Adding `rxjs` as a mandatory runtime dependency to `@aponiajs/common`, `@aponiajs/core`, or platform packages.
- Supporting `class-validator` or `class-transformer` runtime dependencies (Standard Schema + schema combinators + built-in `@Exclude`/`@Expose`/`@Transform` remain the contract).
- Express or Fastify MVC adapters, or a Node.js runtime track.
- Socket.IO namespaces, adapter-managed rooms, or acknowledgement callbacks.
- Removing or breaking Aponia's hand-written descriptor path (`defineModule`, `defineController`, `provideConfiguration`) or Elysia static route compilation for routes without `intercept()`.
