# 13 · Enhancers

**Use when:** a route needs a decision before it runs, work around its result, or a different answer for what it throws.

Guards, interceptors, and exception filters are providers resolved from the container. They compile into Elysia's per-route lifecycle hooks.

| Kind             | Answers                                 | Hook                           |
| ---------------- | --------------------------------------- | ------------------------------ |
| Guard            | May this request continue?              | `beforeHandle`                 |
| Interceptor      | What runs before and after the handler? | `beforeHandle` / `afterHandle` |
| Exception filter | What answers what the route threw?      | route-local `error` array      |

## Guard

```ts
import { Injectable, type CanActivate, type ExecutionContext } from "@aponiajs/common";

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return context.switchToHttp().getRequest().headers.authorization === "Bearer secret";
  }
}
```

Returning `false` refuses the request with a `403` Problem Details response. A guard that throws reaches the exception filters. `canActivate` may return a `Promise<boolean>`.

## Interceptor

```ts
import { Injectable, type Interceptor, type ExecutionContext } from "@aponiajs/common";

@Injectable()
class TimingInterceptor implements Interceptor {
  interceptBefore(): void {
    performance.mark("handler-start");
  }

  interceptAfter(_context: ExecutionContext, response: unknown): unknown {
    performance.mark("handler-end");
    return response;
  }
}
```

`interceptAfter` returns what the response should carry. `undefined` leaves the handler result unchanged. `interceptBefore` cannot short-circuit.

## Filter

```ts
import { Catch, Injectable, type ExceptionFilter } from "@aponiajs/common";

class UserMissingError extends Error {}

@Catch(UserMissingError)
@Injectable()
class UserMissingFilter implements ExceptionFilter {
  catch(): unknown {
    return new Response("No such user.", { status: 404 });
  }
}
```

`@Catch()` names the types a filter answers, matched by `instanceof`. Without arguments it answers anything. Filters run most-specific-first, and the first answer wins. Returning `undefined` or `null` declines.

## Register enhancers as providers

An enhancer named in a decorator must also appear in a reachable module's `providers`. The container resolves it like any other dependency. An undeclared class fails boot with `MISSING_PROVIDER`.

```ts
import { Controller, Get, Module, UseGuards } from "@aponiajs/common";

@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
  @Get()
  read(): string {
    return "read";
  }
}

@Module({
  controllers: [UsersController],
  providers: [AuthGuard],
})
export class UsersModule {}
```

`@UseGuards()`, `@UseInterceptors()`, and `@UseFilters()` apply to a controller class or one handler. Application-wide options are declared on `AponiaFactory.create` and run before route-declared ones. Filters are consulted most-specific-first.

Controllers registered through a `registerRoutes` callback or a custom `buildPlugin` mount their own routes and run no platform enhancers.

Next: [14 · Devtools](./14-devtools.md) · Deep dive: [execution enhancers](../build/enhancers.md)
