# A request context a service can reach

Status: design.

## Why this document

AponiaJS hands the request to the code that handles it and to nothing else.
A handler receives a `RouteContext`; a guard, an interceptor, or a filter
receives an `ExecutionContext` that answers the same facts. Both are arguments,
and both stop being available the moment the call leaves the route. A service
that a controller delegates to, a repository a service delegates to, a timer a
handler started, and an enhancer three frames down all run while a request is
being served and can name none of it.

The fact people want in those places is small and it is always one of three: the
in-flight `Request` itself, a correlation id they can put on a log line and hand
back to a client, or a value an earlier participant stashed — the authenticated
subject a guard resolved, the tenant a middleware picked, the idempotency key a
handler wants to keep. None of the three is reachable today except by threading
it through every signature between the route and the place that reads it, which
turns a service's API into a channel for something the service does not use.

This document designs the smallest mechanism that reaches those places: a store
established once per request, read through one injectable service, and off by
default so an application that never asks for it pays nothing.

## What the framework has today

These are the facts the design has to fit, each with where it is stated.

- **Nothing in the `packages/` sources establishes a per-request context a
  service can read.** `rg -n 'AsyncLocalStorage|async_hooks|RequestContext|request-context|correlation' packages`
  returns no match. There is no store, no accessor, and no request id in the
  framework's code.
- **Every context the framework has is an argument.** `RouteContext` carries
  `readonly request: Request` (`packages/common/src/routing/route-schema.types.ts:94`)
  and is what a handler is given. `ExecutionContext`
  (`packages/common/src/enhancers/enhancer.types.ts:29`) answers `getRequest():
RouteContext` (`:14`) and `getContext(): RouteContext` (`:24`). `@Ctx()`
  (`packages/common/src/routing/route-parameters.ts:33`) binds one to a
  parameter. Each travels as a value the caller passes; none survives the call.
- **`common` already imports a Node builtin.** Its only runtime _dependency_ is
  `reflect-metadata`, but it imports `inspect` from `node:util`
  (`packages/common/src/logging/console-logger.ts:1`). The rule that matters is
  narrower than "no runtime API in `common`": no Elysia, HTTP, or Bun-runtime
  API may enter it (root `AGENTS.md`, dependency direction `common` ← `core` ←
  `platform-elysia`). `AsyncLocalStorage` is `node:async_hooks`, a Node builtin
  Bun implements — not an Elysia or HTTP API — so it is not the boundary this
  repository draws.
- **There is one provider scope.** `export type ProviderScope = "singleton"`
  (`packages/common/src/providers/provider.types.ts:3`); the container holds one
  instance per provider per module (`packages/core/src/container/container.ts:17`).
  There is no per-request provider, and request scope is listed as not
  implemented.
- **The platform already runs hooks around a request, and one consumer already
  does.** `@aponiajs/devtools` mounts a plugin whose `.onRequest(...)`
  (`packages/devtools/src/module/devtools-module.ts:171`) establishes its
  capture and whose `.onAfterResponse({ as: "global" }, ...)` (`:174`) closes it.
  Its guide states why the pair cannot be merged: the arrival hook "rides the
  request phase, which Elysia merges from a used plugin unfiltered", while the
  completion hook must be `{ as: "global" }` to reach routes the plugin does not
  own (`packages/devtools/AGENTS.md:559-563`). The installed Elysia 1.4.30
  (`node_modules/elysia/package.json:4`) declares `onRequest` (`index.d.ts:146`)
  and `onAfterResponse(options: { as: Type }, ...)` (`index.d.ts:897`), with
  `LifeCycleType = 'global' | 'local' | 'scoped'` (`types.d.ts:1083`).
- **A module contributes a native plugin by providing `ELYSIA_PLUGIN`**
  (`packages/platform-elysia/src/plugins/plugin-module.ts:19`, tested by
  `isElysiaPluginModule` at `:83`), and bootstrap mounts it in the module-graph
  pass (`packages/platform-elysia/src/application/application-bootstrap.ts:120`).
  `options.plugins` mount before the graph pass (`:110`); both hook phases run in
  **mount order** (`:104-106`), pinned by
  `packages/platform-elysia/tests/application-plugins.test.ts:105-137`. An
  application can also register a module whose `imports` entry is a call
  expression — `RequestContextModule.forRoot()` — at the cost the CLI documents
  (see "What does not change").
- **The default Problem Details mapping is a route-local `error` hook**
  (`packages/platform-elysia/src/errors/default-exception-filter.ts`,
  `createDefaultExceptionFilter`). A route-local `error` hook travels with the
  route, so a store established in the request phase is still readable when the
  mapping runs.
- **Measured behaviour.** Driving the installed Elysia directly: `enterWith` in
  an `onRequest` hook propagates to the handler, to a route-local `error` hook,
  and to a global `onAfterResponse`; two concurrent requests never see each
  other's store; on a **listening** application a read outside a request answers
  `undefined`; but driving the application through `application.handle()` from a
  **long-lived** async context leaves the last request's store readable in that
  context, and `als.run(undefined, () => app.handle(req))` does not undo it. Each
  of those is a probe run against `packages/platform-elysia`'s Elysia during this
  design.

## What changes

One package changes; the runtime of an application that does not opt in does not.

| #   | Today                                                                                                                             | Change                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A service, repository, or enhancer cannot name the request being served; the fact is only an argument to a handler or an enhancer | An opt-in module establishes a per-request store in the request phase, read through an injectable `RequestContextService`                                     |
| 2   | No correlation id exists                                                                                                          | The store carries a request id: the client's `x-request-id` when it is present and valid, a generated `crypto.randomUUID()` otherwise, echoed on the response |
| 3   | A participant cannot hand a fact to a later participant down the call stack                                                       | A key from `createToken` lets one participant `set` a value and another `get` it within the same request, and nowhere outside it                              |

### 1. `@aponiajs/platform-elysia` gains the store, the service, and the module

The per-request map's key is `@aponiajs/common`'s `InjectionToken<T>`, which
`createToken` produces (`packages/common/src/tokens/token.ts:3`): two keys are
the same key only when they are the same constant, and `T` is erased at run
time. The key names a slot in a per-request map rather than a provider.

Under a new `request-context/` owner directory:

```ts
// packages/platform-elysia/src/request-context/request-context.types.ts
export interface RequestContext {
  readonly request: Request;
  readonly requestId: string;
  get<T>(key: InjectionToken<T>): T | undefined;
  set<T>(key: InjectionToken<T>, value: T): void;
}

export interface RequestContextModuleOptions {
  readonly header?: string; // default "x-request-id"
  readonly generate?: () => string; // default crypto.randomUUID
  readonly echo?: boolean; // default true
}
```

```ts
// packages/platform-elysia/src/request-context/request-context.service.ts
@Injectable()
export class RequestContextService {
  /** The context of the request being served, or `undefined` when none is. */
  current(): RequestContext | undefined;
}
```

The module provides the storage (one `AsyncLocalStorage` per application, the
same object the service reads and the plugin writes), the service over it, and a
native plugin through `ELYSIA_PLUGIN`:

```ts
// packages/platform-elysia/src/request-context/request-context-module.ts
@Module({})
export class RequestContextModule {
  static forRoot(options?: RequestContextModuleOptions): DynamicModule;
}
```

`forRoot` answers the one `DynamicModule` value the application registers. It is
its own value rather than an `ElysiaPluginModule.register` result, because that
builder accepts only `imports` and `providers` and answers no `exports`
(`packages/platform-elysia/src/plugins/plugin-module.ts:94-112`); this module's
value lists `RequestContextService` in `exports`, which `compileDynamicModule`
folds into the compiled module
(`packages/platform-elysia/src/modules/module-compiler.ts:171`), so a module that
imports it injects the service by the graph's ordinary visibility rule.

Module identity is `instanceId ?? id`: `compileModuleGraph` refuses two distinct
definitions that carry one identity with `DUPLICATE_MODULE`, while the same
definition reached twice stays one module
(`packages/core/src/graph/graph-compiler.ts:12-35`). The storage belongs to that
one module, so one store per application requires one definition: a second,
distinct `forRoot()` value either repeats the identity and is refused, or carries
a fresh one and mounts a second plugin over a second store.

The plugin's hook is an `onRequest` that reads the header, validates it,
generates one when it must, writes the response header, and calls
`storage.enterWith(context)`, where `context` is the `RequestContext` above. It
returns nothing, so it cannot become the answer.

The application registers that one value:

```ts
const requestContext = RequestContextModule.forRoot();

@Module({ imports: [requestContext] })
export class AppModule {}
```

A service that wants the context injects the service, and its module imports that
same value (or a module that re-exports it); visibility is the graph's ordinary
rule, not a new one. Usage reads as the three facts the header of this document
names:

```ts
@Injectable()
export class OrdersService {
  constructor(private readonly context: RequestContextService) {}

  place(order: Order) {
    this.context.current()?.requestId; // the correlation id
    this.context.current()?.request; // the Request itself
    this.context.current()?.get(TENANT_KEY); // a value a guard stored
  }
}
```

A guard stores a value the same way, because a guard runs inside the request:

```ts
export const SUBJECT_KEY = createToken<{ id: string }>("subject");

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly context: RequestContextService) {}

  canActivate(execution: ExecutionContext) {
    this.context.current()?.set(SUBJECT_KEY, { id: readSubject(execution) });
    return true;
  }
}
```

## The contract this settles

- **Reach.** A participant that runs while a request is being served reads the
  request, its id, and every value stored under a key by calling
  `RequestContextService.current()`. On a listening application a read outside a
  request is `undefined`; in a long-lived `application.handle` caller it is the
  last request's store instead, as "What remains" states. Nothing throws for
  absence.
- **One store per request.** The store is established once, in the request phase,
  and every participant in that request — a handler, a guard, an interceptor, a
  filter, the default Problem Details mapping, a service, a repository, a timer
  the request started — observes the same object.
- **Isolation.** Two requests in flight at once never observe each other's store,
  including two that overlap on the same microtask turn. This is the property a
  process-global variable cannot have and the reason the mechanism is
  async-local rather than global.
- **Identity.** `requestId` is the accepted incoming value of the configured
  header when one arrives and is valid, and a generated id otherwise. The
  accepted value is echoed on the response under the same header name.
- **Opt-in.** The store exists only in an application that imported
  `RequestContextModule`. An application that did not mounts no plugin, resolves
  no storage, and answers no such header; its boot is byte-for-byte what it was.
- **No new error code.** Absence is `undefined`, not an `AponiaError`; the closed
  error union is not widened.

## Options considered and rejected

- **Threading the context through every signature.** The obvious alternative, and
  the one the framework already uses inside the route: pass the context down.
  Rejected because it changes every service signature in every application, and
  because the fact is needed by code the route never calls — a repository a
  service reaches, a timer a handler started, an enhancer the route does not
  name. An argument reaches exactly the callee in front of it.
- **A per-request provider scope (Nest's `Scope.REQUEST`).** Rejected. Scopes are
  explicitly out of this release (`ProviderScope = "singleton"`,
  `packages/common/src/providers/provider.types.ts:3`), and request scope bubbles:
  every provider that injects a request-scoped one becomes request-scoped itself,
  which inverts the container's eager-instantiation model. This design adds no
  scope — the reading service stays a singleton and only the store is per
  request.
- **Elysia's `derive` or `resolve` to publish a value on the context.** Rejected.
  It reaches a handler's or a hook's own context — the same reach `@Ctx()`
  already has — not a service, and it also moves the route onto Elysia's async
  composition path, which the platform is deliberate about keeping synchronous
  routes off.
- **Reading the devtools request record.** Rejected. `@aponiajs/devtools` is a
  leaf nothing in the framework depends on; its record is bounded and drops
  entries; and it holds arrival facts rather than values a guard stored. A
  debugging surface is not a production input.
- **A process-global "current request" variable.** Rejected. Two in-flight
  requests overwrite each other, so it is not concurrency-safe, and the framework's
  own state is per-instance (`container.ts:17`), not global.
- **Putting the storage in `@aponiajs/common`.** Rejected. The store is
  established and read by an Elysia lifecycle hook, which `common` may not name.
  The _key_ is neutral and does belong in `common`; the storage, the hook, and the
  HTTP header are the platform's.
- **Using the W3C `traceparent` header for the id.** Rejected, though standards
  usually beat bespoke contracts. `traceparent` is a trace contract — version,
  trace-id, parent-id, flags — with its own propagation rules, and reading it for
  a request id without propagating a trace would state a trace that does not
  exist. A plain configured `x-request-id` is the smaller honest choice; adopting
  `traceparent` properly is its own decision (see below).
- **Echoing the client's `x-request-id` verbatim.** Rejected. An unbounded,
  unvalidated value on a client-visible response header is an injection surface
  (a long header is echoed verbatim by the platform today). The design validates
  the incoming value — non-empty, printable, bounded in length — and generates an
  id when it fails, rather than echoing whatever arrived.
- **Wrapping `application.handle` in `als.run` to contain the store.** Rejected
  on evidence: a probe showed the run isolates the call it wraps but cannot undo
  the ambient mutation the hooks already performed on the enclosing context, and
  it addresses one driver, the platform's one-line delegation at
  `packages/platform-elysia/src/application/aponia-elysia-application.ts:18-20`,
  and not the server path at all. The leak it would try to close is stated
  instead (see "What remains").
- **A bare accessor or hidden inference** — a property on the route context, or
  "just read the request wherever you are". Rejected for the same reason the
  framework rejects an inference-based route API and ambient plugin registration
  through declaration merging: the reach must be something the reader can see.
  Here it is explicit — inject `RequestContextService` and call `current()` — and
  a service that never asks for the service never gets the context.

## What does not change

- **No provider scope is added.** `ProviderScope` stays `"singleton"`
  (`provider.types.ts:3`). The container, its per-module caching, `ModuleGraph`
  visibility, eager validation, and every existing `AponiaErrorCode` are
  untouched. The reading service is an ordinary singleton over a store it holds.
- **`RouteContext` and `ExecutionContext` are unchanged.** The framework keeps
  handing the request to a handler and to an enhancer as an argument
  (`route-schema.types.ts:88`, `enhancer.types.ts:29`); this is an addition for
  the code those arguments cannot reach, not a replacement, and it adds no
  hidden inference to a route handler.
- **No Elysia `derive`/`store`/`resolve` reliance and no plugin registry.** The
  module mounts one ordinary native plugin through `ELYSIA_PLUGIN` in the pass
  the framework already runs (`application-bootstrap.ts:120`).
- **The error path is unchanged.** The default Problem Details mapping stays a
  route-local `error` hook with its current exclusions; the store is simply
  readable inside it, as the probe shows. No error code is added, and the
  `elysia: { aot: false }` behaviour is not affected.
- **Boot order is unchanged for an application that does not opt in.** No plugin,
  no provider, no hook, no header — no line in the boot log differs. An
  application that does opt in mounts one plugin in the existing module-graph
  pass, in the position its `imports` entry holds, and pays one hook per request.
- **The CLI and its AOT build are unchanged.** The cost is the one devtools
  already documents: a registration is a call expression
  (`RequestContextModule.forRoot()`), and `aponia build` lowers a module only when
  every `imports` entry is a single identifier
  (`packages/cli/src/generation/descriptor-emitter.ts:554-573`,
  `readEntryReference`), so the module that writes the registration is declined
  and boots from its decorators. Where that module is the root, the committed
  descriptor artifact keeps serving a graph without the registration in it. The
  escapes are devtools' own: accept the decorated boot for that module, or — once
  the framework makes a framework-provided module declarable — register it by a
  bare identifier. This document does not settle the second (see below).

## Delivery order

1. **`@aponiajs/platform-elysia`** — the `request-context/` domain: the storage,
   `RequestContextService`, the plugin hook, the header handling, and
   `RequestContextModule.forRoot`. Export the public names (service, module,
   types) from the package barrel, and add `request-context` to this package's
   directory list in `scripts/source-layout.spec.ts`.
2. **Tests in both lanes** — see "Testing".
3. **Documentation in the same pull request** — a `docs/request-context.md`
   reference page, its row in the `docs/AGENTS.md` table, the affected section of
   `packages/platform-elysia/README.md`, and the new exports in
   `packages/platform-elysia/llms.txt` (guarded by
   `scripts/package-llms.spec.ts`). Public behaviour changed, so the version is
   raised with `bun run version:alpha` and committed with the change.

## What remains, deliberately

- **The store leaks into a long-lived `handle` caller.** On a listening
  application, a read outside a request is `undefined`. When an application is
  driven with `application.handle()` from a long-lived async context — which is
  what the testing guide tells people to do — `enterWith` mutates that context,
  so the last request's store stays readable there until it is replaced. This is
  inherent to `enterWith`: nothing can wrap the downstream of an `onRequest` hook
  in a `run`, because the continuation happens in the same async context the hook
  returned into. The stated answer is that the store is meaningful only inside a
  route, and `current()` returning a stale store outside one is not a fact a
  caller may rely on. A remedy that wraps the platform's own `handle` is
  future work, not part of this design.
- **No propagation across boundaries the async context does not cross.** The
  store follows the request's promise chain and its timers; it does not reach a
  worker thread or a native callback the runtime does not associate with the
  request. The design claims exactly the reach async-local storage has and no
  more.
- **No automatic logging.** The id is available on the store; putting it on every
  log line is a logger change, which is the logger-seam design's ground, not this
  one's.
- **No trace propagation.** No `traceparent`, no outgoing header injection, no
  cross-service propagation. The id is per-process.
- **No per-request DI scope, no request-scoped providers, no request-scoped
  lifecycle hooks.** Only the store is per request.

## Testing

The Bun lane boots applications through `AponiaFactory.create` and asserts over
`application.handle` and over a real `listen`, per the repository's testing
guidance; the Vite+ lane mirrors the types and the public surface.

- **Reach.** A booted application importing `RequestContextModule` runs a handler
  that reads `current()?.request` and `current()?.requestId`, a service three
  calls down that reads the same store, and a guard that `set`s a value under a
  key the service then `get`s. Each asserts the value the same request put there.
- **The error path.** A handler that throws is answered by the default Problem
  Details mapping, and a route-local `error` hook reports the same `requestId` the
  handler saw — the case a store established only for the happy path fails.
- **Isolation.** Two overlapping requests with distinct incoming ids each read
  back their own value, asserted together so an implementation that used a
  process-global variable cannot pass.
- **Identity.** An absent header yields a generated id echoed on the response; a
  present, valid header is echoed verbatim; an empty, over-long, or non-printable
  header is replaced by a generated id and the response carries the generated
  one. The response header is asserted on a `200` and on a mapped `500`.
- **Absence.** With no request in flight — inside `listen`, on the server's own
  tick — `current()` answers `undefined` and throws nothing.
- **Opt-out.** An application that does not import the module serves no
  `x-request-id` header, mounts no request-phase hook, and logs no new boot line.
- **The key.** `get`/`set` infer `T` from the key, not from the value.

## What this document does not decide

- **Whether a framework-provided module can be declarable by the AOT build.**
  `RequestContextModule.forRoot()` is a call expression, so it declines its
  module exactly as `DevtoolsModule.register` does. Whether this design instead
  ships a static `RequestContextModule` importable by a bare identifier — and what
  that requires of the emitter's reading of a module that lives in a package
  rather than in the project — is left open, and it is the same gap devtools
  documents.
- **The exact header name and its full validation rule.** `x-request-id` is the
  default; the bound, the printable set, and whether trailing whitespace is
  trimmed are left to implementation.
- **Whether `ExecutionContext` gains a `getRequestContext()` convenience.**
  Nothing in this design needs it — an enhancer injects the service like any
  other provider — but a symmetric accessor is a reasonable follow-up and is not
  decided here.
- **Whether a future non-Elysia platform reuses the same `AsyncLocalStorage`
  shape or the same key type.** The key is `common`'s token so it can be reused;
  the storage is the platform's and is not promised to any second adapter.
- **Whether the request id joins the logger's context lines.** That is the
  logger-seam design's decision, and this design only makes the id reachable for
  it.
