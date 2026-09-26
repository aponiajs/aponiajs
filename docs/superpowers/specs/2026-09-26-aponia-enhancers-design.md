# Aponia execution enhancers — Phase A design

## Why this exists

`AGENTS.md` lists guards, interceptors, middleware, and exception filters as not
implemented. An application migrating from Nest arrives expecting all four, and
nothing in the framework occupies the space they fill: there is no way to refuse
a request before its handler runs, no way to observe or transform a result
between the handler and the response, and no way to map a thrown error to a
response on purpose.

This phase adds **guards, interceptors, and exception filters**, plus the
foundation all three share. It is Phase A of three:

| Phase | Covers                                                       | State           |
| ----- | ------------------------------------------------------------ | --------------- |
| **A** | enhancer foundation, guards, interceptors, exception filters | this document   |
| B     | pipes                                                        | separate design |
| C     | middleware                                                   | separate design |

Pipes are not here because they overlap an existing feature: route validation is
already per-_slot_ (`body`, `query`, `params`, `headers`, `cookie`, `response`)
through `RouteSchema` and `@Validation()` models, while Nest's pipes are
per-_parameter_. Reconciling those two models is its own problem and gets its
own spec.

Middleware is not here because Elysia's `derive` and `resolve`, already reachable
through `ElysiaPluginModule`, are the same mechanism. Phase C decides whether a
Nest-shaped layer on top of them earns its place; that phase may legitimately
conclude it does not.

## Scope

In scope:

- the three contracts, in `@aponiajs/common`;
- declaration through decorators, through declared descriptors, and globally;
- resolving an enhancer instance through the container;
- ordering and precedence;
- mapping each kind onto Elysia's per-route lifecycle hooks;
- the default filter that closes the listed gap, "automatic Problem Details
  mapping for native errors".

Out of scope, deliberately:

- pipes and middleware, as above;
- RxJS, and with it Nest's `CallHandler` and `next.handle()`;
- per-request enhancer instantiation.

## The mechanism

Enhancers are compiled into Elysia's own per-route lifecycle hooks. Nothing
wraps the handler.

Checked against the supported Elysia release. The two hook rows were confirmed
by probe: route-local `beforeHandle` and `afterHandle` both run, and a route-local
`error` runs unless a root error hook registered earlier answered first. The
error row was first marked `holds` from a probe that observed a `200`, which
proves only that the route mounted, not that a route-local hook ran; the
correction and its evidence are in "What the probes established".

| Claim                                                                          | Result |
| ------------------------------------------------------------------------------ | ------ |
| `route(method, path, handler, hook)` accepts lifecycle hooks in `hook`         | holds  |
| per-route `beforeHandle` and `afterHandle` run                                 | holds  |
| a route-local `error` runs unless a root error hook answered first             | holds  |
| a route-local validator and a route-local lifecycle hook coexist in one object | holds  |
| a mounted route keeps its hooks, as `scope: "local"` entries                   | holds  |

The last row matters most: `toRouteHook` already emits `body`, `query`,
`params`, `headers`, `cookie`, and `response` validators into that same object
and `registerNativeRoute` already passes it. Extending it to carry lifecycle
hooks therefore adds no route-registration surface, and
`routing/native-route.ts` stays the only module that calls Elysia's route API.

| Enhancer                            | Hook           |
| ----------------------------------- | -------------- |
| `CanActivate`                       | `beforeHandle` |
| `AponiaInterceptor.interceptBefore` | `beforeHandle` |
| `AponiaInterceptor.interceptAfter`  | `afterHandle`  |
| `ExceptionFilter`                   | `error`        |

Ordering inside one hook array is registration order, so the array is built once
while the controller mounts, in the precedence order below.

**Why not own the pipeline.** Compiling an Aponia-owned wrapper per route would
give Nest's `next.handle()` exactly, and would cost the property the whole AOT
foundation exists to protect: Elysia compiles handlers by reading their source,
and a wrapper is not the handler. Every route carrying an enhancer would become a
generic context consumer, which is the outcome the platform's route compiler is
written to avoid. The choice is recorded here because it is the reason
interceptors deviate from Nest, below.

## Contracts

In `@aponiajs/common`, which stays platform-neutral: no Elysia, HTTP, or Bun
type may appear in any of these.

```ts
interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

interface AponiaInterceptor {
  interceptBefore?(context: ExecutionContext): void | Promise<void>;
  interceptAfter?(context: ExecutionContext, response: unknown): unknown | Promise<unknown>;
}

interface ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): unknown | Promise<unknown>;
}
```

`ExecutionContext` carries what a route knows about itself:

```ts
interface ExecutionContext {
  getClass<T>(): ClassToken<T>;
  getHandler(): (...arguments_: never[]) => unknown;
  getContext(): RouteContext;
  getRoute(): { readonly method: RequestMethod; readonly path: string };
  switchToHttp(): HttpArgumentsHost;
}

interface HttpArgumentsHost {
  getRequest(): RouteContext;
}
```

`switchToHttp()` is a thin alias over `getContext()`, kept because migrated Nest
code calls `context.switchToHttp().getRequest()` on nearly every guard. There is
one transport, so `ArgumentsHost`'s per-transport dispatch is not carried and
`getType()` is absent: a method that can only ever answer "http" is a method
that teaches a reader nothing.

`RouteContext` is already the platform-neutral request description this
framework publishes, which is why the accessor returns it rather than a
platform type.

## Declaration

Both authoring paths stay supported, as everywhere else in this framework.

**Decorators**, on a controller class and on a handler method, writing
`reflect-metadata` exactly as the existing route decorators do:

```ts
@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
  @Get(":id")
  @UseGuards(OwnerGuard)
  @UseInterceptors(TimingInterceptor)
  @UseFilters(NotFoundFilter)
  read(@Param("id") id: string): User {}
}
```

**Declared descriptors**, for applications that skip decorators:
`ElysiaRoutePlan` gains optional `guards`, `interceptors`, and `filters`
arrays, and `defineElysiaControllerRoutes` carries them into the same compiled
plan. A declared plan states enhancer classes, not instances.

**Globally**, through `AponiaApplicationOptions`:

```ts
await AponiaFactory.create(AppModule, {
  guards: [ThrottleGuard],
  interceptors: [LoggingInterceptor],
  filters: [AuditFilter],
});
```

There is deliberately **no `useGlobalGuards()` method**. Nest can offer one
because it resolves its route table when the application starts listening;
Aponia mounts every route during `AponiaFactory.create`, so by the time a
caller holds an application instance the hook arrays are already built. A method
that appeared to register a global guard and silently affected nothing would be
worse than its absence. Global enhancers are an option for that reason, and the
name `useGlobalGuards` is not carried.

## Resolution

An enhancer class named in a decorator, a plan, or an option **must be a declared
provider** in a module the controller's module can reach, and is resolved once
while that controller mounts.

Nest instantiates a guard passed to `@UseGuards()` without it being declared. Not
carried, for two reasons that both come from this framework's existing rules:
an undeclared class has no place in the module graph, so nothing would decide
which module's visibility it resolves under; and the container's contract is that
`ModuleGraph.locate` answers for every dependency, which an injected `AuthService`
inside a guard depends on. Requiring the declaration keeps enhancers inside the
visibility rules rather than beside them.

A class that is not declared fails the mount with `MISSING_PROVIDER`, the code
the container already raises for an unresolvable dependency.

Resolution happens once per controller, not per request, which is the same rule
the platform already applies to validation models and route invokers.

Enhancers are singletons, as every provider currently is.

## Ordering and precedence

Three scopes, applied outward-in so a method can only add to what its controller
already requires:

1. global, from `AponiaApplicationOptions`;
2. controller, from the class decorators or the controller's declared plan;
3. method, from the handler's decorators or the route's declared plan.

Within one scope, declaration order is preserved. The compiled hook arrays are
therefore `[...global, ...controller, ...method]` for guards and for
`interceptBefore`, and `interceptAfter` runs in the reverse of that order, so an
interceptor's before and after halves bracket the ones it wraps. `error` keeps
the outward-in order, because the first matching filter should be the most
specific one.

## Semantics

**Guards.** `canActivate` returning `false` refuses the request. The handler does
not run, and the response is a Problem Details `403` produced through the
existing `HttpError` path. A guard that throws instead of returning `false` is a
failure rather than a refusal, and reaches the filters.

**Interceptors.** `interceptBefore` runs before the handler; `interceptAfter`
receives the handler's result and returns what the response should carry,
including `undefined` to leave it unchanged. `interceptBefore` returns `void` and
**cannot short-circuit**. Short-circuiting is what guards are for, and Elysia's
behavior when a `beforeHandle` returns a value while `afterHandle` hooks are also
registered for the same route was not established by the probe this design rests
on, so it is not built on.

**Filters.** `catch` is called with the thrown value and the host. A filter
declared with `@Catch(NotFoundError, ValidationError)` matches those types by
`instanceof`; a filter declared with no arguments matches everything. Filters are
consulted in precedence order and the first match answers. A filter that throws,
or no filter matching at all, falls through to the default below.

**The default filter.** Always present, at the lowest precedence, and not
removable. It maps an `HttpError` to its own Problem Details response, and an
unhandled error to a `500` Problem Details response that serializes neither the
stack nor the cause.

It is appended to **each route's own `error` array**, after that route's declared
filters, while the controller mounts. It is not registered on the root
application, because a root error hook cannot sit behind declared filters
whichever way it is ordered. Elysia merges a route's hooks while the route is
registered and puts the application's handlers first, so a root hook registered
before controllers mount answers ahead of every declared filter and the declared
filter never runs, while one registered after reaches no mounted route at all and
maps nothing. Both orderings were probed; the results are in "What the probes
established". Compiling the mapping into the route's own array uses only the
mechanism that was verified — a route-local `error` hook runs when nothing
earlier answered, and the first responder ends the chain — and needs no route
pattern at error time, because the filter list is bound where the route is
mounted.

The cost is recorded rather than hidden: a controller declaring no enhancer no
longer mounts exactly the hook object it mounted before enhancers existed. It
gains one synchronous `error` hook and nothing else, which is the form the
Testing section states the property in.

This is the change that closes "automatic Problem Details
mapping for native errors", which `AGENTS.md` lists as missing today. An
application overrides it by declaring a filter ahead of it, never by removing
it: an application that could turn error mapping off could ship a stack trace.

## Deviations from Nest, recorded

These are the places this design is not Nest-compatible. Each is a decision, not
an omission.

1. **No `CallHandler`, no `next.handle()`, no RxJS.** An interceptor declares
   `interceptBefore` and `interceptAfter` instead. Nest interception written with
   `next.handle().pipe(map(...))` must be rewritten. The reason is in
   "The mechanism": a callable `next` requires owning the handler invocation,
   which forfeits Elysia's source-static handler compilation for every route
   carrying an enhancer. The repository had already declined RxJS once, for
   WebSocket generators, and `@aponiajs/common` holds two runtime dependencies
   today.
2. **`interceptBefore` cannot short-circuit.** Guards cover refusal.
3. **No `useGlobalGuards`, `useGlobalInterceptors`, or `useGlobalFilters`.**
   Routes mount during `AponiaFactory.create`; the equivalent is an option.
4. **Enhancers must be declared providers.** Nest instantiates them implicitly.
5. **`ArgumentsHost` and `getType()` are not carried.** One transport.
6. **Pipes and middleware are absent.** Phases B and C.

## Platform changes

In `@aponiajs/platform-elysia`:

- the route hook builder emits `beforeHandle`, `afterHandle`, and `error`
  alongside the validators it already emits;
- `ElysiaRoutePlan` gains `guards`, `interceptors`, and `filters`;
- `compileElysiaRoutePlan` and the decorated controller path both compile the
  three arrays, keeping both authoring paths on one implementation;
- `AponiaApplicationOptions` gains the three global arrays;
- enhancer resolution uses `resolveModuleProvider`, the existing internal
  platform SPI, and never constructs an instance itself.

In `@aponiajs/common`:

- the three contracts and `ExecutionContext`, as type-only exports;
- `@UseGuards`, `@UseInterceptors`, and `@UseFilters`, writing
  `reflect-metadata` under their own `Symbol.for` keys in the same style as the
  existing decorators.

No new runtime dependency is added to any package.

## What the probes established

Both behaviors were probed against `elysia@1.4.30`, the version this workspace
resolves, before any of this design was implemented. Each probe was a throwaway
file at the repository root, run with `bun`, and deleted afterwards.

**1. Hooks do not change a route's synchronous classification — holds as probed.**
One instance carried two routes with the same synchronous handler,
`() => "sync result"`; one was registered with a synchronous `afterHandle` hook
and one without, while a global `onAfterHandle` recorded what it received. Both
routes reported `resolved value` from the hook and `sync result` from the
response body, so neither exposed a raw Promise to the lifecycle.

That observable is a proxy for the classification, so it was measured directly as
well, by compiling the application and reading each route's composed handler.
`/plain` and `/sync-hook` both compile to a plain `Function`, as does a route
carrying a synchronous `beforeHandle` alongside a synchronous `afterHandle`.
Elysia treats a hook as asynchronous only when the hook function itself is
(`hooks.afterHandle?.some(isAsync)`), so the claim holds for the synchronous hooks
this design rests on, and the build-time invoker with the runtime's
`isPossiblyAsync` decision continues to apply unchanged.

One consequence is recorded rather than left implicit. It sits outside the probed
scope and does not weaken the verdict above, but the contracts here permit
`Promise`-returning enhancers: an **async** hook does move the route onto the
asynchronous path. The same route with `async () => undefined` as its
`afterHandle` compiles to an `AsyncFunction`. A route carrying an async guard,
interceptor, or filter is therefore Promise-capable whichever way its handler is
classified.

**Decided: accepted, not worked around.** The contracts keep permitting
`Promise`-returning enhancers, so a route carrying an async one is Promise-capable
whatever its handler is. That is a per-route opt-in cost, paid only by the routes
that declare such an enhancer, and it is recorded against the `AsyncFunction`
measurement above rather than designed around.

**2. A route-local `error` hook answers before the root application's `onError` —
contradicted.** Two findings, and the second is the one that changes the design.

The first is a naming defect. `onError` is not a route-local hook key in Elysia
1.4.30: `LocalHook` declares `error`, and a route registered with `{ onError }`
ignores it entirely, leaving Elysia's own `500` to carry the handler's message
with no hook run at all. The probe as first written passed `{ onError: ... }`, so
it had no local arm to measure. The findings below use the key Elysia reads,
`error`. The mechanism table and the "Platform changes" bullet above were
corrected to name it.

**Decided: the route-local key is `error`, everywhere.** Every route-local use of
`onError` in this design and in the implementation plan becomes `error`, and the
plan states the trap in its global constraints so no later task compiles a hook
nothing reads. An earlier probe of this behavior also concluded wrongly: it
observed a `200` and read that as proof the hook ran, when a `200` proves only
that the route mounted.

The second is precedence, which is registration order rather than scope. A route
whose handler throws `new Error("exploded")`:

| Registered on the route     | Root `onError`   | Handlers that ran | Body         |
| --------------------------- | ---------------- | ----------------- | ------------ |
| local `error` only          | not registered   | `route`           | `from route` |
| local `error`               | before the route | `root`            | `from root`  |
| local `error`               | after the route  | `route`           | `from route` |
| local `error` that declines | before the route | `root`, `route`   | `from route` |
| no local hook               | after the route  | none              | `exploded`   |
| local `error` on one of two | before both      | `root`, `root`    | `from root`  |

Both orderings break something this design needs, so neither is a defect to
report and move past. Elysia merges the instance's lifecycle store with the
route-local hook while the route is added, instance handlers first, and the
composed error path runs a handler only while no response has been set. A root
`onError` registered before controllers mount is therefore ahead of every
declared filter and answers it away; the route's own hook never runs. A root
`onError` registered after they mount is in no mounted route's hook list at all,
so it never maps a native error either. Reading the merged arrays directly shows
both halves: with the root handler registered late, the instance held one error
hook while the already-mounted route held none, and with it registered early, the
route held two in the order `root`, `local`.

The route-local `onError` this design's precedence section assumes does not exist
as a hook in the supported Elysia, so no declared filter can outrank a root error
hook by scope.

**Decided: declared filters and the default mapping are compiled together into
each route's own `error` array, as `[...declaredFilters, defaultMapping]`. No root
error hook is registered.** This uses only the mechanism verified above — a
route-local `error` hook runs when nothing earlier answered, and the first
responder ends the chain — and needs no route pattern at error time, because the
list is bound where the route is mounted. The fallback this design recorded
earlier, a root handler dispatching to the route it matched, is not taken: it
needs the matched route pattern inside `onError`, which is unestablished and is
the same class of assumption that produced this blocker. The cost is recorded
rather than hidden: a controller declaring no enhancer gains exactly one
synchronous `error` hook and nothing else, which is the form the Testing property
now takes.

## Testing

Bun is the primary lane, in both `@aponiajs/common` and
`@aponiajs/platform-elysia`; the Vite+ conformance lane mirrors the public
contracts.

Behavior that must have direct evidence:

- a guard returning `false` refuses with a Problem Details `403` and the handler
  is never called; a guard returning `true` runs it;
- an async guard and an async interceptor both work, and their ordering against
  a synchronous one is what the precedence section states;
- `interceptAfter` replacing the result changes the response, and returning
  `undefined` does not;
- a filter matching by type answers, a non-matching filter does not, and a
  `@Catch()` filter answers anything;
- the default filter maps `HttpError` to its own Problem Details and an
  unhandled error to a `500` that contains neither stack nor cause;
- a filter that throws does not produce a second failing response;
- an undeclared enhancer class fails the mount with `MISSING_PROVIDER`;
- global, controller, and method scopes apply in that order, with `interceptAfter`
  reversing;
- both authoring paths — decorated controllers and `defineElysiaControllerRoutes`
  — produce the same mounted behavior for the same declarations;
- a controller with no enhancers gains no `beforeHandle` and no `afterHandle`, and
  exactly one synchronous `error` hook.

That last case is the regression guard for the property this phase is most
likely to break: routes that declare no enhancers must not gain interception
hooks. The single `error` hook is the default mapping, and the measurement in
"What the probes established" is why it costs nothing — a synchronous hook
leaves a route compiling to the same plain `Function` it compiled to without
one.

## Delivery order

1. the contracts and decorators in `common`, with their metadata tests;
2. resolution and precedence in the platform, still mounting nothing new;
3. guards, end to end, including the `403` path;
4. filters, including the default one that closes the Problem Details gap;
5. interceptors, last, because they are the kind whose Nest shape this design
   deliberately changes and the one most likely to attract revision.

Each step is independently testable, so each is independently reviewable.
