# 13 · Enhancers

**Use when:** a route needs a decision before it runs, work around its result, or
an answer other than the default for what it throws.

Guards, interceptors, and exception filters are classes declared with decorators
and resolved from the container like any other provider. They compile into
Elysia's own per-route lifecycle hooks, so the handler a route registers does not
change shape because an enhancer runs beside it.

| Kind             | Answers                                 | Hook                          |
| ---------------- | --------------------------------------- | ----------------------------- |
| Guard            | May this request continue?              | `beforeHandle`                |
| Interceptor      | What runs before and after the handler? | `beforeHandle`/`afterHandle`  |
| Exception filter | What answers what the route threw?      | the route-local `error` array |

## A guard

```ts
import { Injectable, type CanActivate, type ExecutionContext } from "@aponiajs/common";

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return context.switchToHttp().getRequest().headers.authorization === "Bearer secret";
  }
}
```

Returning `false` refuses the request: the handler never runs and the client
receives a `403` Problem Details response. A guard that throws is a failure
rather than a refusal, and reaches the exception filters instead. `canActivate`
may also return a `Promise<boolean>`.

## An interceptor

```ts
import { Injectable, type AponiaInterceptor, type ExecutionContext } from "@aponiajs/common";

@Injectable()
class TimingInterceptor implements AponiaInterceptor {
  interceptBefore(): void {
    performance.mark("handler-start");
  }

  interceptAfter(_context: ExecutionContext, response: unknown): unknown {
    performance.mark("handler-end");
    return response;
  }
}
```

`interceptAfter` returns what the response should carry — `undefined` leaves the
handler's result unchanged. `interceptBefore` returns `void` and cannot
short-circuit; refusal is what guards are for.

## A filter

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

`@Catch()` names the types a filter answers, matched by `instanceof`; without
arguments it answers anything. Filters run most-specific-first, and the first one
that answers wins — returning `undefined` or `null` declines, every other value
answers. What no filter answers is handled by the default Problem Details mapping
every route the platform mounts carries, which is why an unhandled failure is a
`500` Problem Details response rather than a stack trace.

Two mount paths never get there at all, and no enhancer above runs on them: a
controller registered through a `registerRoutes` callback, and a definition
mounted through its own `buildPlugin`. The platform compiles a route's hooks
while it mounts the route, and those two mount their routes themselves — so
their routes run no guard, interceptor, or filter and carry no default mapping,
and an unhandled failure on one answers Elysia's native `500` carrying the
exception's message. Declare the enhancer on a decorated controller or a
declared plan when it has to run.

## Declare every enhancer as a provider

An enhancer named in a decorator must also appear in a module's `providers`, in a
module the controller's module can reach. Nest instantiates an undeclared guard
itself; Aponia does not, because an enhancer is resolved through the module graph
like every other dependency — which is what lets a guard inject a service. An
undeclared class fails the boot with `MISSING_PROVIDER`:

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

`@UseGuards()`, `@UseInterceptors()`, and `@UseFilters()` apply to a controller
class and to a single handler; a handler's declarations run after its
controller's. Application-wide enhancers are options rather than methods —
`AponiaFactory.create(AppModule, { guards: [...], interceptors: [...],
filters: [...] })` — because routes mount during `create`, and they run before
the ones a route declares. Filters are the one kind that reverses: the most
specific entry is consulted first, and the default mapping is always last.

Next: [14 · Devtools](./14-devtools.md) ·
Deep dive: [execution enhancers](../enhancers.md)
