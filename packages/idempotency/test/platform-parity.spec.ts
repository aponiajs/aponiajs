import { expect, test } from "bun:test";
import { Body, Controller, Module, Post } from "@aponiajs/common";
import { AponiaFactory as ElysiaFactory } from "@aponiajs/platform-elysia";
import { createPlatformFactory } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";
import { honoAdapter } from "@aponiajs/platform-hono";
import { toFetchHandler } from "@aponiajs/serverless";
import { IdempotencyModule, MemoryIdempotencyStore } from "../src/index.ts";

@Controller("orders")
class OrdersController {
  static calls = 0;

  @Post()
  create(@Body() body: { readonly id: number }): string {
    OrdersController.calls += 1;
    return `created:${body.id}`;
  }
}

function appModule(registry: MemoryIdempotencyStore): new () => unknown {
  @Module({
    imports: [IdempotencyModule.forRoot({ store: registry })],
    controllers: [OrdersController],
  })
  class AppModule {}

  return AppModule;
}

function send(body: unknown, key: string): Request {
  return new Request("http://localhost/orders", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });
}

interface Answer {
  readonly first: { readonly status: number; readonly text: string };
  readonly replay: { readonly status: number; readonly text: string };
  readonly conflict: number;
}

async function observe(fetch: (request: Request) => Response | Promise<Response>): Promise<Answer> {
  const first = await fetch(send({ id: 1 }, "order-1"));
  const replay = await fetch(send({ id: 1 }, "order-1"));
  const conflict = await fetch(send({ id: 2 }, "order-1"));
  return {
    first: { status: first.status, text: await first.text() },
    replay: { status: replay.status, text: await replay.text() },
    conflict: conflict.status,
  };
}

test("the same idempotency registration answers identically on every platform", async () => {
  OrdersController.calls = 0;
  const elysia = await ElysiaFactory.create(appModule(new MemoryIdempotencyStore()), {
    logger: false,
  });
  const hono = await createPlatformFactory(honoAdapter()).create(
    appModule(new MemoryIdempotencyStore()),
    { logger: false },
  );
  const h3 = await createPlatformFactory(h3Adapter()).create(
    appModule(new MemoryIdempotencyStore()),
    { logger: false },
  );

  try {
    const answers = {
      elysia: await observe((request) => elysia.handle(request)),
      hono: await observe((request) => hono.handle(request)),
      h3: await observe((request) => h3.handle(request)),
      serverless: await observe(toFetchHandler(hono)),
    };
    for (const observed of Object.values(answers)) {
      expect(observed.first).toEqual({ status: 200, text: "created:1" });
      expect(observed.replay).toEqual({ status: 200, text: "created:1" });
      expect(observed.conflict).toBe(409);
    }
    // Three platforms answer their own first request; every repeat and every
    // conflict is answered without reaching the handler. The Web Fetch adapter
    // serves the Hono application, whose key was already recorded, so it adds no
    // handler call.
    expect(OrdersController.calls).toBe(3);
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});

test("a stopping application releases every claim it still holds", async () => {
  let releases = 0;
  let resolveHandler: (() => void) | undefined;
  const store = new MemoryIdempotencyStore();

  @Controller("slow")
  class SlowController {
    @Post()
    async create(): Promise<string> {
      await new Promise<void>((resolve) => {
        resolveHandler = resolve;
      });
      return "ok";
    }
  }

  @Module({
    imports: [
      IdempotencyModule.forRoot({
        requireKey: true,
        store: {
          get: (key) => store.get(key),
          set: (key, response, ttlMs) => store.set(key, response, ttlMs),
          delete: (key) => store.delete(key),
          clear: () => store.clear(),
          claim: () => true,
          release: () => {
            releases += 1;
          },
        },
      }),
    ],
    controllers: [SlowController],
  })
  class AppModule {}

  const application = await ElysiaFactory.create(AppModule, { logger: false });
  const pending = application.handle(
    new Request("http://localhost/slow", {
      method: "POST",
      headers: { "idempotency-key": "slow-1" },
    }),
  );
  while (resolveHandler === undefined) {
    await Promise.resolve();
  }

  await application.close();
  expect(releases).toBe(1);

  resolveHandler?.();
  await pending;
  // The answer reaching the response boundary does not release the claim twice.
  expect(releases).toBe(1);
});
