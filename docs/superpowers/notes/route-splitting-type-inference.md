# Route splitting and end-to-end type inference

Investigation note. Read-only work: every claim below was probed against this
working tree (`tanya`, `1.0.0-beta.0`) with throwaway scripts under `/tmp` and
`tsc`; nothing in the repository was changed to produce it.

The question is Elysia issue #138 — splitting routes across files without losing
end-to-end type inference. Eden derives its types from the accumulated `Elysia`
instance type (`MergeElysiaInstances` folds each instance's `~Routes`; see
`node_modules/elysia/dist/types.d.ts:953` and
`node_modules/elysia/dist/base.d.ts:29`), so a client's inference is only as good
as what statically reaches the application value.

## 1. What a descriptor carries

A compiled route is `CompiledElysiaRoute`
(`packages/platform-elysia/src/routing/route-compiler.types.ts:118-129`). It
carries `method`, the **joined** `path`, `propertyKey`, `parameters`,
`capabilities`, `schema`, `declaredParameterCount`, `declaredReturnKind`, and
`enhancers`. `schema` is a `RouteSchema | undefined`
(`packages/platform-elysia/src/routing/route-plan.types.ts:51`), whose slots are
`body`, `query`, `params`, `headers`, `cookie`, `response`
(`packages/common/src/routing/route-schema.types.ts:54-61`), with `response`
accepting one validator or a status-keyed map
(`packages/common/src/routing/route-schema.types.ts:50`).

Probed at runtime (`compileRootModule` on a decorated controller with
`@Post("/", { body: CreateUser, response: { 200: t.Object(...) } })`):

```
--- POST /users ---
  body is function (model class): true
  body name: CreateUser
  response: {"200":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}}
  schema object frozen: true
```

So the status-specific response map survives intact, and the runtime descriptor
holds the **declared** value: a `@Validation()` model slot is still the class,
resolved to a raw validator only while the route mounts — `toSchemaHook` builds
the Elysia hook at `packages/platform-elysia/src/routing/route-compiler.ts:675-689`,
`toElysiaSchema` at `:699-701`, `toElysiaResponseSchema` at `:703-715`, and the
model read is `resolveRouteValidator` in
`packages/common/src/routing/validation.ts:39-51`.

The generated artifact is stronger than the runtime one. `aponia build`
resolves each model slot to the validator it declared and writes the expression
verbatim (`packages/cli/src/generation/descriptor-emitter.ts:719-736` and
`:763-825`), which is visible in the committed template
(`packages/cli/templates/application/src/descriptors.generated.ts.tmpl`).

### Fields a typed client would need that the descriptor does not carry

- **The handler's return type.** The descriptor records `propertyKey` only, so
  nothing links a route to `TController[key]`'s return type. Eden reads responses
  from the schema, so this only matters for a route that declares no `response`
  slot — but it is absent.
- **The controller path as a separate field.** Only the joined path is stored
  (`route-compiler.ts` joins at compile time via `joinPaths`). The _declared_
  source keeps them separate (`defineControllerRoutes(Name, { path, routes })`),
  the compiled route does not.
- **Plugin-contributed context** (`store`, `decorator`, `derive`, `resolve`).
  Nothing about a plugin reaches a route plan; this is the gap
  `HandlerContext` closes by hand
  (`packages/platform-elysia/src/routing/route-context.types.ts:140-148`).
- **WebSocket message schemas.** Gateways carry event names only
  (`packages/platform-elysia/src/inspection/application-inspection.ts:127-138`).
- **The inspection projection drops the schema entirely.** `AponiaRouteInspection`
  carries `method`, `path`, `module`, `controller`, `handler`, `parameters`
  (`packages/platform-elysia/src/inspection/application-inspection.types.ts:71-82`,
  built at `application-inspection.ts:101-125`). Confirmed by running it: the
  emitted JSON for the route above contains no `body`, no `response`, no
  validator. That is contractual, not accidental — the projection must stay
  JSON-serializable (`docs/introspection.md:86-89`).

Consequence: the inspection projection cannot feed a typed client, and a
_decorated_ runtime descriptor cannot either until the platform's own model
resolution runs. Only the build artifact is directly usable.

## 2. Can a declared route be read in a type position?

**The decorator path cannot, and this is not a bug.** `RouteDecoratorFactory`
returns a `RouteMethodDecorator`; the path and schema are parameters of a
function that writes `reflect-metadata`
(`packages/common/src/decorators/decorators.types.ts:47-51`,
`packages/common/src/decorators/decorators.ts:104-129`). Nothing records them on
the class type. Probed: a decorated instance exposes only its own members
(`Property '__show_me_the_type' does not exist on type 'DecoratedController'`).
A decorator cannot add members to the class it decorates, so this is a language
limit, not an implementation shortfall.

**The declared path can, but the published types throw the literals away.**
`ControllerRoutesOptions.routes` is `readonly RoutePlan[]`
(`packages/platform-elysia/src/controllers/controller.types.ts:64`) and
`RoutePlan` declares `method: RequestMethod` and `path: string`
(`route-plan.types.ts:35-37`). The returned `DeclaredControllerDefinition`
carries only `TController` and `TDependencies`
(`controller.types.ts:76-81`).

Probed with compile-time assertions against the real API, with a control:

- `(typeof declared)["compiledRoutes"][number]["path"]` is `string` — asserted
  `Equal<PathType, string>`, compiles clean.
- Control asserting `Equal<PathType, "/">` **fails**, proving the widening is
  real and the assertion is not vacuously true.
- Same result for `method` (widens to `RequestMethod`) and for `schema`
  (widens to `RouteSchema | undefined`).
- The schema's TypeBox literal is gone: a control asserting the captured
  `t.Object({ a: t.String() })` type also fails.

Then a simulation of what a `const`-generic option type _would_ capture, using
the same expressions, showed all four facts are recoverable:

```
method    -> "GET" | "POST"
path      -> "/"
InferValidatorOutput<schema["body"]> -> { name: string }
ReturnType<UsersController["create"]> -> { id: string }
```

So the information exists at the declaration site — in the generated
`descriptors.generated.ts` as literal source, and in a hand-written
`defineControllerRoutes` call — and only the published API erases it.

**The declared path still does not reach Eden today.** `ElysiaApplication`
merges `TConfiguredApplication` with the plugins it can statically see
(`packages/platform-elysia/src/application/native-application.types.ts:71-74`),
and `ControllerPlugin` reads a definition's `buildPlugin` return type
(`:10-16`, `:35-55`). `defineControllerRoutes` declares that return as plain
`Elysia` (`packages/platform-elysia/src/controllers/controller-definition.ts:195-199`),
so it contributes nothing. Probed directly: for a module whose controller came
from `defineControllerRoutes`, `"users" extends keyof Treaty.Create<ElysiaApplication<...>>`
is **false**, and the client collapses to a catch-all index signature.

This position is already stated and pinned in-tree:

- `packages/platform-elysia/tests/eden-contract.test.ts:235` asserts
  `"runtime-only" extends keyof RuntimeOnlyClient` is false — decorated routes
  contribute nothing.
- The same file, `:236-239`, asserts a `controller(...)` registration returning
  its fluent chain **does** contribute
  (`Treaty.Data<RegisteredEdenPath["get"]>` equals the handler's shape).
- `docs/eden-treaty.md:250-254` states it as a decision: "Decorator-wide
  inference requires the planned build-time module compiler; Aponia deliberately
  does not cast unknown runtime routes into a false contract."

Running the lane confirms the positive half:
`bun test packages/platform-elysia/tests/eden-contract.test.ts` → 12 pass,
0 fail.

## 3. The smallest honest claim

### (a) Works today, no new code

**Route splitting with full Eden inference is already possible — without
decorators.** A module can split its routes across files and lose nothing if
those routes are declared as native Elysia:

- a route file exports `definePlugin(new Elysia({ name }).get(path, schema, handler))`;
- a controller file exports `controller(ControllerClass, [deps], (app, c) => app.get(...))`
  and returns the fluent chain;
- they compose through `defineModule({ imports, controllers })`, which retains
  the tuples exactly;
- the app boots with `AponiaFactory.createNative(RootModule)` and exports
  `export type App = typeof app`.

Evidence: `docs/eden-treaty.md:39-71`, `:112-152`, `:233-248`, and the passing
`eden-contract.test.ts`. Both `AponiaFactory.create` and `createNative` retain
the same inferred routes for the Eden client
(`docs/eden-treaty.md:217-228`).

The honest limit of this claim: it covers the native and fluent-callback
authoring styles. It does not cover `@Controller()` + `@Get()`.

### (b) Works with a modest addition

**Retain the declared plans in the type of `defineControllerRoutes`.** This is a
compile-time-only change with no runtime behavior change; the value returned is
already `Object.freeze`d and stays byte-identical. It makes a route's literal
method, path, schema types, and handler key reachable in a type position, which
is the prerequisite for any client projection — Eden-shaped or otherwise.

A client that _is_ Eden additionally needs those plans projected into Elysia's
own `~Routes` shape, or a generated native plugin beside the descriptor. That
second step is not part of the increment below and is not verified here.

### (c) Genuinely blocked

- **Decorator-declared routes can never type the Eden client from the decorated
  class alone.** A decorator cannot extend the class type, so `@Get("/x")` on a
  method is invisible to TypeScript. Recovery must come from a build artifact or
  a parallel declaration, never from the decorated source alone.
  `docs/eden-treaty.md:250-254` and `eden-contract.test.ts:235` already say and
  pin this.
- **The runtime inspection projection can never be a client contract.** It is
  contractually plain, frozen, and JSON-serializable
  (`docs/introspection.md:82-89`), so no validator and no schema may reach it.
  Any schema-bearing projection would be a different function with a different
  contract.

## 4. First increment

**Type-capture the declared route plans on `defineControllerRoutes`.**

Scope, one increment: no new runtime behavior, no new mount path, no change to
the descriptor artifact's bytes, no change to what the platform executes.

Files:

| File                                                                | Change                                                                                                                                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/platform-elysia/src/controllers/controller.types.ts`      | `ControllerRoutesOptions` takes a `TRoutes` type parameter; `DeclaredControllerDefinition` gains `readonly routes: TRoutes`                                             |
| `packages/platform-elysia/src/controllers/controller-definition.ts` | `defineControllerRoutes` takes `const TRoutes extends readonly RoutePlan[]` and returns the definition carrying it                                                      |
| `packages/platform-elysia/src/routing/route-plan.types.ts`          | the projection type that reads a plan tuple: literal `method`/`path`, `InferValidatorOutput` for each slot including a status-keyed `response` map, and the handler key |
| `packages/platform-elysia/src/index.ts`                             | export the projection type beside `RoutePlan`                                                                                                                           |
| `packages/platform-elysia/tests/route-plan.test.ts`                 | compile-time assertions beside the existing runtime cases                                                                                                               |
| `packages/platform-elysia/tests-vp/route-plan.conformance.ts`       | the mirrored conformance assertions                                                                                                                                     |
| `docs/eden-treaty.md`                                               | move `defineControllerRoutes` from "not inferred" into the static-inference boundary list                                                                               |

Public API surface: one new `const` type parameter on `defineControllerRoutes`,
one new type parameter on `ControllerRoutesOptions` and on
`DeclaredControllerDefinition`, and one new exported type. All three are
additive; no existing call site changes shape at runtime.

One wrinkle worth stating up front: `RoutePlan.propertyKey` is
`string | symbol` (`route-plan.types.ts:39`), so the handler return type is only
reachable if the plan type constrains the key against `TController`
(`keyof TController & string`). That constraint belongs in this increment,
otherwise the projection yields a key that indexes nothing.

Tests the increment needs, matching the two-lane rule (`RULES.md`, "Type-lane
ownership"): literal `method` and `path` captured; each schema slot's output
inferred, including a status-keyed `response` map and a `@Validation()` model
class; the handler key constrained to `keyof TController`; and negative
assertions proving a mismatched key or a non-existent slot is rejected. The
assertions must be referenced by a runtime test so `bun run check` cannot drop
them, as `plugin-context.test.ts` and `eden-contract.test.ts` already do.

Validation for the increment: `bun run check`, `bun run test:coverage`,
`bun run test:vite-plus`, plus `bun run test:generated-app` if the emitted
artifact's shape changes — which it should not, since the template already
carries the literals.

## What I could not verify

- **That the increment alone gives Eden inference.** I verified its prerequisite
  — literal capture in a `const` generic — and the merge mechanism that would
  consume it, but I did not build or compile the Elysia-shaped projection. The
  claim "a modest addition restores Eden inference for declared routes" is not
  verified end to end.
- **Elysia's `~Routes` / `AddRoute` shape in enough depth to guarantee a
  plan-derived type satisfies it.** I read `MergeElysiaInstances` and the
  `~Routes` member but did not exercise a constructed route record against Eden.
- **That adding `const TRoutes` breaks no existing call site.** A plan tuple
  assembled from a `readonly RoutePlan[]` variable will not infer literals; only
  a full `bun run check` across the workspace answers that.
- **The state of Elysia issue #138 itself.** No network access; the premise
  (26 reactions, still open) was taken as given.
- **The repository gates.** No `bun run check`, `bun run test:coverage`, or
  `bun run test:vite-plus` was run — this was a read-only investigation. The one
  lane executed was `bun test packages/platform-elysia/tests/eden-contract.test.ts`.
- **The `/tmp` probes ran outside the workspace lanes**, against
  `packages/*/src` through a temporary `tsconfig` that maps `@aponiajs/*` to
  source. They are evidence about the current source, not about a published
  `dist`.
- **`packages/cron/`**, untracked in this working tree and unrelated to the
  question.
