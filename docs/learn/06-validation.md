# 06 · Validation

**Use when:** a route accepts input that must be rejected when it is wrong.

Wrap one validator in one validation-model class, then use that class in the
route slot. An invalid request never reaches the handler:

```ts
import { Body, Controller, Post, Validation, type InferValidatorOutput } from "@aponiajs/common";
import { z } from "zod";

const createUserSchema = z.object({ name: z.string().min(2) });

@Validation(createUserSchema)
export class CreateUser {}

export interface CreateUser extends InferValidatorOutput<typeof createUserSchema> {}

@Controller("users")
export class UserController {
  @Post("/", { body: CreateUser })
  create(@Body() body: CreateUser) {
    return body;
  }
}
```

The class and the same-named interface are two halves of one model:
`@Validation()` records the validator, and the interface merges that validator's
output type into the class. TypeScript cannot contextually type a decorated
method's parameters, so the merge is what makes `body: CreateUser` mean the
validated shape rather than an empty class — without it, `body.name` fails to
compile with _Property 'name' does not exist on type 'CreateUser'_.

A rejected request returns `422` without running the handler.

## Accepted validators

Any [Standard Schema](https://standardschema.dev) implementation works — Zod,
ArkType, Valibot — as do TypeBox and Elysia's `t`. `@aponiajs/common` matches the
first kind through `~standard` and the second by the markers a TypeBox 1 builder
declares, so a `t.Object()` needs no conversion. Reading the value such a schema
produces takes a type-only TypeBox import, and that type-only import is the whole
dependency: nothing in the contract layer reaches TypeBox at runtime.

`@Validation()` accepts exactly one complete validator. Different route
contracts use different classes:

```ts
const updateUserSchema = createUserSchema.partial();
const userParamsSchema = z.object({ id: z.string().uuid() });

@Validation(updateUserSchema)
export class UpdateUser {}
export interface UpdateUser extends InferValidatorOutput<typeof updateUserSchema> {}

@Validation(userParamsSchema)
export class UserParams {}
export interface UserParams extends InferValidatorOutput<typeof userParamsSchema> {}
```

Use `CreateUser` as the POST body, `UpdateUser` as the PATCH body, and
`UserParams` as the params model shared by read, update, and delete routes. A
delete route normally validates its identifier in `params`; it does not need a
request-body model.

## Slots

`body`, `query`, `params`, `headers`, `cookie`, and `response`. Each slot accepts
a validation-model class or a raw validator. Raw route schemas remain available
for low-level and native integrations.

`response` accepts one success validator or a status-specific map. The latter
also narrows Elysia's `context.status` helper:

```ts
import { Controller, Get } from "@aponiajs/common";
import { type HandlerContext } from "@aponiajs/platform-elysia";
import { t } from "elysia";

const findUser = {
  response: {
    200: t.Object({ id: t.Number() }),
    404: t.Object({ code: t.Literal("USER_NOT_FOUND") }),
  },
};

@Controller("users")
class UserController {
  @Get(":id", findUser)
  find(context: HandlerContext<typeof findUser>) {
    return context.status(404, { code: "USER_NOT_FOUND" });
  }
}
```

Cookie schemas are handed to Elysia unchanged, so validation and
`context.cookie.session.value` use the same inferred value type.

## Types come from model annotations

A handler's types still come from what you write, exactly as in NestJS.
Controllers annotate `CreateUser`, `UpdateUser`, or `UserParams` directly, and
each annotation carries the fields its same-named interface merged in. The CLI
emits that declaration-merging line for generated REST resources.
When a method needs the whole native context,
`HandlerContext<typeof routeSchema>` and
`ResponseStatus<typeof routeSchema>` accept the same model-backed schema and
preserve body, params, cookie, and status-specific response inference.

Next: [07 · Request parameters](./07-request-parameters.md) ·
Deep dive: [architecture and style](../architecture-and-style.md)
