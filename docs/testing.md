# Testing an Application

An Aponia application answers a `Request` without opening a port, so tests run
against the real module graph, the real container, and the real Elysia routes.

## Handling requests

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
  expect(await response.json()).toEqual({ name: "Ada" });
});
```

`logger: false` keeps startup output out of the test report. Pass an array of
levels, or a `LoggerService`, when a test asserts on log output — see the
[logging guide](./logging.md).

`handle` never binds a port, so nothing needs to be closed. Call
`application.close()` only after `application.listen(port)`. Closing terminates
active native connections by default; `application.close(false)` opts into
caller-managed draining.

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

A service has no framework dependency, so construct it directly rather than
booting an application:

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

## Testing a WebSocket gateway

An upgrade requires a listener, so WebSocket integration tests use an ephemeral
port and always close both resources:

```ts
import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { createServer } from "node:net";
import { AppModule } from "../src/app.module.ts";

test("echoes a gateway message", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  const reservation = createServer();
  await new Promise<void>((resolve) => {
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  await application.listen(port);
  const socket = new WebSocket(`${application.getUrl().replace("http://", "ws://")}/events`);

  try {
    await new Promise<void>((resolve) => {
      socket.addEventListener("open", () => resolve(), { once: true });
    });
    const response = new Promise<MessageEvent>((resolve) => {
      socket.addEventListener("message", resolve, { once: true });
    });

    socket.send(JSON.stringify({ event: "events.echo", data: "hello" }));

    expect(JSON.parse(String((await response).data))).toEqual({
      event: "events.echo",
      data: "hello",
    });
  } finally {
    socket.close();
    await application.close();
  }
});
```

Unit tests can inspect frozen gateway metadata without opening a port. The
[WebSocket guide](./websockets.md) lists the metadata getters and error-frame
contract.

## Escape hatches

`application.getNativeApplication()` returns the Elysia instance, which is
useful when a test needs Elysia's own state or plugin decorators:

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
