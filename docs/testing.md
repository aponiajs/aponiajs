# Testing an Application

An Aponia application answers a `Request` without opening a port, so tests run
against the real module graph, the real container, and the real Elysia routes.
Nothing is mocked and nothing is faked: `application.handle` calls the same
compiled route table a listener would.

Two paths reach that, and the [test kit](#without-the-test-kit) section covers the
second one:

- **`@aponiajs/testing`** boots the application with `logger: false` by default,
  replaces a provider for one boot, and gives a case a teardown it cannot leak.
- **`@aponiajs/platform-elysia` directly**, which is what the kit is built on and
  what a reader who wants no extra dependency keeps using.

## The test kit

```bash
bun add --dev @aponiajs/testing
```

`createTestApplication` returns a builder rather than an application, because an
override has to be declared before the graph is compiled:

```ts
import { expect, test } from "bun:test";
import { createTestApplication } from "@aponiajs/testing";
import { AppModule } from "../src/app.module.ts";

test("creates a user", async () => {
  const application = await createTestApplication(AppModule).compile();

  try {
    const response = await application.handle(
      new Request("http://localhost/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "Ada" });
  } finally {
    await application.close();
  }
});
```

`logger` defaults to `false`, so startup output stays out of the test report.
Every other option is the factory's own `AponiaApplicationOptions`, so `plugins`,
`health`, and the global enhancers stay reachable; pass an array of levels or a
`LoggerService` when a case asserts on log output — see the
[logging guide](./logging.md).

`configureNative` is the one option the builder does not take. It exists on the
factory to preserve the native application's own type for Eden Treaty, and
`TestApplication` deliberately erases the native application to `AnyElysia`, so
accepting the option here would accept a type argument this wrapper discards. A
case that needs it builds through `AponiaFactory.create`, as the
[escape hatches](#escape-hatches) below show.

`close()` is idempotent, and `TestApplication` is an `AsyncDisposable`, so a
scope is enough and a throw cannot leak a boot:

```ts
await using application = await createTestApplication(AppModule).compile();
```

A build with nothing overridden hands the root straight to `AponiaFactory.create`,
so the boot is that call exactly — it is not a different, quieter application.

**The kit is not a test runner and not a mocking framework.** Every `test` and
`expect` stays your runner's; the kit depends on none and works beside
`bun:test`, `vite-plus/test`, and `node:test` alike. `overrideProvider` replaces a
provider in the compiled graph, and a dependency a module imported directly is
beyond its reach — the [package README](../packages/testing/README.md) states the
boundary in full.

## Replacing a provider

```ts
const application = await createTestApplication(AppModule)
  .overrideProvider(UsersRepository)
  .useValue({ findById: async () => undefined })
  .compile();
```

An override is keyed by the token the graph provides, and the rewrite walks the
whole compiled graph, so a provider an imported module exports is replaced
wherever in the graph it lives. The application's own module is never touched, so
two boots from one module class share nothing.

| Method                          | What it declares                                                      |
| ------------------------------- | --------------------------------------------------------------------- |
| `useValue(value)`               | Every read of the token resolves to this value.                       |
| `useFactory(factory, inject?)`  | Built once per boot; `inject` names the tokens the factory receives.  |
| `useClass(Substitute, inject?)` | Substitutes a class for the token, constructed with the named tokens. |
| `useExisting(otherToken)`       | Points the token at another token the graph already provides.         |

Each returns the builder, so the chain ends in `compile()`. `inject` is stated
rather than read from decorator metadata, because a hand-written stub carries
none. Declaring the same token twice is one decision, and the later declaration
wins.

A token no module in the graph provides fails `compile()` with `AponiaError` and
the code `MISSING_PROVIDER`, carrying `{ token }`. That refusal is the point of
the feature: a stub registered for a token nothing provides would leave every
test green while the code under test used the real dependency.

## Asserting validation

A schema rejects the request before the handler runs, so the handler needs no
defensive code and the test asserts the status:

```ts
const rejected = await application.handle(
  new Request("http://localhost/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "A" }),
  }),
);

expect(rejected.status).toBe(422);
```

## Asserting failures

Graph and container failures happen while the application is being created.
Assert the `code`, never the message:

```ts
import { AponiaError } from "@aponiajs/common";

await expect(AponiaFactory.create(BrokenModule, { logger: false })).rejects.toMatchObject({
  code: "MISSING_PROVIDER",
});
```

The full list of codes is in the
[dependency injection guide](./dependency-injection.md).

Application HTTP errors are observable response contracts. Assert the status,
media type, and complete Problem Details body:

```ts
const response = await application.handle(new Request("http://localhost/users/missing"));

expect(response.status).toBe(404);
expect(response.headers.get("content-type")).toBe("application/problem+json");
expect(await response.json()).toEqual({
  type: "about:blank",
  title: "Not Found",
  status: 404,
  detail: "The requested user does not exist.",
  code: "USER_NOT_FOUND",
});
```

The [errors chapter](./learn/10-errors.md) covers every default factory and
custom extension.

## Unit testing a service

A service with no dependency of its own has no framework concern, so construct it
directly rather than booting an application:

```ts
import { expect, test } from "bun:test";
import { UserService } from "./user.service.ts";

test("stores a created user", () => {
  const service = new UserService();
  const created = service.create("Ada");

  expect(service.findOne(created.id)).toEqual(created);
});
```

A controller is an ordinary class too: pass a stub service to its constructor
when the assertion is about controller behavior rather than routing.

Constructing directly stops being the right shape the moment the assertion is
about what a **request** receives from a stubbed dependency, because then the
route, the parameter binding, the validation, and the response mapping are all
part of the subject. That is what `overrideProvider` is for — the stub reaches the
same controller the route calls, and the assertion stays on `handle`:

```ts
const application = await createTestApplication(AppModule)
  .overrideProvider(UsersRepository)
  .useValue({ findById: async () => undefined })
  .compile();

const response = await application.handle(new Request("http://localhost/users/missing"));

expect(response.status).toBe(404);
```

## Testing a WebSocket gateway

An upgrade requires a listener, and there is no way around that. The kit binds one
on port `0` and reports both forms of the URL, so nothing reserves a port and
releases it first — the reservation is what leaves a window in which another
process takes the port before the application binds it:

```ts
import { expect, test } from "bun:test";
import { createTestApplication } from "@aponiajs/testing";
import { AppModule } from "../src/app.module.ts";

test("echoes a gateway message", async () => {
  const application = await createTestApplication(AppModule).compile();
  let socket: WebSocket | undefined;

  try {
    const server = await application.listen();
    socket = new WebSocket(`${server.webSocketUrl}/events`);

    await new Promise<void>((resolve) => {
      socket?.addEventListener("open", () => resolve(), { once: true });
    });

    const response = new Promise<MessageEvent>((resolve) => {
      socket?.addEventListener("message", resolve, { once: true });
    });

    socket.send(JSON.stringify({ event: "events.echo", data: "hello" }));

    expect(JSON.parse(String((await response).data))).toEqual({
      event: "events.echo",
      data: "hello",
    });
  } finally {
    socket?.close();
    await application.close();
  }
});
```

`server.url` is the `http://` form of the bound socket and `server.webSocketUrl`
is the `ws://` form of the same one. Nothing else in the kit opens a port, and a
case that only calls `handle` never needs this.

Unit tests can inspect frozen gateway metadata without opening a port. The
[WebSocket guide](./websockets.md) lists the metadata getters and error-frame
contract.

## Without the test kit

Everything above is a convenience over the platform, and a reader who wants no
extra dependency loses only the conveniences. An application built with the
factory directly answers the same requests, and the two differences are stated
rather than hidden: `logger` has to be turned off by hand, and a boot that opened
a listener has to be closed by hand.

```ts
import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

test("creates a user", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });

  const response = await application.handle(
    new Request("http://localhost/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    }),
  );

  expect(response.status).toBe(200);
});
```

`handle` never binds a port, so nothing needs to be closed here. Call
`application.close()` after `application.listen(port)`. Closing terminates active
native connections by default; `application.close(false)` opts into caller-managed
draining. Closing a `handle`-driven application is never required to release a
socket, but it is how a suite observes the stopping hooks, which the
[lifecycle guide](./lifecycle.md) explains.

There is no provider override on this path. A dependency is replaced by
constructing the controller or service in the test, or by declaring a module for
the test — which is what the kit's rewrite of the compiled graph exists to make
unnecessary.

## Escape hatches

`application.application.getNativeApplication()` returns the Elysia instance,
which is useful when a test needs Elysia's own state or plugin decorators:

```ts
const application = await createTestApplication(AppModule).compile();
const native = application.application.getNativeApplication();

expect(native.store).toBeDefined();
```

Configuring the native application _before_ the boot is the factory's
`configureNative`, which the builder deliberately does not take:

```ts
const application = await AponiaFactory.create(AppModule, {
  logger: false,
  configureNative: (native) => native.state("version", "test"),
});

expect(application.getNativeApplication().store.version).toBe("test");
```

For Eden Treaty, return that native surface directly and pass it to Treaty:

```ts
import { treaty } from "@elysia/eden";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

const app = await AponiaFactory.createNative(AppModule, { logger: false });
const api = treaty(app);
```

This keeps statically composed route types and performs no network I/O. See the
[Eden Treaty guide](./eden-treaty.md) for the complete fixture.
