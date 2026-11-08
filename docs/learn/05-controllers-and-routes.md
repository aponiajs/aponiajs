# 05 · Controllers and routes

**Use when:** exposing behavior over HTTP.

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

`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Head`, and `@Options` map to the
matching HTTP method. The route path joins the controller prefix, so this answers
`GET /users/:id`. Each accepts either a path, as `@Get(":id")` does, or a schema
alone — `@Post({ body })` mounts at the controller prefix itself, and
`@Post("/", { body })` names the path beside the schema.

## Native inference with less syntax

Use `controller` when the shortest type-safe route is more useful than
decorator metadata:

```ts
import { defineModule, provideClass } from "@aponiajs/common";
import { controller } from "@aponiajs/platform-elysia";
import { t } from "elysia";

const usersController = controller(UserController, [UserService], (app, controller) =>
  app.get("/users/:id", ({ params }) => controller.findUser(params.id), {
    params: t.Object({ id: t.String() }),
  }),
);

export const UsersModule = defineModule({
  id: "UsersModule",
  controllers: [usersController],
  providers: [provideClass(UserService, [])],
});
```

The Elysia callback infers its request fields directly. It needs no options
object, tuple assertion, context annotation, or `typeof`, and its returned chain
remains available to Eden Treaty.

## How a request arrives

The platform compiles each controller into a native Elysia plugin and mounts it
into the root application:

```text
AponiaFactory.create(AppModule)
  -> compileRootModule            reads decorator metadata
  -> createContainer              validates the graph, builds singletons
  -> mount plugin modules         native Elysia plugins first
  -> mount controllers            plugin.route(method, path, handler, hook)
  -> application.listen(port)
```

Controllers are constructed by the container, so their dependencies come from
the module that declares them.

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

`main.ts` owns the process and nothing else. Retrieving a service there and
calling business behavior is not the pattern.

## Versioning a route

`@Version()` mounts a controller or one handler under a URI version segment:

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

That controller answers `GET /v1/users`. A handler-level `@Version("2")`
overrides the controller and mounts that one route under `/v2`. A declared
`RoutePlan` states the same fact with its `version` field.

The URI mount is always present, and `AponiaFactory.create` can also negotiate
the same versions from a request header or from an `Accept` parameter, so a
client can keep one path while the router keeps one mount per version:

```ts
const app = await AponiaFactory.create(AppModule, {
  versioning: { type: "header", header: "x-api-version", defaultVersion: "1" },
});

// GET /users with x-api-version: 2 reaches the route mounted at /v2/users.
// GET /users with Accept: application/json; version=2 does the same under
// { type: "media-type" }.
```

`type` is `"uri"` (the default), `"header"`, or `"media-type"`; `header`
defaults to `x-api-version` and `parameter` to `version`. A leading `v` in the
requested or declared version is optional. Negotiation happens before routing,
so the selected route runs its own guards, pipes, validation, and filters.
Parameterized and wildcard paths (`:id`, `:term?`, `*`) negotiate like literal
ones, and a literal path is preferred over a parameter at the same depth.
A request that names a version no handler declared answers `400` with an
RFC 9457 Problem Details body and `code: "API_VERSION_NOT_FOUND"`. A route with
no version, including a `VERSION_NEUTRAL` one, is never rewritten. Because the
router still mounts one path per version, the OpenAPI document and inspection
output name the `/vN` paths.

`VERSION_NEUTRAL` keeps one route out of every version prefix:

```ts
import { Controller, Get, VERSION_NEUTRAL, Version } from "@aponiajs/common";

@Controller("users")
@Version("1")
export class UsersController {
  @Get()
  findAll() {
    return [];
  }

  @Get("health")
  @Version(VERSION_NEUTRAL)
  health() {
    return { status: "pass" };
  }
}
```

The list answers `GET /v1/users`, while the health check answers
`GET /users/health` and is not mounted under any `/vN` path. It is the marker a
health check, a webhook, or a compatibility route uses when a version bump must
not move it.

## Deprecating a route

`@Deprecated()` marks a controller or one handler as going away. The route
answers `Deprecation: true`; when the declaration states a sunset date or a
replacement URL, the response carries `Sunset` and a `rel="deprecation"` link:

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

A handler declaration overrides the controller's, so one endpoint can name a
different replacement. The headers are set before the handler runs, so a route
that fails still tells the client the endpoint is deprecated.

## Streaming events

`@Sse()` marks a route as a Server-Sent Events stream. The platform sets
`text/event-stream`, `cache-control: no-cache`, and `connection: keep-alive`
before the handler runs. Wrap each yielded event with `sse()`:

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

A string, an SSE payload, a generator, an async generator, and a byte stream are
all accepted by `sse()`.

## Serializing a response

`@Serialize()` shapes a handler's result after the handler and after the route's
interceptor `after` halves:

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

A method serializer overrides a controller serializer. The serializer receives
the platform-neutral `RouteContext`, and a thrown failure reaches the same
exception filters and Problem Details mapping as a handler failure.

Next: [06 · Validation](./06-validation.md) ·
Deep dive: [architecture and style](../architecture-and-style.md)
