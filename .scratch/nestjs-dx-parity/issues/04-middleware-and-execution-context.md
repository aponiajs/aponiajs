# Middleware, ExecutionContext, Custom Decorators, and Exception Filters

Type: grilling
Status: open
Blocked by: 02

## Question

Settle the exact cross-platform contracts for middleware, execution context, custom parameter decorators, and exception filters:

1. **Middleware 1:1**: Define `RequestMethod` value+type (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `ALL`, `OPTIONS`, `HEAD`, `SEARCH`), `NestModule` alias, functional middleware `(req, res, next)` / `(ctx, next)` in `consumer.apply(fn)` and `app.use(fn)`, `NestMiddleware` 3-arg `use(req, res, next)` callback semantics (calling `next()` without returning/awaiting vs returning Promise), and `MiddlewareConsumer.forRoutes(ControllerClass)` with `string[]` / `ControllerOptions` paths.
2. **`ArgumentsHost` & `HttpArgumentsHost` response facade**: Define `getArgs()` / `getArgByIndex(index)`, `getResponse()` (`.status(code).json(body)` / `.send(body)` / `.header(k, v)` / `.setHeader(k, v)` facade backed by `context.set` and finalized `Response`), `getNext()`, and `RouteContext` `method` / `url` fields across Elysia, Hono, and H3.
3. **`createParamDecorator` & parameter binding**: Specify passing `ExecutionContext` to `CustomParamFactory<TData, TOutput>` (updating `@CurrentUser` / `@Session`), and align `packages/platform-core/src/kernel/parameter-binding.ts` with Elysia's `route-handler-compiler.ts` so `metatype` and custom `data` pass identically to pipes.
4. **`BaseExceptionFilter`**: Specify `BaseExceptionFilter` in `@aponiajs/core` (and platform re-exports) so `super.catch(exception, host)` delegates cleanly to `HttpException` JSON / `HttpError` Problem Details / `500` safe fallback.
