# 11 · Testing

**Use when:** verifying application behavior.

An application answers a `Request` without binding a port, so a test exercises the real module graph, container, and routes:

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

- Exercise public entrypoints. Build the application and assert through `application.handle`.
- Assert `AponiaError.code`, not message text.
- Pass `{ logger: false }` so test output stays readable.

## Test kit

`@aponiajs/testing` wraps the same boot and adds provider overrides:

```ts
const application = await createTestApplication(AppModule)
  .overrideProvider(UsersRepository)
  .useValue({ findById: async () => undefined })
  .compile();
```

The override rewrites the compiled graph in memory, so the module class is untouched and two boots from one class share nothing. A token no module provides raises `MISSING_PROVIDER`.

The test kit is not a runner or a mocking framework. `test` and `expect` stay yours.

## In this repository

Bun owns `packages/*/tests/*.test.ts`; Vite+ owns `packages/*/tests-vp/*.conformance.ts`. New framework behavior normally needs a case in both. Run `bun test`, `bun run test:coverage`, `bun run test:vite-plus`, and `bun run check` before submitting.

Next: [12 · Releasing](./12-releasing.md) · Deep dive: [testing](../build/testing.md)
