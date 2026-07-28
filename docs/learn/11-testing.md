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

## In this repository

Two mirrored lanes: Bun owns `packages/*/tests/*.test.ts`, Vite+ owns
`packages/*/tests-vp/*.conformance.ts`, and new framework behavior normally
needs a case in both. `bun test`, `bun run test:vite-plus`, and `bun run check`
run before submitting. `packages/cli/e2e/` packs the CLI and boots a generated
application, so it is slow and excluded from the default lanes.

Next: [12 · Releasing](./12-releasing.md) · Deep dive: [testing](../testing.md)
