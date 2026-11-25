import { Body, Controller, Module, Post } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
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

test("fingerprints a typed-array body by its bytes", async () => {
  let calls = 0;

  @Controller("view-body")
  class ViewBodyController {
    @Post()
    create(@Body() body: Uint8Array): string {
      calls += 1;
      return `${calls}:${body.length}:${body.reduce((sum, value) => sum + value, 0)}`;
    }
  }

  @Module({ imports: [IdempotencyModule.register()], controllers: [ViewBodyController] })
  class AppModule {}

  // A custom parser hands the handler a typed-array view rather than the
  // ArrayBuffer the built-in octet-stream parser returns.
  const application = await AponiaFactory.create(AppModule, {
    logger: false,
    plugins: [
      new Elysia({ name: "typed-array-parser" }).onParse("global", ({ request, contentType }) =>
        contentType === "application/octet-stream"
          ? request.arrayBuffer().then((buffer) => new Uint8Array(buffer))
          : undefined,
      ),
    ],
  });

  const sendBinary = (bytes: readonly number[], key: string): Request =>
    new Request("http://localhost/view-body", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "idempotency-key": key },
      body: new Uint8Array(bytes),
    });

  try {
    const first = await application.handle(sendBinary([1, 2, 3], "view-1"));
    expect(await first.text()).toBe("1:3:6");

    const replay = await application.handle(sendBinary([1, 2, 3], "view-1"));
    expect(await replay.text()).toBe("1:3:6");
    expect(calls).toBe(1);

    const different = await application.handle(sendBinary([9, 9, 9], "view-1"));
    expect(different.status).toBe(409);
    expect(calls).toBe(1);
  } finally {
    await application.close();
  }
});
