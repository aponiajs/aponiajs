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
and `RouteContext` types the validated slots.

```ts
import { Post, type RouteContext } from "@aponiajs/common";
import { z } from "zod";

const createUser = {
  body: z.object({
    name: z.string().min(2),
  }),
} as const;

@Controller("users")
class UserController {
  @Post("/", createUser)
  create(context: RouteContext<typeof createUser>): string {
    return context.body.name;
  }
}
```

`body`, `query`, `params`, `headers`, and `response` are the available slots.
A rejected request never reaches the handler.

[npm package](https://www.npmjs.com/package/@aponiajs/common) ·
[complete package catalog](../../docs/packages.md)
