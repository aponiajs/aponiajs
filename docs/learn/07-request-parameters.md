# 07 · Request parameters

**Use when:** a handler needs one piece of the request rather than the whole
context.

| Decorator             | Injects                        |
| --------------------- | ------------------------------ |
| `@Body()`             | The validated request body     |
| `@Query("term")`      | The parsed query string        |
| `@Param("id")`        | Path parameters                |
| `@Headers("x-agent")` | Request headers                |
| `@Cookie("session")`  | Cookies, or one cookie's value |
| `@State()`            | Typed application state        |
| `@Req()`              | The native `Request`           |
| `@ResponseSettings()` | Mutable response settings      |
| `@HttpStatus()`       | The typed status helper        |
| `@Context()`          | The whole Elysia context       |

Each accepts an optional name that selects a single property:

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

Annotate the injected values with `AppState<AppPlugins>`, `ElysiaResponseSettings`, and
`ResponseStatus<typeof schema>` from `@aponiajs/platform-elysia` when exact plugin
or response types matter.

## Taking the whole context

A handler with no parameter decorators may declare one unannotated parameter to
receive the context, and `@Context()` does the same explicitly. The annotation
decides what it reads:

| Annotation                                                 | From                        | Use when                                               |
| ---------------------------------------------------------- | --------------------------- | ------------------------------------------------------ |
| `RouteContext<typeof schema>`                              | `@aponiajs/common`          | The handler should stay platform-neutral               |
| `HandlerContext<typeof schema>`                            | `@aponiajs/platform-elysia` | The handler reads Elysia's own context                 |
| `ElysiaResponseSettings` / `ResponseStatus<typeof schema>` | `@aponiajs/platform-elysia` | A parameter decorator injects only the response helper |

`HandlerContext` keeps Elysia's own `status`, `set`, `cookie`, `store`, and
`redirect` typed; `RouteContext` covers the validated slots and the native
`Request` without them.

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

Next: [08 · Native plugins](./08-native-plugins.md) ·
Deep dive: [architecture and style](../architecture-and-style.md)
