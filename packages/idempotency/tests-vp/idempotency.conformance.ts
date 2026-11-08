import { Body, Controller, Module, Post } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  IdempotencyModule,
  MemoryIdempotencyStore,
  type IdempotencyModuleOptions,
  type IdempotencyStore,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented idempotency contract", () => {
  const store: IdempotencyStore = new MemoryIdempotencyStore();
  const options: IdempotencyModuleOptions = { ttlMs: 1_000, store, requireKey: false };

  expect(options.ttlMs).toBe(1_000);
  expect(options.store).toBe(store);
});

test("replays a mutating request through a booted application", async () => {
  let calls = 0;

  @Controller("orders")
  class OrdersController {
    @Post()
    create(@Body() body: { readonly id: number }): string {
      calls += 1;
      return `created:${body.id}`;
    }
  }

  @Module({ imports: [IdempotencyModule.register()], controllers: [OrdersController] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const request = () =>
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "order-1" },
        body: JSON.stringify({ id: 1 }),
      });

    const first = await application.handle(request());
    const second = await application.handle(request());

    expect(await first.text()).toBe("created:1");
    expect(await second.text()).toBe("created:1");
    expect(calls).toBe(1);
  } finally {
    await application.close();
  }
});
