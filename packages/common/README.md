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
HTTP method decorators, WebSocket gateway decorators, `@Injectable()`,
`@Inject()`, `defineConfiguration()` — which returns a `ConfigurationToken`
carrying the schema its value must satisfy — and the guard, interceptor, and
filter decorators. The public types
include the five provider lifecycle contracts — `OnModuleInit`,
`OnApplicationBootstrap`, `BeforeApplicationShutdown`, `OnModuleDestroy`, and
`OnApplicationShutdown` — which a provider implements by declaring the method;
the platform reads that method from the instance, never the type, so
`implements` is optional ([lifecycle guide](../../docs/lifecycle.md)). This package does
not depend on Elysia, Bun runtime APIs, or another Aponia package.

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

For descriptor-first applications, `defineModule()` supplies frozen empty
collections for omitted options and preserves each declared collection as an
exact tuple. Multiple native plugins and controller descriptors therefore keep
their individual route contracts without requiring `as const`.

Constructor dependencies follow the constructor that actually runs. A subclass
that declares no constructor of its own resolves the parent's reflected
parameter types and `@Inject()` tokens; one that declares its own constructor
reads its own metadata. The
[dependency injection guide](../../docs/dependency-injection.md) covers token
and visibility rules in full.

## Route validation

Every HTTP method decorator accepts either a validation-model class or a raw
schema declared with [Standard Schema](https://standardschema.dev), so Zod,
ArkType, Valibot, and platform-native TypeBox validators all work. Validation
runs before the handler, so a rejected request never reaches controller code.

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Validation,
  type InferValidatorOutput,
} from "@aponiajs/common";
import { z } from "zod";

const createUserSchema = z.object({
  name: z.string().min(2),
});

@Validation(createUserSchema)
class CreateUser {}
interface CreateUser extends InferValidatorOutput<typeof createUserSchema> {}

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

`@Validation()` associates exactly one existing route validator with a class.
Use distinct classes for create, update, parameter, and response contracts.
Because decorators do not change a class's TypeScript instance shape, the
example explicitly merges the schema output into the class interface. Passing a
raw validator directly, such as `{ body: createUserSchema }`, remains supported
as the low-level authoring path.

`body`, `query`, `params`, `headers`, `cookie`, and `response` are the available
schema slots. `response` accepts either one validator for the default success
response or a status map such as `{ 200: User, 404: NotFound }`; each entry may
also be a validation-model class.

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
| `@Store()`               | Application state                      |
| `@Req()`                 | The native `Request`                   |
| `@Set()` / `@Res()`      | The mutable response settings          |
| `@Status()`              | The response status helper             |
| `@Ctx()`                 | The whole platform context             |

A handler with no parameter decorators may declare one unannotated parameter to
receive the context, typed platform-neutrally by
`RouteContext<typeof schema>`. An Elysia application can annotate it with
`ElysiaRouteContext<typeof schema>` from
`@aponiajs/platform-elysia` to keep Elysia's own context types. `@Res()` remains
the Nest-style alias of the native-named `@Set()`.

`@Set()` and `@Res()` expose the mutable response settings — a status and
headers. Redirects are not a response setting: return the platform's inline
`redirect(url)` helper from the handler, because an assigned redirect on the
response settings is ignored by the platform.

## Execution enhancers

`@UseGuards()`, `@UseInterceptors()`, and `@UseFilters()` declare the classes
that decide whether a route runs, wrap its result, and answer what it throws.
`@Catch()` names the error types a filter answers:

```ts
import {
  Catch,
  Controller,
  Get,
  Injectable,
  Module,
  UseFilters,
  UseGuards,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
} from "@aponiajs/common";

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return context.switchToHttp().getRequest().headers.authorization === "Bearer secret";
  }
}

class UserMissingError extends Error {}

@Catch(UserMissingError)
@Injectable()
class UserMissingFilter implements ExceptionFilter {
  catch(): unknown {
    return new Response("No such user.", { status: 404 });
  }
}

@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
  @Get(":id")
  @UseFilters(UserMissingFilter)
  read(): string {
    throw new UserMissingError("no such user");
  }
}

@Module({
  controllers: [UsersController],
  providers: [AuthGuard, UserMissingFilter],
})
export class UsersModule {}
```

The decorators on a controller class apply to every route it declares; the ones
on a method apply to that route alone and run after their controller's. A guard
returning `false` refuses the request with a Problem Details `403`. An
interceptor declares `interceptBefore` and `interceptAfter` instead of Nest's
`next.handle()`, and `interceptBefore` cannot short-circuit. A filter that
returns `undefined` or `null` declines, so the next entry in the route's error
path is consulted; every other value answers. Guards, interceptors, and filters
are handed an `ExecutionContext` or
an `ArgumentsHost` whose `getContext()` and `switchToHttp().getRequest()` answer
the request's `RouteContext`.

This package records the declarations and publishes the contracts; the platform
resolves each enhancer as a provider while the controller mounts, so an enhancer
that is not declared fails the boot with `MISSING_PROVIDER`. The
[enhancers guide](../../docs/enhancers.md) covers precedence, resolution, and the
default filter.

## WebSocket gateways

`@WebSocketGateway()` marks a class provider as a gateway, and
`@SubscribeMessage()` maps event envelopes to methods:

```ts
import {
  MessageBody,
  Module,
  SubscribeMessage,
  WebSocketGateway,
  type WsResponse,
} from "@aponiajs/common";

@WebSocketGateway("/chat")
class ChatGateway {
  @SubscribeMessage("chat.send")
  send(@MessageBody("text") text: string): WsResponse<string> {
    return { event: "chat.message", data: text };
  }
}

@Module({ providers: [ChatGateway] })
class ChatModule {}
```

`@ConnectedSocket()` injects the platform socket, `@WebSocketServer()` injects
the native server, and `OnGatewayInit`, `OnGatewayConnection`, and
`OnGatewayDisconnect` describe lifecycle methods without importing a platform.
The [WebSocket guide](../../docs/websockets.md) documents the wire protocol and
Elysia runtime types.

[npm package](https://www.npmjs.com/package/@aponiajs/common) ·
[complete package catalog](../../docs/packages.md)
