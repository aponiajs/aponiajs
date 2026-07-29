# @aponiajs/common

[![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcommon)](https://www.npmjs.com/package/@aponiajs/common)

Platform-neutral decorators and public contracts for Aponia modules,
controllers, routes, and dependency injection.

## Install

```bash
bun add @aponiajs/common
```

## Public surface

The public application authoring API includes `@Module()`, `@Controller()`,
HTTP method decorators, `@Injectable()`, and `@Inject()`. This package does not
depend on Elysia, Bun runtime APIs, or another Aponia package.

```ts
import { Controller, Get, Injectable, Module } from "@aponiajs/common";

@Injectable()
class GreetingService {
  greet(): string {
    return "Hello!";
  }
}

@Controller("greetings")
class GreetingController {
  constructor(private readonly greetings: GreetingService) {}

  @Get()
  getGreeting(): string {
    return this.greetings.greet();
  }
}

@Module({
  controllers: [GreetingController],
  providers: [GreetingService],
})
export class GreetingModule {}
```

## Route validation

Every HTTP method decorator accepts a schema declared with
[Standard Schema](https://standardschema.dev), so Zod, ArkType, Valibot, and
platform-native TypeBox validators all work. Validation runs before the handler,
so a rejected request never reaches controller code.

```ts
import { Body, Controller, Get, Param, Post } from "@aponiajs/common";
import { z } from "zod";

const CreateUser = z.object({
  name: z.string().min(2),
});
type CreateUser = z.infer<typeof CreateUser>;

@Controller("users")
class UserController {
  @Post("/", { body: CreateUser })
  createUser(@Body() body: CreateUser): CreateUser {
    return body;
  }

  @Get(":id")
  findUser(@Param("id") id: string): { id: string } {
    return { id };
  }
}
```

`body`, `query`, `params`, `headers`, and `response` are the available schema
slots.

## Request parameters

Parameter decorators inject one piece of the request, and an optional name
selects a single property:

| Decorator                | Injects                                |
| ------------------------ | -------------------------------------- |
| `@Body()` / `@Body("k")` | The validated request body             |
| `@Query()`               | The parsed query string                |
| `@Param("id")`           | Path parameters                        |
| `@Headers("x-agent")`    | Request headers                        |
| `@Cookie("session")`     | Request cookies, or one cookie's value |
| `@Req()`                 | The native `Request`                   |
| `@Res()`                 | The mutable response settings          |
| `@Ctx()`                 | The whole platform context             |

A handler with no parameter decorators may declare one unannotated parameter to
receive the context, typed platform-neutrally by
`RouteContext<typeof schema>`. An Elysia application can annotate it with
`ElysiaRouteContext<typeof schema>` from
`@aponiajs/platform-elysia` to keep Elysia's own context types.

[npm package](https://www.npmjs.com/package/@aponiajs/common) ·
[complete package catalog](../../docs/packages.md)
