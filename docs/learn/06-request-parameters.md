# 06 · Request parameters

**Use when:** a handler needs one piece of the request instead of the whole context.

| Decorator              | Injects                     |
| ---------------------- | --------------------------- |
| `@Body()`              | Validated request body      |
| `@Query("term")`       | Parsed query string         |
| `@Param("id")`         | Path parameters             |
| `@Headers("x-agent")`  | Request headers             |
| `@Cookie("session")`   | Cookies or one cookie value |
| `@Ip()`                | Peer address, when known    |
| `@HostParam()`         | Request host                |
| `@HostParam("tenant")` | First label of the host     |
| `@State()`             | Typed application state     |
| `@Req()`               | Native `Request`            |
| `@ResponseSettings()`  | Mutable response settings   |
| `@HttpStatus()`        | Typed status helper         |
| `@Context()`           | Whole Elysia context        |

Each decorator accepts an optional property name:

```ts
@Post()
create(@Body() body: CreateUser, @Headers("x-tenant") tenant: string) {
  return { tenant, name: body.name };
}

@Get(":id")
findOne(@Param("id") id: string, @Query("expand") expand: string | undefined) {
  return { id, expand };
}
```

## Whole context

A handler with no parameter decorators may declare one unannotated parameter to receive the context. `@Context()` does the same explicitly.

| Annotation                      | From                        | Use when                               |
| ------------------------------- | --------------------------- | -------------------------------------- |
| `RouteContext<typeof schema>`   | `@aponiajs/common`          | The handler stays platform-neutral     |
| `HandlerContext<typeof schema>` | `@aponiajs/platform-elysia` | The handler reads Elysia context       |
| `ElysiaResponseSettings`        | `@aponiajs/platform-elysia` | Only response settings are needed      |
| `ResponseStatus<typeof schema>` | `@aponiajs/platform-elysia` | Only the typed status helper is needed |

```ts
import { Context, Controller, Post } from "@aponiajs/common";
import { type HandlerContext } from "@aponiajs/platform-elysia";

@Post("/", createUserSchema)
create(@Context() context: HandlerContext<typeof createUserSchema>) {
  context.set.headers["x-created"] = "1";
  return context.body.name === "root"
    ? context.status(403, "forbidden")
    : { name: context.body.name };
}
```

Next: [07 · Validation](./07-validation.md) · Deep dive: [architecture and style](../build/architecture-and-style.md)
