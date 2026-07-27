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
    |-- greeting.module.ts
    |-- greeting.schema.ts
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

## File responsibilities

| File suffix      | Responsibility                                                |
| ---------------- | ------------------------------------------------------------- |
| `.module.ts`     | Imports, providers, exports, and module identity              |
| `.service.ts`    | Business rules and reusable application behavior              |
| `.controller.ts` | Route ownership and transport-to-service delegation           |
| `.schema.ts`     | Route validation schemas for the owning feature               |
| `.tokens.ts`     | Named public injection tokens                                 |
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

## Module, controller, and service flow

Normal HTTP applications follow this ownership chain:

```text
main.ts
  -> AponiaFactory.create(AppModule)
  -> AppModule imports feature modules
  -> feature modules register controllers and providers
  -> controllers own route plugins and call services
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

## Route validation pattern

Route decorators accept an optional schema after the path. Validators follow the
[Standard Schema](https://standardschema.dev) specification, so Zod, ArkType, and
Valibot work directly, and platform-native TypeBox validators are accepted as
well:

```ts
import { Body, Controller, Post } from "@aponiajs/common";
import { z } from "zod";

const CreateUser = z.object({
  name: z.string().min(2),
});
type CreateUser = z.infer<typeof CreateUser>;

@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post("/", { body: CreateUser })
  createUser(@Body() body: CreateUser): User {
    return this.userService.createUser(body);
  }
}
```

The schema may also be passed alone when the route has no path suffix, as in
`@Post(createUser)`. Available slots are `body`, `query`, `params`, `headers`,
and `response`. Validation runs before the handler, so a rejected request never
reaches controller code.

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

`@Body()`, `@Query()`, `@Param()`, `@Headers()`, and `@Cookie()` accept an
optional property name that selects a single value. `@Req()` injects the native
`Request`, `@Res()` the mutable response settings, and `@Ctx()` the whole
platform context.

A handler declared without parameter decorators receives the context as its only
argument. Annotate it with `RouteContext<typeof schema>` to stay
platform-neutral, or with `ElysiaRouteContext<typeof schema>` from
`@aponiajs/platform-elysia` to keep `status`, `set`, `cookie`, `store`,
`redirect`, and plugin decorators typed by Elysia itself.

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
