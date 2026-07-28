# 06 · Validation

**Use when:** a route accepts input that must be rejected when it is wrong.

Declare a schema on the route decorator and an invalid request never reaches the
handler:

```ts
import { Body, Controller, Post } from "@aponiajs/common";
import { z } from "zod";

const createUser = { body: z.object({ name: z.string().min(2) }) };
type CreateUser = z.infer<(typeof createUser)["body"]>;

@Controller("users")
export class UserController {
  @Post("/", createUser)
  create(@Body() body: CreateUser) {
    return body;
  }
}
```

A rejected request returns `422` without running the handler.

## Accepted validators

Any [Standard Schema](https://standardschema.dev) implementation works — Zod,
ArkType, Valibot — as do TypeBox and Elysia's `t`. `@aponiajs/common` matches the
first kind through `~standard` and the second structurally, so TypeBox never
becomes a dependency of the contract layer.

## Slots

`body`, `query`, `params`, `headers`, and `response`. The schema may be passed
alone when the route has no path suffix: `@Post(createUser)`.

## Types come from your annotations

TypeScript cannot contextually type a decorated method's parameters, so a
handler's types come from what you write, exactly as in NestJS. Keep the schema
in a `const` and derive the type from it — `z.infer`, `Static<typeof …>` — rather
than expecting inference from the decorator.

Next: [07 · Request parameters](./07-request-parameters.md) ·
Deep dive: [architecture and style](../architecture-and-style.md)
