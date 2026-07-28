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
| `@Req()`              | The native `Request`           |
| `@Res()`              | The mutable response settings  |
| `@Ctx()`              | The whole Elysia context       |

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

## Taking the whole context

A handler with no parameter decorators receives the context as its only
argument, and `@Ctx()` does the same explicitly. Annotate it with
`RouteContext<typeof schema>` to stay platform-neutral, or with
`ElysiaRouteContext<typeof schema>` to keep Elysia's own `status`, `set`,
`cookie`, `store`, and `redirect` typed:

```ts
import { Controller, Ctx, Post } from "@aponiajs/common";
import { type ElysiaRouteContext } from "@aponiajs/platform-elysia";

@Post("/", createUser)
create(@Ctx() context: ElysiaRouteContext<typeof createUser>) {
  context.set.headers["x-created"] = "1";
  return context.body.name === "root"
    ? context.status(403, "forbidden")
    : { name: context.body.name };
}
```

Next: [08 · Native plugins](./08-native-plugins.md) ·
Deep dive: [architecture and style](../architecture-and-style.md)
