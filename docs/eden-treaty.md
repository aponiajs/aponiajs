# End-to-End Types with Eden Treaty

Aponia can return the composed native Elysia application, so Eden usage stays
the same as it is in a plain Elysia project:

```ts
export const app = await AponiaFactory.createNative(AppModule);
export type App = typeof app;
```

The frontend imports `App` and passes it directly to Treaty. There is no
separate contract, type assertion, adapter, or custom fetcher.

## Install

The server needs Aponia and Elysia:

```bash
bun add @aponiajs/common @aponiajs/platform-elysia elysia
```

The client needs Eden. Keep its Elysia version aligned with the server:

```bash
bun add @elysia/eden
bun add --dev elysia
```

## Define and export the application

Native Elysia routes can enter the Aponia module graph through
`defineElysiaPlugin`. `defineModule` preserves the exact plugin type while
Aponia still owns application composition:

```ts
// backend/src/server.ts
import { defineModule } from "@aponiajs/common";
import { AponiaFactory, defineElysiaPlugin } from "@aponiajs/platform-elysia";
import { Elysia, t } from "elysia";

const userSchema = t.Object({
  id: t.Number(),
  name: t.String(),
});

const apiRoutes = defineElysiaPlugin(
  new Elysia({ name: "api-routes" }).get(
    "/users/:id",
    ({ params }) => ({
      id: params.id,
      name: `user-${params.id}`,
    }),
    {
      params: t.Object({ id: t.Number() }),
      response: userSchema,
    },
  ),
  { key: "api-routes" },
);

export const AppModule = defineModule({
  id: "AppModule",
  imports: [apiRoutes],
});

export const app = await AponiaFactory.createNative(AppModule);
export type App = typeof app;

if (import.meta.main) {
  app.listen(3000);
}
```

`app` is the real Elysia instance. Native methods such as `use`, `listen`,
`handle`, `compile`, and `stop` remain available without an Aponia-specific
facade.

## Create the client

Use the exported application type exactly as Eden documents for a native Elysia
server:

```ts
// frontend/src/api.ts
import { treaty } from "@elysia/eden";
import type { App } from "@backend/server.ts";

export const api = treaty<App>("http://localhost:3000");

const result = await api.users({ id: 42 }).get();

if (result.error) {
  throw result.error.value;
}

console.log(result.data.name);
```

The backend import is type-only, so it does not bootstrap the server or add
server runtime code to the frontend bundle.

Eden rejects calls that disagree with the route schema:

```ts
// @ts-expect-error The path parameter accepts a string or number, not a boolean.
void api.users({ id: true }).get();

// @ts-expect-error This route only exposes GET.
void api.users({ id: 42 }).post();
```

## Use Aponia controllers and dependency injection

Controller descriptors can contribute their native Elysia route types to the
same application. Return the fluent Elysia plugin from `buildPlugin`, then place
the descriptor in a `defineModule` controller tuple:

```ts
import { defineModule, provideClass } from "@aponiajs/common";
import { AponiaFactory, defineElysiaController } from "@aponiajs/platform-elysia";
import { Elysia, t } from "elysia";

class UsersService {
  find(id: number) {
    return { id, name: `user-${id}` };
  }
}

class UsersController {
  constructor(readonly users: UsersService) {}
}

const usersController = defineElysiaController(UsersController, {
  inject: [UsersService] as const,
  buildPlugin: (controller) =>
    new Elysia({ name: "users-controller" }).get(
      "/users/:id",
      ({ params }) => controller.users.find(params.id),
      {
        params: t.Object({ id: t.Number() }),
        response: t.Object({
          id: t.Number(),
          name: t.String(),
        }),
      },
    ),
});

const AppModule = defineModule({
  id: "AppModule",
  providers: [provideClass(UsersService, [] as const)],
  controllers: [usersController],
});

export const app = await AponiaFactory.createNative(AppModule);
export type App = typeof app;
```

Imported descriptor modules and `defineElysiaPlugin` imports are traversed in
the same order as runtime bootstrap. Routes added by `configureNative` are also
included:

```ts
const app = await AponiaFactory.createNative(AppModule, {
  configureNative: (native) => native.get("/health", () => ({ status: "ok" as const })),
});
```

## Test without opening a port

Treaty accepts the returned Elysia instance directly:

```ts
import { expect, test } from "bun:test";
import { treaty } from "@elysia/eden";
import { app } from "../src/server.ts";

test("reads a user through the typed application", async () => {
  const api = treaty(app);

  const result = await api.users({ id: 42 }).get();

  expect(result.error).toBeNull();
  expect(result.data).toEqual({ id: 42, name: "user-42" });
});
```

This uses Elysia's in-process request path. It performs no network I/O and needs
no custom `fetch` implementation.

## Keep the managed application when needed

`AponiaFactory.create` remains the managed lifecycle API. Its native application
now retains the same inferred routes:

```ts
const application = await AponiaFactory.create(AppModule, {
  logger: false,
});
const api = treaty(application.getNativeApplication());

await application.listen(3000);
await application.close();
```

Use `createNative` for native Elysia and Eden ergonomics. Use `create` when the
Aponia lifecycle facade, startup logging, `getUrl`, or `close` is more useful.

## Static inference boundary

TypeScript can preserve routes that are visible in source:

- native applications wrapped by `defineElysiaPlugin`;
- `defineElysiaController` descriptors whose `buildPlugin` returns a typed
  Elysia plugin;
- statically declared imports and controllers in `defineModule`;
- native routes accumulated by `configureNative`.

Decorator metadata and asynchronous plugin factories are discovered only at
runtime. TypeScript cannot inspect them, so their routes still work but are not
added to the exported Eden type. Decorator-wide inference requires the planned
build-time module compiler; Aponia deliberately does not cast unknown runtime
routes into a false contract.

The contract is covered in both runtime/type tests at
`packages/platform-elysia/tests/eden-contract.test.ts` and the Vite+
conformance lane.

[Native plugins](./native-plugins.md) ·
[Testing](./testing.md) ·
[Adapter README](../packages/platform-elysia/README.md)
