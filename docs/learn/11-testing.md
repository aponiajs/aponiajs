# 11 · Testing

**Use when:** verifying behavior — prefer this over reading the graph by hand.

An application answers a `Request` without binding a port, so a test exercises
the real module graph, the real container, and the real routes:

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

## Three habits

- Exercise public entrypoints. Build the application and assert through
  `application.handle`, rather than calling a controller method directly.
- Assert `AponiaError.code`, not message text.
- Pass `{ logger: false }` so test output stays readable.

Asserting a rejected request is the same shape with a `422` expectation, and a
service with no transport concern is still a plain unit test.

## The test kit

`@aponiajs/testing` is the same boot with the three habits built in:
`createTestApplication(AppModule).compile()` defaults `logger` to `false`, closes
idempotently through `await using`, and — the part the factory has no answer for —
replaces one provider for one boot:

```ts
const application = await createTestApplication(AppModule)
  .overrideProvider(UsersRepository)
  .useValue({ findById: async () => undefined })
  .compile();
```

An override rewrites the compiled module graph in the builder's own memory, so
the application's module class is untouched and two boots from one class share
nothing. A token no module in the graph provides is refused with
`MISSING_PROVIDER` rather than silently doing nothing. The one case that needs a
real socket — a WebSocket gateway — uses `application.listen()`, which binds port
`0` and reports both URLs.

It is not a test runner and not a mocking framework: `test` and `expect` stay
yours, and a dependency a module imported directly is beyond its reach.

## In this repository

Two mirrored lanes: Bun owns `packages/*/tests/*.test.ts`, Vite+ owns
`packages/*/tests-vp/*.conformance.ts`, and new framework behavior normally
needs a case in both. `bun test`, `bun run test:coverage`,
`bun run test:vite-plus`, and `bun run check` run before submitting. The
coverage lane enforces a 95% floor for both lines and functions.
`packages/cli/e2e/` packs the CLI and boots a generated application, so it is
slow and excluded from the default lanes.

Next: [12 · Releasing](./12-releasing.md) · Deep dive: [testing](../testing.md) ·
[`@aponiajs/testing`](../../packages/testing/README.md)
