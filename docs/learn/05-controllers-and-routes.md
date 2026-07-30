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
`GET /users/:id`.

## Native inference with less syntax

Use `elysiaController` when the shortest type-safe route is more useful than
decorator metadata:

```ts
import { defineModule, provideClass } from "@aponiajs/common";
import { elysiaController } from "@aponiajs/platform-elysia";
import { t } from "elysia";

const usersController = elysiaController(UserController, [UserService], (app, controller) =>
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

Next: [06 · Validation](./06-validation.md) ·
Deep dive: [architecture and style](../architecture-and-style.md)
