# 07 · Validation

**Use when:** a route accepts input that must be rejected when it is wrong.

Wrap one validator in one model class and use that class in the route slot:

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

`@Validation()` records the validator. The same-named interface merges its output type into the class, so `body.name` is typed without repeating `typeof`.

## Slots

| Slot       | Validates       |
| ---------- | --------------- |
| `body`     | Request body    |
| `query`    | Query string    |
| `params`   | Path parameters |
| `headers`  | Request headers |
| `cookie`   | Cookies         |
| `response` | Response body   |

Each slot accepts a model class or a raw validator. Raw validators are the low-level escape hatch.

`response` accepts one validator or a status-specific map:

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

## Deriving schemas

`partialSchema`, `pickSchema`, `omitSchema`, and `intersectSchema` call the validator's own combinators:

```ts
import { partialSchema } from "@aponiajs/common";
import { z } from "zod";

const CreateUser = z.object({ email: z.email(), name: z.string() });
const UpdateUser = partialSchema(CreateUser);
```

A validator that does not expose the requested combinator is refused with `INVALID_VALIDATION_MODEL`. The framework never reimplements an operation the validator does not state.

## Types

Handler types come from the annotations you write. `HandlerContext<typeof schema>` and `ResponseStatus<typeof schema>` accept the same model-backed schema and keep body, params, cookie, and response inference.

Next: [08 · Enhancers](./08-enhancers.md) · Deep dive: [execution enhancers](../build/enhancers.md)
