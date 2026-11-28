# NestJS Symbol Aliases and Testing Lifecycle

Type: grilling
Status: open
Blocked by: 01, 02, 03, 04

## Question

Settle the exact public surface and lifecycle semantics for NestJS aliases and `@aponiajs/testing`:

1. **Core/platform aliases**: Finalize placement and type exports for `NestFactory`, `INestApplication`, `INestApplicationContext`, `NestInterceptor`, `NestMiddleware`, `NestModule`, and `app.useGlobalGuards/Interceptors/Filters/Pipes` accepting both instances and classes.
2. **Synchronous `createNestApplication()` & deferred `init()`**: Design how `TestingModule.createNestApplication(adapter?, options?)` creates the application synchronously while sharing the already-compiled `TestingModule` container instances (so `moduleRef.get(Svc) === app.get(Svc)`), applies `useGlobal*`/`setGlobalPrefix`/`enableCors`/`enableVersioning` prior to `await app.init()` (or `await app.listen()`), and runs `onModuleInit`/`onApplicationBootstrap` once — while keeping async `createAponiaApplication()` backward-compatible.
3. **Shutdown & mocker parity**: Fix `TestingModule.close()` to run `beforeApplicationShutdown` + `onModuleDestroy` + `onApplicationShutdown`, fix `collectProviderTokens` for `forwardRef` imports, and decide `getHttpServer()` / supertest-style ergonomics vs `app.handle(new Request(...))`.
