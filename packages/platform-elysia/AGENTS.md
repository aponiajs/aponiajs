# @aponiajs/platform-elysia — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The Elysia adapter: it lowers decorated classes into descriptors, bootstraps the
application, maps HTTP routes and WebSocket gateways, and mounts native plugins.
It depends on `common` and `core`, with `elysia` as a peer.

| Domain         | Owns                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `application/` | Factory orchestration, application lifecycle wrapper, public option contracts                    |
| `modules/`     | `compileRootModule` and decorator-to-descriptor lowering                                         |
| `controllers/` | Controller descriptors, direct registration, enhancer resolution, `ELYSIA_CONTROLLER`            |
| `errors/`      | Typed HTTP errors, RFC 9457 Problem Details responses, and the default mapping                   |
| `inspection/`  | Read-only projection of a compiled application for build-time consumers                          |
| `plugins/`     | Native plugin module registration and plugin contracts                                           |
| `routing/`     | Route plans, compiled invokers, schemas, and native context types                                |
| `websockets/`  | Provider discovery, gateway plans, message dispatch, and native socket types                     |
| `version.ts`   | The package's own version, read from its manifest, which generated artifacts are checked against |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- Bootstrap order is load-bearing: logger, compile and create the container,
  create the root Elysia named after the root module id with its explicit
  compilation policy, mount the application's own `plugins` entries, first pass
  mounting plugin modules and eagerly
  instantiating providers, controller mounting, await native plugin composition,
  WebSocket gateway registration and initialization, then await
  `nativeApplication.modules` again.
  `configureNative` must return the instance it receives. The application's own
  enhancer declarations resolve between the first pass and the controller loop.
- `AponiaApplicationOptions.plugins` mounts native plugins on the root
  application from the options, beside the module-graph pass and before it, and
  it is a whole-plugin mount rather than an alternative module registration. An
  entry is the plugin value itself — nothing resolves from the container on this
  path, so no entry can fail a boot — and an entry that is `undefined` mounts
  nothing, which is the shape a plugin factory states a decision with. The
  element type is `NativeElysiaPlugin | undefined` from `plugins/plugin.types.ts`
  so an entry is exactly what `.use()` accepts. Both hook phases run in mount
  order, so a hook declared here runs before one a module's plugin declares;
  `tests/application-plugins.test.ts` pins that order and the option's three
  shapes. The option exists for the plugins no module can declare — an `imports`
  entry that is a call expression declines the module that wrote it, and a
  declined root leaves the committed descriptor artifact serving a graph the
  registration is not in — and it is deliberately not an `imports` option on the
  factory, because an option is not in the descriptor and the declared graph
  would miss it for the same reason. Nothing about an entry reaches
  `compileRootModule`, inspection, or a generated artifact, so it is never a
  substitute for a module registration a module could have made.
- Decorated controllers register their compiled route plans directly on the
  root Elysia instance. Low-level controller descriptors retain `buildPlugin`
  as their compatibility and escape-hatch path.
- Every dispatch that mounts a route states what it runs. A controller whose
  descriptor carries a compiled plan is mounted from that plan by bootstrap
  itself, with the enhancer resolution that plan's hooks are built from — both
  the application's own declaration and the resolution of the controller's own
  — so a plan is never mounted without them. A controller without a compiled
  plan mounts through the callback it was defined with, and that callback owns
  its routes' hooks: the platform never compiled them and has nothing to merge
  into. A plugin a definition's `buildPlugin` builds outside a boot resolves
  nothing, so `unmountedRouteEnhancers` is what it mounts with. A global
  enhancer is the application's declaration and resolves once, through the root
  module, so it reaches every route the platform mounts whatever module mounted
  it, and a class the root cannot reach fails the boot with `MISSING_PROVIDER`.
  `registerCompiledElysiaRoutes` takes that resolution as a required parameter
  for the same reason: a mount that merged nothing has to say so at the call
  site rather than omit it.
- A route's enhancers compile onto the route-local hooks their kind maps to:
  guards and an interceptor's `interceptBefore` join one `beforeHandle`, an
  interceptor's `interceptAfter` is an `afterHandle`, and a filter joins the
  route's `error` array the next bullet describes. Guards and before halves
  share one hook function so their order is the one the code states — the guards
  in declaration order, with the application's own declarations before the
  route's, then the before halves — rather than the order Elysia's own
  registration would produce. The after halves run over that whole list
  reversed, so the outermost interceptor's half runs last; each receives what
  the previous one returned, and `undefined` is the only answer that leaves the
  response unchanged, while `null`, `false`, and `0` are responses. An after
  half never runs when a guard or the handler threw, because Elysia never
  reaches the hook; the platform adds no check of its own for that. Every
  compiled hook is an asynchronous function, so a route carrying any enhancer
  half is Promise-capable whatever its handler is. A guard that refuses throws
  `httpErrors.forbidden(...)`, and that throw is the whole refusal: the throw
  reaches the route's own error path, where the `HttpError` is declined by the
  default mapping below and Elysia answers it through its own `toResponse()`. A
  route that declares no enhancer carries no `beforeHandle` and no `afterHandle`,
  and no `ExecutionContext` is built for one; the one hook it does carry is the
  default mapping. `routing/route-compiler.types.ts` declares the route hook the
  platform mounts, so a lifecycle member is added there rather than by widening
  the native signature.
- An enhancer named by a decorator, a declared plan, or an option is resolved as
  a provider while its controller mounts — once per distinct class, never per
  route or per request — and enhancers are singletons like every other provider.
  A class the graph cannot reach fails the mount with `MISSING_PROVIDER` rather
  than leaving a route quietly unguarded, unwrapped, or unfiltered.
- Every route the platform mounts from a compiled plan carries the default
  Problem Details mapping last in its own `error` array, behind the filters it
  declares, so the array reads `[...method, ...controller, ...global, default]`;
  the two mounts the bullet above leaves without a compiled plan carry no `error`
  array at all, and no enhancer hook either. Declared filters run
  most-specific-first — the reverse of the guard and `interceptBefore` order —
  and the first entry that returns anything other than `undefined` or `null`
  answers: those two are what Elysia's error path reads as no answer, so a filter
  returning `false`, `0`, or `""` answers with it rather than declining. A
  declared filter is consulted for every exception its `@Catch()` matches, an
  `HttpError`, a validation `422`, and a guard's refusal included; declining
  those is the mapping's own rule, not the array's. The
  mapping is built once from the
  boot's system logger and compiled into each route while it mounts, never
  registered on the root application: Elysia puts the application's handlers
  ahead of a mounted route's own, so a root hook would outrank every declared
  filter, and one registered after controllers mount reaches no route at all.
  It reports an unhandled failure through the logger under `ExceptionsHandler`
  and never lets the stack or the cause reach the response, and it declines
  whatever Elysia's own error path answers, by the same test Elysia applies: an
  `ElysiaCustomStatusResponse`, an exception carrying a numeric `status` or a
  `toResponse()`, and a context whose status was already decided — a number at
  or above `300` other than the generic `500`, or a status name. That keeps
  validation `422`s, parse `400`s, the `status()` escape hatch, `HttpError`
  (through its own `toResponse()`), and a failed `t.Transform` decode — which
  Elysia answers `422` and then rethrows the decode function's own plain `Error`
  for — exactly as Elysia answered them before the mapping existed. It also
  records the exception it mapped, keyed by the request the hook saw, in a
  `WeakMap` the boot owns and publishes on its diagnostics record: the `Response`
  the mapping returns is not on the after-response context, so that record is the
  only place a consumer reporting what a request received — the devtools
  `/requests` entry — can read it. Recording is the hook's whole second job and
  it returns the `Response` it always returned, because a hook in Elysia's error
  path that could change which handler answers would be a different answer rather
  than a report of one. The record is written before the logger is called, and
  the call is guarded: a logger that throws as it reports the failure leaves both
  the record and the Problem Details answer intact, because the response depends
  on the hook returning and a logger an application supplies may throw. Such a
  logger is reported on `stderr` by a direct write — the only place this package
  writes a process stream — because the channel that would normally carry the
  diagnostic is the one that failed. No other framework call site is guarded: a
  logger that throws while the boot logs its routes fails the boot. The projection
  is the one the devtools log stream applies
  to a line, restated here branch for branch because the two packages do not
  depend on each other, and it is guarded so a thrown value that refuses to be
  projected is recorded as a literal rather than allowed to throw inside the
  error path. A
  declared
  filter that throws is caught, logged the same way, and treated as declining,
  so the array continues to what answers next. The
  default hook is synchronous, so a route with no declared filter compiles the
  way it compiled before the mapping existed; a route with one carries an
  asynchronous hook per filter, because answering may await. A route-local
  `error` array is read only while Elysia composes routes ahead of time, so
  `elysia: { aot: false }` disables the mapping and every declared filter —
  only the `error` hook kind — and `bootstrapAponiaApplication` warns under
  `RoutesResolver` when the option is set rather than letting that boot look
  like the default one.
- `routing/native-route.ts` is the only module that calls Elysia's route
  registration API. A version that moves it fails there as
  `UNSUPPORTED_ELYSIA_VERSION` instead of as a bare `TypeError` from inside a
  compiled dependency. Do not call `.route()` anywhere else.
- `modules/route-uniqueness.ts` rejects a route two different declarations
  claim, raising `DUPLICATE_ROUTE` from `compileRootModule` with the method,
  path, both modules, both controllers, and both handler keys. Elysia would
  otherwise resolve a repeated `(method, path)` by whichever registration wins
  under `elysia.aot`, so the answering handler would follow a compiler flag.
  The check reasons over the modules reachable from the compiled root by
  `imports` — the set `compileModuleGraph` mounts — because the module
  compiler's working maps also hold definitions the root never reaches. One
  `(controller, handler)` declaration reached through two of those modules, as
  a dynamic module merged onto a decorated class produces, repeats one route
  rather than claiming it twice, and stays supported. Routes a native plugin
  provides stay outside the check: plugins mount through `use()`, and a
  controller overriding one is Elysia's documented behavior. A low-level
  controller descriptor builds its routes in a callback that needs an instance,
  so it carries no route plan and, like inspection, contributes nothing to the
  check. `compileRootModule` is where the check lives so
  `inspectAponiaApplication`, which lowers through it, raises the same code for
  the same application.
- Route parameter binding is compiled once while the controller is mounted.
  Generated invokers must expose each used context field directly and call the
  controller with `handler.call(instance, ...)`. A route keeps the synchronous
  invoker only when the handler's own function kind or its emitted
  `design:returntype` metadata proves a synchronous return; nothing else can
  prove one, so every other route is compiled Promise-capable, which costs at
  most one already-settled `await` per request. The handler source is never
  consulted: a Promise returned without a call expression
  (`return this.pendingLookup`) leaves no trace to match, and a synchronous
  invoker runs `onAfterHandle` before Elysia awaits that Promise, exposing the
  raw Promise to the lifecycle. Elysia compiles handlers by statically reading
  their source (sucrose): `Reflect.apply` hides required fields, while
  forwarding context through a generic mapper makes Elysia materialize every
  optional field on every request.
- `AponiaApplicationOptions.invokers` accepts the artifact `aponia build`
  writes. Its invokers are keyed by controller class token, and each factory
  builds a map keyed by handler property key once the container has created the
  controller instance. A controller without an entry, a property key missing
  from a supplied map, and a symbol-keyed handler all fall back to compiled
  binding, and an entry for a token no controller uses is ignored. The option is
  never mutated.
- `AponiaRouteInvoker` declares its context parameter `never`, for the same
  reason `AponiaControllerInvokerFactory` does with its instance parameter: an
  invoker is written against its own route's annotations
  (`@Body() body: CreateUser`), which `RouteContext` cannot describe, and a
  parameter that accepts nothing is the one type every such function is
  assignable to. A generated module therefore needs no cast for the artifact to
  be assignable to the option, and a hand-written invoker annotates the
  parameter itself when it reads the context. `registerCompiledElysiaRoutes` is
  the single place a supplied invoker is widened to the annotation the platform
  calls one with; the compiler's own handler needs no widening, and only the
  platform ever calls an invoker. Testing this contract is what
  `tests-vp/route-invokers.conformance.ts` is for: it pins the type, pins the
  generated shape's assignability, and boots the README's own map literal.
- `routing/invoker-artifact.ts` refuses an artifact whose `framework` is not
  `version.ts`'s own version, and one that carries no invoker map, before any
  controller mounts. A refusal is not an error: the fallback is the compilation
  the platform would have done without the option, so a stale or hand-edited
  file costs a cold start rather than a wrong binding, and supplying an artifact
  can never make a bootable application fail. The refusal is reported through
  the system logger under `RoutesResolver` and names both framework versions and
  the Elysia the artifact was generated against; the selector returns that
  decision — the invokers or the reason for their absence, and the artifact's own
  release stamp when it adopted them — so the boot publishes the same sentence in
  its own record instead of restating the rule. That stamp is `null` for every
  other case, including a refusal, because a refused artifact names a release
  this boot is not. `elysia` is
  recorded as provenance rather than re-read at run time: the supported Elysia
  range is already enforced by the peer dependency and by
  `routing/native-route.ts`'s structural guard, and reading an installed
  manifest at bootstrap would add a resolution this package does not otherwise
  need.
- `AponiaApplicationOptions.descriptors` accepts the descriptor artifact
  `aponia build` writes, and `modules/module-descriptor-artifact.ts` selects the
  root module from it before anything is compiled. The two artifacts are refused
  the same way for the same reason, but not with the same consequence: an invoker
  artifact substitutes one handler at a time, while a descriptor artifact _is_
  the module graph, so the choice is made once and applies to the whole
  application. A descriptor is used only when the artifact is stamped with this
  release, carries a module record, and holds a declaration for the name of the
  module the application passed; every other case lowers that module from its
  decorators, so a stale, foreign, truncated, or hand-edited file costs the
  lowering the descriptor was meant to remove and never a boot that cannot start.
  The lookup is by class name because that is what the artifact is keyed by, and
  it is also what closes the rename hole: a root renamed since the last build has
  no entry, so the entry left behind cannot boot a graph the application no
  longer declares. The choice is reported under `RoutesResolver`, once, whichever
  way it went, because an application booting from data has to be able to say
  which graph served it. The selection carries the artifact's own release stamp
  beside it, and that stamp is `null` in every case where no artifact was adopted
  — refused, absent, or a descriptor the caller passed instead of a class, which
  names the graph itself and was emitted by no build. A root passed as a
  descriptor rather than as a class
  names the graph itself, so the artifact is not consulted, and a structural
  `isModuleDefinition` guards the selected entry rather than trusting the option's type:
  a JavaScript caller has no type checker, and a truncated descriptor reaching
  the graph compiler is the one outcome this option must never cause.
- `bootstrapAponiaApplication` attaches one boot record to the native application
  it returns, under `Symbol.for("aponia.application.diagnostics")`, and
  `readApplicationDiagnostics` is its only reader. The property is non-enumerable,
  non-writable, and non-configurable, and the record is frozen: this is a seam,
  not shape, because Elysia composes by walking an instance's keys, and an
  application no boot produced — a plain `Elysia`, a plugin instance — must read
  as `undefined` rather than as an empty record. The record is attached once the
  container holds every plan and before the gateway work, and it states what the
  boot decided and mounted: the release, whether the graph it served was
  `"declared"` or `"decorated"` — decided by the shape of the root
  `selectRootModuleDescriptor` resolved, never by re-reading the artifact:
  `"declared"` when that root is a `ModuleDefinition`, and `"decorated"` when it
  is a class or a dynamic module, both of which the boot lowers — the invoker
  artifact's verdict with the selector's own reason, which release supplied each
  artifact the boot adopted and `null` for one it did not, so a hand-written
  descriptor is never reported as generated data, the root `compileRootModule`
  returned, every compiled plan its controllers mounted with the binding that
  serves it, every route a controller mounted itself (a controller that carries
  no compiled plan — a direct registration callback, or the plugin a low-level
  descriptor builds — contributes to `callbackRoutes` instead, because its routes
  have a method and a path and neither the module nor the controller that mounted
  them anywhere else), the application's own enhancer declaration, which no
  plan carries because a plan states only what its route declares, which halves
  of the interceptor lifecycle each resolved interceptor class implements — read
  from the instance the container resolved while that class mounted rather than
  from the class token's `prototype`, because a half written as a class field is
  an own property of the instance and of no token, and copied so the record never
  lends out the map the boot was still filling — and the
  `WeakMap` the default mapping records its answers in. That last field is the
  record's one live fact rather than a decision the boot made: it is published as
  the boot handed it over — not copied, because copying would publish a snapshot
  of a table still being written — and it is per boot, so two applications built
  from one module class never share one. Which binding
  serves a plan is the mount's own decision, never a consumer's re-derivation:
  `registerCompiledElysiaRoutes` returns the property keys a supplied invoker
  bound, and the boot hands that set to the record. Consumers
  project this record; they never re-apply a selector's rule to reach the same
  answer.
- `defineElysiaControllerRoutes` is the descriptor path's counterpart to
  `@Controller()` and its route decorators: it compiles `ElysiaRoutePlan` values
  through the same lowering a decorated controller uses, so a declared
  controller reaches the same native version guard, duplicate-route check,
  startup logging, and `invokers` lookup. A plan never registers itself on
  Elysia — `routing/native-route.ts` stays the only module that calls the native
  route API. The two facts decorators read from emitted metadata are declared
  instead: `takesContext` (omitted means the handler receives nothing) and
  `promiseCapable` (omitted means Promise-capable, the direction that cannot
  change what a lifecycle hook observes). `compileElysiaRoutePlan` synthesizes
  `declaredParameterCount` rather than leaving it undefined, because
  `undefined` sends the runtime's whole-context fallback back to reading the
  handler's own source, which is the inference this path removes.
- `registerCompiledElysiaRoutes` rejects a route handler that is a class
  constructor with `INVALID_CONTROLLER` while the controller mounts. A class
  passes the callable check and then throws a raw engine message on every
  request, so the guard must run before an invoker is selected for that route.
- `toElysiaSchema` is the single boundary where a `NativeSchema` is restored to
  a TypeBox `TSchema`. Cookie validators and every member of a status-specific
  response map pass through that boundary. Nothing else in the workspace may
  assume TypeBox.
- Decorated modules, controllers, and `@Validation()` model classes are the
  normal application path. Resolve each validation model once inside route
  registration, pass its exact raw validator to Elysia, and keep direct
  validators plus native controller registration as escape hatches. Never add
  model reflection or validation work to the request hot path.
- `ElysiaRouteContext` and `ElysiaStatus` lower model classes through a type-only
  Standard Schema projection. Keep that projection aligned with runtime route
  lowering, including status-specific response maps; it must never read model
  metadata or construct validators.
- A direct `registerRoutes` callback may return its fluent Elysia chain to
  preserve the route contract for Eden, or return `void` for compatibility. It
  must never return a different Elysia instance.
- `elysiaController` is the concise direct-registration facade. Its callback is
  the native escape hatch when Elysia inference is more useful than decorator
  metadata; `defineElysiaController` remains the advanced descriptor API.
- `HttpError` serializes application failures as RFC 9457 Problem Details. Its
  response never includes its stack or cause, and the `httpErrors` factory set
  must cover every 4xx and 5xx status exported by the supported Elysia version.
- `ElysiaRouteContext` merges plugin types the way Elysia's own `.use()` does:
  `~Singleton` for `decorator`, `store`, `derive`, and `resolve`, plus
  `~Ephemeral` derives and resolves. `~Volatile` stays excluded because a
  plugin-local derive never reaches a controller mounted beside the plugin.
  Runtime and type must move together.
- The first type argument accepts either a schema or the plugins. An
  all-optional `InputSchema` also matches an Elysia instance, so the conditional
  tests the plugin shape first.
- `defineElysiaPlugin` exposes the plugin on a real `plugin` property, never a
  phantom type, so the value is inspectable at runtime.
- Verify a fallback controller's `buildPlugin` result is a real `Elysia`
  instance and raise `INVALID_CONTROLLER` when it is not.
- A gateway is a class provider, declared or decorated. Bootstrap compiles the
  plan a provider carries when it has one and otherwise reads
  `@WebSocketGateway()`/`@SubscribeMessage()` off `useClass`; either way it
  resolves the existing provider token through `resolveModuleProvider` and never
  constructs a second instance. Both readings produce the same compiled plan, so
  a duplicate path, a duplicate event, and every other rejection come from one
  check at one moment with one code. `defineElysiaWebSocketGateway` is the
  descriptor path's counterpart to those decorators: a plan never registers
  itself, and `websockets/websocket-gateway.ts` stays the only module that calls
  `application.ws()`. A plan states only what a decorator records as metadata —
  path, handlers with their parameter bindings, server properties —
  because `afterInit`, `handleConnection`, and `handleDisconnect` are resolved
  from the instance while the gateway is bound and a plan has nothing to add.
- Canonical gateway paths and message events are unique before routes mount.
  One gateway maps to one native `application.ws()` route. A collision with a
  configured or plugin-provided native WS route must fail deterministically.
- Compile `@MessageBody()` and `@ConnectedSocket()` arguments during bootstrap.
  Preserve `undefined` as no response and every other value as data;
  `WsResponse`, Promise, generator, and async-generator results retain their
  documented behavior.
- WebSocket exception frames expose only a stable code and safe message.
  `@WebSocketServer()` receives the root Elysia application before
  `afterInit`; connection and disconnection lifecycle return values are never
  sent to clients.
- `inspectAponiaApplication` is a projection, never a second compiler. It runs
  bootstrap's own lowering (`compileRootModule`, then `createContainer`, then
  `compileElysiaWebSocketGateways`) and reads the resulting descriptors, so it
  constructs no provider and no controller instance and raises the same
  `AponiaError` codes bootstrap raises for the same application. Give it new
  data by reading a descriptor, never by re-deriving compilation.
- Inspection output is plain, deeply frozen, and JSON-serializable: no
  validator, function, class instance, or raw symbol may reach it. Symbol
  module identities and symbol handler property keys are projected with
  `String(symbol)`, which keeps the `Symbol(description)` marker readable.
- Inspection ordering is part of the contract. Modules keep graph order,
  providers and gateway events keep declaration order, routes sort by path,
  method, controller, handler, and module, and gateways sort by canonical path.
  Comparisons stay code-unit based so every runtime orders identically.
- A controller mounted through the low-level descriptor path builds its routes
  in a callback that needs an instance, so it is listed in its module's
  `controllers` and contributes no `routes` entry. Controllers bootstrap would
  refuse still fail inspection with `UNSUPPORTED_CONTROLLER`.
- Inspection reads each provider's dependencies through `providerDependencies`
  from `@aponiajs/core`, the same function the container resolves through. Never
  restate that switch here; a new provider kind must land in one place.

## Elysia version compatibility

The peer range is `^1.4.29`; every workspace manifest must declare the same
range. Two ranges that disagree make Bun install two copies, and a controller
typed against one is not assignable to the other.

Elysia 2 is a prerelease on the `next` dist-tag and is not supported. Its
incompatibilities were verified by running `2.0.0-beta.19`, not by reading the
release notes, because the published docs are still 1.x:

| Call site                                                                     | Elysia 2                                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `routing/native-route.ts`                                                     | `route(...)` removed; `method(method, path, hook, handler)` swaps the last two arguments |
| `routing/route-compiler.ts` (`TSchema`)                                       | no longer root-exported; import from `typebox`                                           |
| `routing/route-context.types.ts` (`SingletonBase`)                            | no longer root-exported; import from `elysia/types`                                      |
| `routing/route-context.types.ts` (`~Singleton`/`~Ephemeral` `resolve` keys)   | `resolve` removed; its timing folded into `derive`                                       |
| `errors/http-error.ts` and `errors/http-error.types.ts` (`InvertedStatusMap`) | renamed to `StatusMapBack`                                                               |

`docs/elysia-compatibility.md` is the user-facing half of this. Update both
together, and re-verify against a real install rather than the blog post.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+.
Prefer building an application with `AponiaFactory.create` and asserting through
`application.handle(new Request(...))`.

`tests/plugin-context.test.ts` and `tests/plugin-definition.test.ts` hold
compile-time assertions beside their runtime cases; they fail `bun run check`
when a plugin type is lost or widened. Keep both lanes in step when the context
mapping changes, and document behavior in
[`docs/native-plugins.md`](../../docs/native-plugins.md).

WebSocket behavior belongs in `tests/websocket-gateway.test.ts`, with the public
contract mirrored in `tests-vp/websocket-gateway.conformance.ts` and a real
socket path in `examples/websockets/`.

Inspection behavior belongs in `tests/inspection.test.ts`, mirrored in
`tests-vp/inspection.conformance.ts`. Cover shapes, ordering, frozen-ness,
serialization, and the `AponiaError` codes inspection shares with bootstrap;
assert on codes, never on message text.
