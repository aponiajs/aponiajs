# Execution Enhancers

Guards, interceptors, and exception filters run before, around, and after a
route's handler. Aponia compiles them into Elysia's own per-route lifecycle
hooks, so nothing wraps the handler: the compiled invoker a route registers is
the same function with or without them, and a build-time generated invoker is
substituted exactly as it is on a route that declares none.

## The three kinds

| Kind             | Contract            | Elysia hook                   | Runs                                       |
| ---------------- | ------------------- | ----------------------------- | ------------------------------------------ |
| Guard            | `CanActivate`       | `beforeHandle`                | Before the handler; may refuse the request |
| Interceptor      | `AponiaInterceptor` | `beforeHandle`/`afterHandle`  | Around the handler                         |
| Exception filter | `ExceptionFilter`   | the route-local `error` array | When the handler or a guard threw          |

Their contracts live in `@aponiajs/common` and are platform-neutral:

```ts
interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

interface AponiaInterceptor {
  interceptBefore?(context: ExecutionContext): void | Promise<void>;
  interceptAfter?(context: ExecutionContext, response: unknown): unknown;
}

interface ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): unknown;
}
```

Guards and interceptors are handed an `ExecutionContext`; a filter is handed an
`ArgumentsHost`, because it is not asked which class or handler threw.

| Member                        | Answers                                         |
| ----------------------------- | ----------------------------------------------- |
| `getClass<T>()`               | The controller class the route belongs to       |
| `getHandler()`                | The controller's own method, not the platform's |
| `getRoute()`                  | `{ method, path }`, with the fully joined path  |
| `getContext()`                | The request's `RouteContext`                    |
| `switchToHttp().getRequest()` | The same `RouteContext`                         |

`switchToHttp()` is a thin alias over `getContext()`, kept because migrated Nest
code calls it on nearly every guard. Nest's per-transport `ArgumentsHost` is not
carried: there is one transport, so `getType()` would only ever answer `"http"`.

## Guards

A guard returning `false` refuses the request. The handler does not run and the
response is an RFC 9457 `403`:

```ts
import { Injectable, type CanActivate, type ExecutionContext } from "@aponiajs/common";

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return context.switchToHttp().getRequest().headers.authorization === "Bearer secret";
  }
}
```

Refusal is the throw and nothing else: the platform throws
`httpErrors.forbidden("A guard refused this request.")`, and the **default
mapping** declines that `HttpError` — it carries its own `toResponse()`, which is
what the mapping declines by — so Elysia's native error path answers a `403`
Problem Details. A filter the route declares runs before the mapping and is
consulted for the refusal exactly as it is for any other exception, `instanceof`
matching included: a catch-all `@Catch()` filter on that route answers the `403`
with its own response, because that is what declaring a catch-all means. A
guard that throws instead of returning `false` is a failure rather than a
refusal, and reaches the exception filters the same way.

An asynchronous guard is supported; `canActivate` may return
`Promise<boolean>`.

## Interceptors

Interceptors have two halves instead of Nest's `next.handle()`:

- `interceptBefore` runs before the handler. It returns `void` and **cannot
  short-circuit**: a value it returns is not read, and refusal is what guards
  are for.
- `interceptAfter` receives the handler's result and returns what the response
  should carry. `undefined` leaves the response unchanged; `null`, `false`, and
  `0` are answers, not absences. When several after halves run, each receives
  what the previous one answered.

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

A `Promise` returned by either half is awaited before its value is used, so an
asynchronous interceptor is supported. An after half never runs when a guard
refused or the handler threw: Elysia does not reach the route's `afterHandle`
hook on that path, which is the seam rather than a check the platform adds. The
failure goes to the exception filters instead.

## Exception filters

A filter answers a thrown value. `@Catch(...)` names the error types it answers,
matched by `instanceof`; a filter with no `@Catch()` at all, or `@Catch()` with
no arguments, answers anything:

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

Filters are consulted in precedence order and **the first one that answers
wins**. Returning `undefined` or `null` declines — those are the two values
Elysia's error path reads as no answer — and the array continues to the entry
behind it. Every other value is an answer, `false`, `0`, and `""` included, so a
filter that means to decline has to say so with one of those two absences. A
filter that throws is caught, reported through the system logger under
`ExceptionsHandler`, and treated as declining too — so a filter that throws an
`HttpError` does not answer with that error's response; the request answers
whatever the entry behind the broken filter decides. An asynchronous `catch` is
supported.

### The default filter

Every route the platform mounts on Elysia's AOT path carries the default
Problem Details mapping last in its own `error` array, behind the filters it
declares. It maps an unhandled failure to `500` `application/problem+json` with
a fixed `detail`, reports the exception through the system logger under
`ExceptionsHandler`, and never serializes the stack or the cause.

It cannot be removed. An application overrides it by declaring a filter ahead of
it, never by deleting it: an application that could turn error mapping off could
ship a stack trace. It also declines everything Elysia's own error path already
decided — a validation `422`, a parse `400`, a failed `t.Transform` decode,
anything thrown with `status(...)`, an exception carrying its own numeric
`status` or `toResponse()`, and an `HttpError` — so a deliberate response is
never replaced by a `500`.

Those declines are the mapping's own, not a rule the whole array obeys. A filter
declared ahead of the mapping runs first and is consulted for every exception its
`@Catch()` matches — an `HttpError`, a validation `422`, and a guard's refusal
included — so a declared filter that answers one of them replaces that response
with its own. Declining them is how the mapping stays out of the way of
responses an application already decided.

Under `elysia: { aot: false }` the route-local `error` array is never read, so
no declared filter and not even the default mapping runs; an unhandled failure
answers Elysia's native `500` carrying the exception's message, and the boot
warns under `RoutesResolver` when that policy is set. See the
[route compilation policy](../packages/platform-elysia/README.md#route-compilation-policy)
and the [errors chapter](./learn/10-errors.md).

## Routes mounted without a plan

Every enhancer above compiles onto a route while the platform mounts it from a
compiled plan: a decorated controller or a `defineElysiaControllerRoutes`
declaration. Two mount paths are outside that, and **neither carries anything
this page describes** — not the guards, interceptors, or filters the definition
declares, not a global enhancer, and not the default mapping:

- a controller registered through a `registerRoutes` callback, which is what
  `elysiaController(...)` and `defineElysiaController(..., { registerRoutes })`
  build: the callback is handed the real Elysia application and registers its
  own routes, so the platform never sees them and has nothing to attach hooks
  to;
- a definition mounted through its own `buildPlugin`, which builds an Elysia
  plugin outside a boot: with no boot there is no resolution, so the plugin
  mounts the validators its schemas declare and no enhancer hooks at all.

The consequence is the one `elysia: { aot: false }` has: a route mounted that
way answers exactly the way Elysia answers, and an unhandled failure on it is
Elysia's native `500` carrying the exception's message rather than a Problem
Details response. The platform cannot retro-fit hooks onto routes it did not
compile, so a declaration that has to run belongs on a decorated controller or a
declared plan.

## Declaring enhancers

An enhancer is declared as a class, never as an instance, and every authoring
path states classes.

### Decorators

`@UseGuards()`, `@UseInterceptors()`, and `@UseFilters()` apply to a controller
class and to a handler method. `@Catch()` applies to the filter class itself, so
the matched types travel with the class wherever it is named:

```ts
import {
  Catch,
  Controller,
  Get,
  Injectable,
  Module,
  UseFilters,
  UseGuards,
  UseInterceptors,
  type CanActivate,
  type AponiaInterceptor,
  type ExceptionFilter,
  type ExecutionContext,
} from "@aponiajs/common";

class UserMissingError extends Error {}

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return context.getContext().headers.authorization === "Bearer secret";
  }
}

@Injectable()
class TimingInterceptor implements AponiaInterceptor {
  interceptBefore(): void {}

  interceptAfter(_context: ExecutionContext, response: unknown): unknown {
    return response;
  }
}

@Catch(UserMissingError)
@Injectable()
class UserMissingFilter implements ExceptionFilter {
  catch(): unknown {
    return new Response("No such user.", { status: 404 });
  }
}

@Controller("users")
@UseGuards(AuthGuard)
@UseInterceptors(TimingInterceptor)
export class UsersController {
  @Get(":id")
  @UseFilters(UserMissingFilter)
  read(): string {
    throw new UserMissingError("no such user");
  }
}

@Module({
  controllers: [UsersController],
  providers: [AuthGuard, TimingInterceptor, UserMissingFilter],
})
export class UsersModule {}
```

Decorating with no class, or with something that is not a class, throws a
`TypeError` where the decorator is applied — a JavaScript caller has no type
checker, so the mistake surfaces at module load rather than at the first request.

### Declared plans

A route declared as data states its enhancers in the plan. The plan's arrays are
the route's own declarations; application-wide enhancers merge at the mount,
never into a compiled route:

```ts
import { defineModule, provideClass } from "@aponiajs/common";
import { defineElysiaControllerRoutes } from "@aponiajs/platform-elysia";

export const UsersModule = defineModule({
  id: "UsersModule",
  providers: [provideClass(AuthGuard, [])],
  controllers: [
    defineElysiaControllerRoutes(UsersController, {
      path: "/users",
      routes: [
        {
          method: "GET",
          path: ":id",
          propertyKey: "read",
          parameters: [{ index: 0, kind: "params", property: "id" }],
          guards: [AuthGuard],
        },
      ],
    }),
  ],
});
```

### Global enhancers

`AponiaFactory.create` accepts one array per kind. A global enhancer reaches
every route the platform mounts, whatever module mounted it — the exceptions are
the [routes mounted without a plan](#routes-mounted-without-a-plan):

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";

const application = await AponiaFactory.create(AppModule, {
  guards: [ThrottleGuard],
  interceptors: [LoggingInterceptor],
  filters: [AuditFilter],
});
```

There is deliberately no `useGlobalGuards()`, `useGlobalInterceptors()`, or
`useGlobalFilters()` method. Nest can offer one because it resolves its route
table when the application starts listening; Aponia mounts every route during
`AponiaFactory.create`, so by the time a caller holds an application the hook
arrays are already built. A method that appeared to register a global enhancer
and silently affected nothing would be worse than its absence.

## Order and precedence

Three scopes combine outward-in for guards and for `interceptBefore`, so a method
can only add to what its controller already requires:

1. global, from the factory options;
2. controller, from the class decorators or the controller's declared plan;
3. method, from the handler's decorators or the route's declared plan.

Within one scope, declaration order is preserved. The two orders that reverse are
the ones where the most specific entry should answer first:

| Kind              | Order                                            |
| ----------------- | ------------------------------------------------ |
| Guards            | `[...global, ...controller, ...method]`          |
| `interceptBefore` | `[...global, ...controller, ...method]`          |
| `interceptAfter`  | the whole list above, reversed                   |
| Filters           | `[...method, ...controller, ...global, default]` |

Guards and `interceptBefore` run in one compiled `beforeHandle` function, in that
order, rather than as two hooks whose relative order Elysia's registration would
decide. The after halves run in reverse over the concatenated list, so one
interceptor's halves bracket everything it wraps. Filters run most-specific-first
because the first entry that answers ends the chain.

## Resolution

An enhancer class named in a decorator, a plan, or an option **must be a declared
provider** in a module the controller's module can reach. It is resolved once
while that controller mounts, never per request, and enhancers are singletons
like every other provider.

Nest instantiates a guard passed to `@UseGuards()` without it being declared.
That is not carried: an undeclared class has no place in the module graph, so
nothing would decide which module's visibility it resolves under, and an
injected service inside a guard depends on `ModuleGraph.locate` answering for
every dependency. A class that is not declared or not reachable fails the mount
with `MISSING_PROVIDER`, the code the container already raises for an unresolvable
dependency — before the application can listen.

Global enhancers resolve through the root module, so a class the root cannot
reach fails the boot the same way.

Enhancers apply to HTTP routes. A WebSocket gateway is a class provider, not a
controller, so an enhancer decorator on a gateway class records metadata nothing
reads.

## Deviations from Nest

Each of these is a decision, not an omission.

1. **No `CallHandler`, no `next.handle()`, no RxJS.** An interceptor declares
   `interceptBefore` and `interceptAfter` instead, and Nest interception written
   with `next.handle().pipe(map(...))` must be rewritten. A callable `next`
   requires owning the handler invocation, which forfeits Elysia's source-static
   handler compilation for every route carrying an enhancer.
2. **`interceptBefore` cannot short-circuit.** Guards cover refusal.
3. **No `useGlobalGuards`, `useGlobalInterceptors`, or `useGlobalFilters`.**
   Routes mount during `AponiaFactory.create`; the equivalent is an option.
4. **Enhancers must be declared providers.** Nest instantiates them implicitly.
5. **`ArgumentsHost` and `getType()` are not carried.** One transport.
6. **Pipes and middleware are absent.** Route validation already covers
   per-slot validation, and Elysia's `derive` and `resolve` — reachable through
   `ElysiaPluginModule` — are the middleware mechanism.

## In this repository

Guards, `interceptBefore`, and the hook order belong to
`packages/platform-elysia/tests/guards.test.ts`,
`interceptors.test.ts`, and `route-enhancers.test.ts`; filters and the default
mapping to `exception-filters.test.ts`; the mounts that run none of it to
`unmounted-route-enhancers.test.ts`; resolution and precedence to
`enhancer-resolution.test.ts` and `global-enhancers.test.ts`; the decorators to
`packages/common/tests/enhancer-decorators.test.ts`. The
[enhancers chapter](./learn/13-enhancers.md) is the short walkthrough.

[native plugin guide](./native-plugins.md) ·
[WebSocket gateways](./websockets.md) ·
[errors chapter](./learn/10-errors.md)
