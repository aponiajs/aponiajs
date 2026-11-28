# Architecture and Style Guide

## Design direction

Aponia uses NestJS as a reference for application organization while keeping
runtime behavior explicit and compatible with Bun. Elysia is the default HTTP
platform; Hono, H3, and Nitro are platforms beside it.

The structural vocabulary is familiar:

- modules define dependency and visibility boundaries;
- services contain business logic;
- controllers adapt transport input and output;
- `main.ts` owns application bootstrap.

The runtime model is intentionally different where explicit behavior improves
portability and type safety:

- decorated classes are the default application authoring API;
- immutable descriptors remain available as a low-level interoperability API;
- platform packages depend on core contracts instead of changing them.

## Invariants for reviewers and agents

These rules are enforced by the code layout, the tests, or the framework
contract. A change that weakens one is a redesign, not a refactor.

| Invariant                           | What it means                                                                                            | Evidence                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Two authoring layers stay supported | Decorators write metadata; hand-written descriptors are an equal authoring path                          | Focused tests for both paths                     |
| Dependencies point inward           | `common` ← `core` ← the platform packages; no Elysia, Hono, H3, Nitro, HTTP, or Bun API in `common`      | Package manifests, type checks, review           |
| Descriptors are immutable           | Public definitions, metadata, and inspection results are frozen                                          | Tests assert `Object.isFrozen` where contractual |
| Failures are structured             | Framework failures use `AponiaError` codes; HTTP failures use Problem Details                            | Tests assert codes and details, not messages     |
| Routes compile once                 | Invokers and gateway plans are built during bootstrap; no per-request reflection                         | Route and gateway tests                          |
| The platform stays replaceable      | Application code depends on Aponia contracts, not on Elysia internals beyond the documented escape hatch | Import boundaries and package tests              |
| Documentation ships with behavior   | Every public change updates its page, package README, and `llms.txt`                                     | Documentation guards and review                  |

## Where to change what

| Change                                            | Owned by                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| A decorator or metadata key                       | `packages/common/src/` and the descriptor compiler                             |
| Graph, visibility, scopes, or provider cache      | `packages/core/src/scanner` and `packages/core/src/injector`                   |
| Route lowering, parameter binding, or hooks       | `packages/platform-elysia/src/routing` and `packages/common/src/routing`       |
| Native plugin typing or module registration       | `packages/platform-elysia/src/plugins`                                         |
| WebSocket gateway compilation or dispatch         | `packages/common/src/websockets` and `packages/platform-elysia/src/websockets` |
| Route execution, validation, or the host contract | `packages/common/src/kernel` and `packages/common/src/host`                    |
| Generator output, templates, or CLI parsing       | `packages/cli/src` and `packages/cli/templates`                                |
| A publishable package surface                     | The package's `src/index.ts`, README, `llms.txt`, and docs page                |
| Release or documentation policy                   | `RULES.md`, `docs/AGENTS.md`, and the matching guard specification             |

## Application structure

Nest uses different layouts for a new standard application, a generated
feature, and a monorepo. These layouts must not be mixed.

### New standard application

`aponia new` follows the flat structure produced by `nest new`:

```text
src/
|-- app.controller.spec.ts
|-- app.controller.ts
|-- app.module.ts
|-- app.service.ts
|-- config.ts
`-- main.ts
test/
`-- app.e2e-spec.ts
```

The root `AppModule`, controller, and service stay directly under `src`.
Creating `src/modules/app` for these starter files is not a Nest convention.

### Generated feature or resource

Nest resource generation creates a directory directly under `src`, for example
`src/users`. Aponia examples follow the same rule:

```text
src/
|-- app.module.ts
|-- main.ts
`-- greeting/
    |-- dto/
    |   |-- create-greeting.dto.ts
    |   `-- update-greeting.dto.ts
    |-- entities/
    |   `-- greeting.entity.ts
    |-- greeting.controller.spec.ts
    |-- greeting.controller.ts
    |-- greeting.model.ts
    |-- greeting.module.ts
    |-- greeting.service.spec.ts
    `-- greeting.service.ts
```

A project may choose `src/modules/<feature>` as a team convention, but Aponia
does not generate or document it as the Nest default.

Keep feature-owned DTOs, entities, controllers, services, and tests inside the
feature directory. Create top-level `common`, `config`, or `database`
directories only for code that is genuinely shared across features:

```text
src/
|-- common/
|   |-- decorators/
|   |-- filters/
|   |-- guards/
|   |-- interceptors/
|   `-- pipes/
|-- config/
`-- database/
```

### Framework workspace

The Aponia repository publishes independent npm packages, so its Bun workspace
uses `packages/*` and executable examples use `examples/*`. This is a framework
repository boundary, not the directory layout generated inside an application.
Nest monorepo mode instead uses `apps/*` for applications and `libs/*` for
workspace libraries. A future Aponia monorepo generator may expose that mode
explicitly; `aponia new` remains standard mode.

### Framework package source

Published package internals use a domain-first, Nest-shaped layout. Each
directory owns one conceptual boundary, implementation files carry the Nest kind
suffix they implement, and `src/index.ts` is the only public barrel:

```text
packages/<package>/src/
|-- <domain>/
|   |-- <name>.ts
|   `-- <name>.interface.ts
|-- <name>.module.ts
|-- <name>.service.ts
|-- <name>.constants.ts
`-- index.ts
```

Type-only contracts live in `interfaces/<original-basename>.interface.ts` beside
the domain that owns them, one file per original basename. Do not create a
package-wide `types/` directory or merge several contracts into one interface
file: it hides ownership and attracts unrelated contracts. A `*.types.ts` file
remains only where the mirrored Nest package has one. Use `*.constants.ts` only
for runtime values shared by an implementation and its type contracts.

The workspace builds from `src/` while the surveyed official libraries build
from `lib/`. The naming and folder shape are mirrored; the build root is not, and
`docs/build/migrating-from-nest.md` records that deviation.

The current package boundaries are:

| Package                     | Source domains                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@aponiajs/common`          | async-context, configuration, decorators, enhancers, exceptions, interfaces, mcp, microservices, modules, module-utils, pipes, providers, routing, services, tokens, websockets    |
| `@aponiajs/core`            | hooks, injector, interfaces, scanner, `constants.ts`                                                                                                                               |
| `@aponiajs/compiler`        | borrow, interfaces, lifetime, shared, typestate                                                                                                                                    |
| `@aponiajs/cache`           | decorators, interceptors, interfaces                                                                                                                                               |
| `@aponiajs/compression`     | interfaces, module, policy                                                                                                                                                         |
| `@aponiajs/events`          | decorators, interfaces                                                                                                                                                             |
| `@aponiajs/http`            | interfaces, security                                                                                                                                                               |
| `@aponiajs/rate-limit`      | guard, module, service, store                                                                                                                                                      |
| `@aponiajs/security`        | interfaces, module, policy                                                                                                                                                         |
| `@aponiajs/session`         | interfaces, middleware, module, policy, service, store                                                                                                                             |
| `@aponiajs/auth`            | interfaces, password, plus `<name>.ts` kinds at the root                                                                                                                           |
| `@aponiajs/platform-elysia` | adapters, application, compiler, configuration, controllers, exceptions, inspection, interfaces, microservices, middleware, modules, plugins, request-context, routing, websockets |
| `@aponiajs/platform-hono`   | application, host, routing                                                                                                                                                         |
| `@aponiajs/platform-h3`     | application, host, routing                                                                                                                                                         |
| `@aponiajs/cli`             | agent, bundler, commands, contracts, generation, interfaces, library                                                                                                               |
| `@aponiajs/schematics`      | `lib/<schematic>/` collections                                                                                                                                                     |
| `@aponiajs/cors`            | interfaces, module, policy                                                                                                                                                         |
| `@aponiajs/cron`            | decorators, interfaces, scheduler                                                                                                                                                  |
| `@aponiajs/devtools`        | buffer, endpoints, interfaces, logging, module, requests, server, source                                                                                                           |
| `@aponiajs/graphql`         | endpoint, interfaces                                                                                                                                                               |
| `@aponiajs/mcp`             | discovery, execution, interfaces, module, transport                                                                                                                                |
| `@aponiajs/testing`         | application, conformance, interfaces, overrides                                                                                                                                    |
| `@aponiajs/openapi`         | document, interfaces                                                                                                                                                               |
| `@aponiajs/queue`           | decorators, hosts, interfaces, outbox, processors, queue                                                                                                                           |
| `@aponiajs/database`        | interfaces, migration, repository                                                                                                                                                  |
| `@aponiajs/microservices`   | brokers, client, envelope, interfaces, module, server, transport                                                                                                                   |
| `@aponiajs/view`            | engines, helper, interfaces, module                                                                                                                                                |
| `@aponiajs/serverless`      | fetch, interfaces, lambda                                                                                                                                                          |
| `@aponiajs/config`          | interfaces, utils                                                                                                                                                                  |
| `@aponiajs/cqrs`            | buses, decorators, interfaces                                                                                                                                                      |
| `@aponiajs/mapped-types`    | interfaces                                                                                                                                                                         |
| `@aponiajs/serve-static`    | interfaces                                                                                                                                                                         |
| `@aponiajs/terminus`        | health-check, health-indicators, interfaces                                                                                                                                        |

Keep package tests at `src/**/*.spec.ts`, Vite+ conformance tests at
`test/*.conformance.ts`, and a live-dependency lane at `test/*.e2e-spec.ts`;
those locations are part of the configured test discovery.
`scripts/source-layout.spec.ts` prevents source modules from drifting back into
package roots and holds the Nest kind suffixes.

## File responsibilities

| File suffix       | Responsibility                                                |
| ----------------- | ------------------------------------------------------------- |
| `.module.ts`      | Imports, providers, exports, and module identity              |
| `.service.ts`     | Business rules and reusable application behavior              |
| `.controller.ts`  | Route ownership and transport-to-service delegation           |
| `.gateway.ts`     | WebSocket message ownership and service delegation            |
| `.guard.ts`       | A `CanActivate` implementation                                |
| `.interceptor.ts` | An around-handler `Interceptor` implementation                |
| `.pipe.ts`        | A `PipeTransform` implementation                              |
| `.filter.ts`      | An exception filter with its `@Catch()` declaration           |
| `.middleware.ts`  | An `AponiaMiddleware` implementation                          |
| `.strategy.ts`    | A strategy class                                              |
| `.decorator.ts`   | A decorator factory                                           |
| `.dto.ts`         | A non-REST input contract                                     |
| `.entity.ts`      | A persistence entity                                          |
| `.repository.ts`  | A repository over one entity                                  |
| `.provider.ts`    | A provider that is neither a service nor a repository         |
| `.providers.ts`   | Provider-factory helpers                                      |
| `.accessor.ts`    | A metadata/configuration reader                               |
| `.explorer.ts`    | A declaration discoverer                                      |
| `.model.ts`       | One-schema validation classes and their derived input types   |
| `.interface.ts`   | A type-only contract under `interfaces/`                      |
| `.constants.ts`   | Runtime constants shared across implementation/type modules   |
| `.spec.ts`        | Unit tests colocated with the owning source                   |
| `.conformance.ts` | Vite+ public-contract tests under `test/`                     |
| `.e2e-spec.ts`    | End-to-end tests under a top-level `test` directory           |
| `main.ts`         | Container creation, platform bootstrap, and process ownership |

## Naming

- Use PascalCase for classes and types.
- Use camelCase for variables and functions.
- Use descriptive module class names such as `GreetingModule`.
- Use uppercase names for exported token constants such as `APP_NAME`.
- Name tests after observable behavior, not implementation details.

## Dependency rules

- A module imports another module only when it consumes one of its exports.
- Export the smallest provider surface that downstream modules need.
- Services receive dependencies through constructors.
- Do not read the container from business logic.
- Do not import another package's private source path.
- Do not add Elysia, HTTP, or Bun runtime APIs to `@aponiajs/common`.
- Keep provider creation synchronous: a provider factory returns a value, not a
  promise, and asynchronous work belongs in the lifecycle hooks.

## Module, controller, gateway, and service flow

Normal HTTP applications follow this ownership chain:

```text
main.ts
  -> AponiaFactory.create(AppModule)
  -> AppModule imports feature modules
  -> feature modules register controllers, gateways, and providers
  -> controllers own route plugins and call services
  -> gateways own socket messages and call services
  -> services execute business behavior
```

`main.ts` must not retrieve a feature service and invoke application behavior.
That pattern is reserved for standalone application contexts and command-line
tasks.

## Module and service pattern

```ts
import { Injectable, Module } from "@aponiajs/common";

@Injectable()
export class GreetingService {
  createGreeting(): string {
    return "Hello, AponiaJS!";
  }
}

@Module({
  controllers: [GreetingController],
  providers: [GreetingService],
})
export class GreetingModule {}
```

Application code uses the same concise module metadata and injectable service
shape as Nest. The platform compiles decorated classes into the lower-level
module graph before bootstrap.

## Controller pattern

Keep routing inside its owning feature:

```ts
import { Controller, Get } from "@aponiajs/common";

@Controller("greetings")
export class GreetingController {
  constructor(private readonly greetingService: GreetingService) {}

  @Get()
  getGreeting(): string {
    return this.greetingService.createGreeting();
  }
}
```

The controller remains thin. The Elysia platform translates controller and
method metadata into native routes while Aponia owns controller construction
and service injection.

## WebSocket gateway pattern

Gateways are providers, not controllers:

```ts
import { MessageBody, SubscribeMessage, WebSocketGateway } from "@aponiajs/common";

@WebSocketGateway("/greetings")
export class GreetingGateway {
  constructor(private readonly greetingService: GreetingService) {}

  @SubscribeMessage("greetings.create")
  create(@MessageBody("name") name: string): string {
    return `${name}: ${this.greetingService.createGreeting()}`;
  }
}
```

Add `GreetingGateway` to its feature module's `providers`. Keep socket
coordination in the gateway and reusable behavior in services, exactly as HTTP
controllers keep request coordination out of business logic. The
[WebSocket guide](../platforms/websockets.md) documents the native socket and wire
contract.

## Route validation pattern

Route decorators accept an optional schema after the path. The normal
application path wraps each complete validator in its own `@Validation()` class.
Validators follow the [Standard Schema](https://standardschema.dev)
specification, so Zod, ArkType, and Valibot work directly, and platform-native
TypeBox validators are accepted as well:

```ts
import { Body, Controller, Post, Validation, type InferValidatorOutput } from "@aponiajs/common";
import { z } from "zod";

const createUserSchema = z.object({
  name: z.string().min(2),
});

@Validation(createUserSchema)
export class CreateUser {}
export interface CreateUser extends InferValidatorOutput<typeof createUserSchema> {}

@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post("/", { body: CreateUser })
  createUser(@Body() body: CreateUser): User {
    return this.userService.createUser(body);
  }
}
```

Create, update, and params validators become separate classes. A PATCH route
combines `{ params: UserParams, body: UpdateUser }`; a DELETE route normally
uses `{ params: UserParams }` without a body model. `@Validation()` takes one
validator and never composes unrelated schemas. Available slots are `body`,
`query`, `params`, `headers`, `cookie`, and `response`. Validation runs before
the handler, so a rejected request never reaches controller code. Raw validators
remain supported as the low-level escape hatch.

### Request parameters

Parameter decorators inject one piece of the request, exactly as they do in
Nest, and the handler's own annotations provide the types:

```ts
import { Body, Controller, Get, Param, Post } from "@aponiajs/common";

@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post("/", { body: CreateUser })
  createUser(@Body() body: CreateUser): User {
    return this.userService.createUser(body);
  }

  @Get(":id")
  findUser(@Param("id") id: string): User {
    return this.userService.findUser(id);
  }
}
```

`@Body()`, `@Query()`, `@Param()`, `@Headers()`, `@Cookie()`, and `@State()`
accept an optional property name that selects a single value. `@Req()` injects
the native `Request`, `@ResponseSettings()` the mutable response settings,
`@HttpStatus()` the typed status helper, and `@Context()` the whole platform
context.

A handler with no parameter decorators may declare one parameter to receive the
context. Annotate it with `RouteContext<typeof schema>` to stay platform-neutral,
or with `HandlerContext<typeof schema>` from `@aponiajs/platform-elysia` to
keep `status`, `set`, `cookie`, `store`, and
`redirect` typed by Elysia itself. Both context helpers accept schemas whose
slots and response maps contain validation-model classes.

Compiling a decorated controller erases the plugin instances its module imports,
so a native plugin's additions are present at runtime but untyped by default.
Name the plugins to type them: `HandlerContext<typeof clock>` when the route
has no schema, `HandlerContext<[typeof clock, typeof jwt]>` for several, and
`HandlerContext<typeof schema, typeof clock>` when both matter. An
application that always mounts the same plugins declares
`type AppContext<TSchema extends RouteInputSchema = {}> = HandlerContext<TSchema, AppPlugins>`
once and annotates handlers with `AppContext` or `AppContext<typeof schema>`.
`definePlugin` goes further: it converts a native plugin into a module
import that carries its own type, so `imports: [clock]` mounts it and
`e<clock>` — `HandlerContext` renamed on import — types it without a
`typeof`, provided the plugin is exported as a value and a same-named type. The
[native plugin guide](../platforms/native-plugins.md) is the complete reference.
The mapping
mirrors Elysia's `.use()`: `decorate`, `state`, and `global` derives are typed,
together with `plugin`-scoped derives; plugin-local derives are not, because
they never reach the controller.

## Bootstrap pattern

Keep bootstrap equivalent to the normal NestJS factory pattern:

```ts
async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule);
  await application.listen(3000);
}

await bootstrap();
```

Application logic, controller construction, and service lookup do not belong in
`main.ts`.

When native Elysia is the intended calling surface, use the parallel bootstrap
entrypoint:

```ts
export const app = await AponiaFactory.createNative(AppModule);
export type App = typeof app;
```

The returned value is the composed Elysia instance. Static `defineModule`
imports preserve typed controller and native plugin routes for Eden Treaty;
decorated routes remain runtime-only until the build-time compiler can emit
their route generics. See the [Eden Treaty guide](../platforms/eden-treaty.md).

### Elysia compilation policy

The platform lowers decorated routes into immutable plans during bootstrap,
generates fixed-arity controller invokers, and registers them directly on the
root Elysia application. Parameter extraction is therefore not interpreted on
every request.

Production applications that prefer predictable first-hit behavior may ask
Elysia to compose routes and schemas before listening:

```ts
const application = await AponiaFactory.create(AppModule, {
  elysia: {
    precompile: {
      compose: true,
      schema: true,
    },
  },
});
```

Without `precompile`, Elysia performs its JavaScript route composition lazily.
`precompile` does not produce native machine code: JavaScriptCore still owns
machine-code JIT compilation, and build-time Aponia source generation is a
separate concern.

A build tool can target the same direct-registration path without decorators by
emitting `defineController(..., { registerRoutes })` descriptors.
Hand-authored code normally uses the concise `controller(...)` facade so
Elysia contextually infers route input without a manual context type or
`typeof`. The older `buildPlugin` form remains the compatibility escape hatch
for a controller that deliberately owns an isolated Elysia plugin.

Both of those forms own their routes' hooks, so neither is a place to declare an
enhancer: the platform compiles guards, interceptors, filters, and the default
mapping while it mounts a route itself, and a route registered through a
callback or built by a `buildPlugin` gets none of them — an unhandled failure
there answers Elysia's native `500` carrying the exception's message. The
[execution enhancers guide](./enhancers.md) states the exclusion in full.
