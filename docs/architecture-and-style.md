# Architecture and Style Guide

## Design direction

Aponia uses NestJS as a reference for application organization while keeping
runtime behavior explicit and compatible with Bun and Elysia.

The structural vocabulary is familiar:

- modules define dependency and visibility boundaries;
- services contain business logic;
- controllers will adapt transport input and output;
- `main.ts` owns application bootstrap.

The runtime model is intentionally different where explicit behavior improves
portability and type safety:

- decorated classes are the default application authoring API;
- immutable descriptors remain available as a low-level interoperability API;
- platform packages depend on core contracts instead of changing them.

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

Published package internals use a domain-first layout. Each directory owns one
conceptual boundary, and `src/index.ts` is the only public barrel:

```text
packages/<package>/src/
|-- <domain>/
|   |-- <capability>.ts
|   `-- <capability>.types.ts
`-- index.ts
```

Type-only contracts stay beside their owning implementation. Do not create a
package-wide `types/` directory: it hides ownership and attracts unrelated
contracts. Use `*.constants.ts` only for runtime values shared by an
implementation and its type contracts.

The current package boundaries are:

| Package                     | Source domains                                                                |
| --------------------------- | ----------------------------------------------------------------------------- |
| `@aponiajs/common`          | controllers, decorators, errors, logging, modules, providers, routing, tokens |
| `@aponiajs/core`            | container, graph                                                              |
| `@aponiajs/platform-elysia` | application, controllers, modules, plugins, routing                           |
| `@aponiajs/cli`             | commands, generation                                                          |

Keep package tests at `tests/*.test.ts` and Vite+ conformance tests at
`tests-vp/*.conformance.ts`; those flat locations are part of the configured
test discovery. `scripts/source-layout.spec.ts` prevents source modules from
drifting back into package roots and verifies that `*.types.ts` files remain
type-only.

## File responsibilities

| File suffix      | Responsibility                                                |
| ---------------- | ------------------------------------------------------------- |
| `.module.ts`     | Imports, providers, exports, and module identity              |
| `.service.ts`    | Business rules and reusable application behavior              |
| `.controller.ts` | Route ownership and transport-to-service delegation           |
| `.gateway.ts`    | WebSocket message ownership and service delegation            |
| `.model.ts`      | One-schema validation classes and their derived input types   |
| `.tokens.ts`     | Named public injection tokens                                 |
| `.types.ts`      | Type-only contracts colocated with their framework owner      |
| `.constants.ts`  | Runtime constants shared across implementation/type modules   |
| `.spec.ts`       | Unit tests colocated with the owning controller or service    |
| `.e2e-spec.ts`   | End-to-end tests under the top-level `test` directory         |
| `main.ts`        | Container creation, platform bootstrap, and process ownership |

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
- Keep provider creation synchronous until async lifecycle support is available.

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
[WebSocket guide](./websockets.md) documents the native socket and wire
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

`@Body()`, `@Query()`, `@Param()`, `@Headers()`, `@Cookie()`, and `@Store()`
accept an optional property name that selects a single value. `@Req()` injects
the native `Request`, `@Set()` the mutable response settings, `@Status()` the
typed status helper, and `@Ctx()` the whole platform context. `@Res()` is the
Nest-style alias of `@Set()`.

A handler with no parameter decorators may declare one parameter to receive the
context. Annotate it with `RouteContext<typeof schema>` to stay platform-neutral,
or with `ElysiaRouteContext<typeof schema>` from `@aponiajs/platform-elysia` to
keep `status`, `set`, `cookie`, `store`, and
`redirect` typed by Elysia itself. Both context helpers accept schemas whose
slots and response maps contain validation-model classes.

Compiling a decorated controller erases the plugin instances its module imports,
so a native plugin's additions are present at runtime but untyped by default.
Name the plugins to type them: `ElysiaRouteContext<typeof clock>` when the route
has no schema, `ElysiaRouteContext<[typeof clock, typeof jwt]>` for several, and
`ElysiaRouteContext<typeof schema, typeof clock>` when both matter. An
application that always mounts the same plugins declares
`type AppContext<TSchema extends ElysiaInputSchema = {}> = ElysiaRouteContext<TSchema, AppPlugins>`
once and annotates handlers with `AppContext` or `AppContext<typeof schema>`.
`defineElysiaPlugin` goes further: it converts a native plugin into a module
import that carries its own type, so `imports: [clock]` mounts it and
`e<clock>` — `ElysiaRouteContext` renamed on import — types it without a
`typeof`, provided the plugin is exported as a value and a same-named type. The
[native plugin guide](./native-plugins.md) is the complete reference.
The mapping
mirrors Elysia's `.use()`: `decorate`, `state`, `resolve`, and `global` derives
and resolves are typed, together with `scoped` derives and resolves;
plugin-local derives are not, because they never reach the controller.

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
their route generics. See the [Eden Treaty guide](./eden-treaty.md).

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
    aot: true,
    precompile: {
      compose: true,
      schema: true,
    },
  },
});
```

Without `precompile`, Elysia performs its JavaScript route composition lazily.
`aot: false` selects Elysia's generic dynamic dispatcher. Neither option
produces native machine code: JavaScriptCore still owns machine-code JIT
compilation, and build-time Aponia source generation is a separate concern.

A build tool can target the same direct-registration path without decorators by
emitting `defineElysiaController(..., { registerRoutes })` descriptors.
Hand-authored code normally uses the concise `elysiaController(...)` facade so
Elysia contextually infers route input without a manual context type or
`typeof`. The older `buildPlugin` form remains the compatibility escape hatch
for a controller that deliberately owns an isolated Elysia plugin.
