# 05 · Controllers and routes

**Use when:** exposing application behavior over HTTP.

```ts
import { Controller, Get, Param } from "@aponiajs/common";
import { UserService } from "./user.service.ts";

@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(":id")
  findUser(@Param("id") id: string) {
    return this.userService.findOne(id);
  }
}
```

`@Controller("users")` sets the prefix. `@Get(":id")` answers `GET /users/:id`.

`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Head`, and `@Options` map to HTTP methods. `@All` answers every method on its path. Each decorator accepts a path, a schema, or both. `@Post({ body })` mounts at the controller prefix, and `@Post("/", { body })` names the path beside the schema.

`@Header(name, value)` sets a response header. `@HttpCode(status)` sets the status carried by a returned value. A handler that returns a `Response`, throws `HttpError`, or sets a status itself still decides its own.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule);
  await application.listen(Number(Bun.env.PORT ?? 3000));
}

await bootstrap();
```

`main.ts` creates the application and starts it. Business behavior belongs in providers.

## Route prefix

```ts
const application = await AponiaFactory.create(AppModule, { prefix: "/api" });
```

`@Controller("users")` now answers at `/api/users`. A prefix that is not a string starting with `/` fails boot with `INVALID_CONFIGURATION_VALUE`. Health probes, native plugins, and controllers mounted by their own callback stay outside the prefix.

## Versioning

```ts
import { Controller, Get, Version } from "@aponiajs/common";

@Controller("users")
@Version("1")
export class UsersV1Controller {
  @Get()
  findAll() {
    return [];
  }
}
```

That controller answers `GET /v1/users`. A handler-level `@Version("2")` overrides the controller for that route. A declared `RoutePlan` uses its `version` field.

Version negotiation is optional:

```ts
const app = await AponiaFactory.create(AppModule, {
  versioning: { type: "header", header: "x-api-version", defaultVersion: "1" },
});
```

`type` is `"uri"`, `"header"`, or `"media-type"`. Header defaults to `x-api-version`; media-type reads the `version` parameter. A requested version no route declares answers `400` with code `API_VERSION_NOT_FOUND`.

`VERSION_NEUTRAL` keeps one route out of every version prefix:

```ts
import { Get, VERSION_NEUTRAL, Version } from "@aponiajs/common";

export class UsersController {
  @Get("health")
  @Version(VERSION_NEUTRAL)
  health() {
    return { status: "pass" };
  }
}
```

## Deprecation

`@Deprecated()` adds a `Deprecation: true` response header. A `sunset` date or `link` adds `Sunset` and a `rel="deprecation"` link.

```ts
import { Controller, Deprecated, Get } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @Get()
  @Deprecated({ sunset: "2027-01-01T00:00:00Z", link: "https://api.example.com/v2/users" })
  findAll() {
    return [];
  }
}
```

A handler declaration overrides the controller declaration.

## Server-Sent Events

`@Sse()` sets `text/event-stream`, `cache-control: no-cache`, and `connection: keep-alive` before the handler runs. Wrap each event with `sse()`.

```ts
import { Controller, Get, Sse } from "@aponiajs/common";
import { sse } from "@aponiajs/platform-elysia";

@Controller("events")
export class EventsController {
  @Get()
  @Sse()
  async stream() {
    return sse(
      (async function* () {
        yield sse({ event: "tick", data: "1" });
      })(),
    );
  }
}
```

## Response serialization

`@Serialize()` shapes the result after the handler and after any interceptor `after` half. A method serializer overrides a controller serializer.

```ts
import { Controller, Get, Serialize } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @Get(":id")
  @Serialize((user, context) => ({ id: user.id, path: context.path }))
  findOne() {
    return { id: "1", name: "Ada", passwordHash: "internal" };
  }
}
```

Next: [06 · Validation](./06-validation.md) · Deep dive: [architecture and style](../build/architecture-and-style.md)
