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

Verified against the supported Elysia release before this design was written:

| Claim                                                                          | Result |
| ------------------------------------------------------------------------------ | ------ |
| `route(method, path, handler, hook)` accepts lifecycle hooks in `hook`         | holds  |
| per-route `beforeHandle`, `afterHandle`, and `onError` all run                 | holds  |
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
| `ExceptionFilter`                   | `onError`      |

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
interceptor's before and after halves bracket the ones it wraps. `onError` keeps
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

It is registered **once on the root application**, not compiled into each
route's hook object. That is what keeps the property the Testing section pins:
a controller that declares no enhancer must mount exactly the hook object it
mounts today, and a per-route default would put an `onError` on every route in
every application. Declared filters are route-local hooks and are expected to
answer first; the ordering between a route-local `onError` and the root one is
one of the two behaviors this design has not established, and it is verified
before filters are built. This is the change that closes "automatic Problem Details
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

- the route hook builder emits `beforeHandle`, `afterHandle`, and `onError`
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

## What this does not yet establish

Two behaviors. Both are verified by probe before the first line of this design is
implemented, because each one changes the design rather than merely the tests.

**1. Hooks do not change a route's synchronous classification.** The design
assumes that adding hooks to a route leaves the route's own
synchronous-or-async classification alone, so the build-time invoker and the
runtime's `isPossiblyAsync` decision continue to apply unchanged. The reasoning
is that hooks are separate functions from the handler and Elysia classifies the
handler itself. If registering an `afterHandle` hook moves the route onto an
asynchronous composition path, the cost lands on every route carrying an
enhancer, and the spec's claim that the AOT invoker is unaffected is wrong.

**2. A route-local `onError` answers before the root application's.** The
default filter is registered on the root application, so a declared filter can
only take precedence if a route-local `onError` that returns a value prevents
the root one from running. If it does not, the default mapping cannot sit
"behind" declared filters, and the fallback is that the root handler consults
the matched route's compiled filters itself — a different design, recorded here
rather than discovered later.

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
- a controller with no enhancers mounts exactly the hook object it mounts today.

That last case is the regression guard for the property this phase is most
likely to break: routes that declare no enhancers must not gain hooks.

## Delivery order

1. the contracts and decorators in `common`, with their metadata tests;
2. resolution and precedence in the platform, still mounting nothing new;
3. guards, end to end, including the `403` path;
4. filters, including the default one that closes the Problem Details gap;
5. interceptors, last, because they are the kind whose Nest shape this design
   deliberately changes and the one most likely to attract revision.

Each step is independently testable, so each is independently reviewable.
