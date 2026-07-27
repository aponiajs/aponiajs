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
`application.close()` only after `application.listen(port)`.

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
