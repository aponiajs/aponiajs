# Zero-RxJS CallHandler and NestInterceptor Contract

Type: prototype
Status: open

## Question

Prototype and settle the exact contract for NestJS `NestInterceptor` (`intercept(context: ExecutionContext, next: CallHandler)`) alongside Aponia's `interceptBefore` / `interceptAfter`:

1. **Zero-RxJS `CallHandler` stream**: Prototype a lightweight `CallStream<T>` returned by `next.handle()` that implements BOTH `PromiseLike<T>` (`await next.handle()`) AND `.pipe(...operators)` / `.subscribe(...)`, with built-in `@aponiajs/common` operators (`tap`, `map`, `catchError`, `timeout`, `of`, `throwError`, `lastValueFrom`) — and define whether/how user code importing `rxjs` directly interoperates with `.pipe(...)`.
2. **Mixed interceptor composition**: When a route combines `intercept(context, next)` and `interceptBefore`/`interceptAfter` (across global, controller, and method scopes, including both classes and instances), how do they compose in exact NestJS onion order?
3. **Elysia sucrose preservation & platform-core kernel**: Verify in `packages/platform-elysia/src/routing/route-hook.builder.ts` and `packages/platform-core/src/kernel/http-kernel.ts` that routes without any `intercept()` interceptor retain zero-overhead Elysia static compilation, while routes using `intercept()` wrap cleanly and route thrown/caught errors to exception filters.
