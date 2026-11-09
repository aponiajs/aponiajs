import { afterEach, describe, expect, test } from "bun:test";
import { AponiaError, Body, Controller, Get, Module, Post } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { IdempotencyModule, MemoryIdempotencyStore, type IdempotencyStore } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

function send(path: string, body: unknown, key?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key === undefined ? {} : { "idempotency-key": key }),
    },
    body: JSON.stringify(body),
  });
}

describe("IdempotencyModule", () => {
  test("reports store failures, rejects a long key, and still runs the handler", async () => {
    const errors: string[] = [];
    const failingStore: IdempotencyStore = {
      get() {
        throw new Error("read failed");
      },
      set() {
        throw new Error("write failed");
      },
      delete() {
        return false;
      },
      clear() {},
    };

    @Controller("orders")
    class OrdersController {
      @Post()
      create(@Body() body: { readonly id: number }): string {
        return `created:${body.id}`;
      }
    }

    @Module({
      imports: [
        IdempotencyModule.register({
          store: failingStore,
          onError: (_error, key) => errors.push(key),
        }),
      ],
      controllers: [OrdersController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const tooLong = await application.handle(send("/orders", { id: 1 }, "x".repeat(300)));
    expect(tooLong.status).toBe(400);

    const response = await application.handle(send("/orders", { id: 2 }, "order-2"));
    expect(await response.text()).toBe("created:2");
    expect(errors).toContain("order-2");
  });

  test("replays the recorded answer without running the handler again", async () => {
    let calls = 0;

    @Controller("orders")
    class OrdersController {
      @Post()
      create(@Body() body: { readonly id: number }): string {
        calls += 1;
        return `created:${body.id}`;
      }

      @Get()
      read(): string {
        calls += 1;
        return "read";
      }
    }

    @Module({
      imports: [IdempotencyModule.register()],
      controllers: [OrdersController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const first = await application.handle(send("/orders", { id: 1 }, "order-1"));
    const second = await application.handle(send("/orders", { id: 1 }, "order-1"));

    expect(await first.text()).toBe("created:1");
    expect(await second.text()).toBe("created:1");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(calls).toBe(1);

    const read = await application.handle(
      new Request("http://localhost/orders", { headers: { "idempotency-key": "read-1" } }),
    );
    expect(await read.text()).toBe("read");
    expect(calls).toBe(2);
  });

  test("refuses a key reused for a different body", async () => {
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

    application = await AponiaFactory.create(AppModule, { logger: false });
    await application.handle(send("/orders", { id: 1 }, "order-1"));
    const conflict = await application.handle(send("/orders", { id: 2 }, "order-1"));
    const body = (await conflict.json()) as { readonly status: number };

    expect(conflict.status).toBe(409);
    expect(body.status).toBe(409);
    expect(calls).toBe(1);
  });

  test("refuses a covered request without a key when the registration requires one", async () => {
    @Controller("orders")
    class OrdersController {
      @Post()
      create(@Body() body: { readonly id: number }): string {
        return `created:${body.id}`;
      }
    }

    @Module({
      imports: [IdempotencyModule.register({ requireKey: true })],
      controllers: [OrdersController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const refused = await application.handle(send("/orders", { id: 1 }));
    const accepted = await application.handle(send("/orders", { id: 1 }, "order-1"));

    expect(refused.status).toBe(400);
    expect(accepted.status).toBe(200);
  });

  test("shares one run between concurrent repeats", async () => {
    let calls = 0;
    let release: (() => void) | undefined;

    @Controller("orders")
    class OrdersController {
      @Post()
      async create(@Body() body: { readonly id: number }): Promise<string> {
        calls += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return `created:${body.id}`;
      }
    }

    @Module({ imports: [IdempotencyModule.register()], controllers: [OrdersController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const first = application.handle(send("/orders", { id: 1 }, "order-1"));
    while (calls === 0) {
      await Promise.resolve();
    }
    const second = application.handle(send("/orders", { id: 1 }, "order-1"));
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);

    release?.();
    expect(await (await first).text()).toBe("created:1");
    expect(await (await second).text()).toBe("created:1");
    expect(calls).toBe(1);
  });

  test("does not record a failure, so the next attempt runs again", async () => {
    let calls = 0;

    @Controller("orders")
    class OrdersController {
      @Post()
      create(): string {
        calls += 1;
        if (calls === 1) {
          throw new Error("origin failed");
        }
        return "created";
      }
    }

    @Module({ imports: [IdempotencyModule.register()], controllers: [OrdersController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const failed = await application.handle(send("/orders", { id: 1 }, "order-1"));
    const retried = await application.handle(send("/orders", { id: 1 }, "order-1"));

    expect(failed.status).toBe(500);
    expect(retried.status).toBe(200);
    expect(await retried.text()).toBe("created");
    expect(calls).toBe(2);
  });

  test("forgets a recorded answer after its lifetime", async () => {
    let now = 0;
    let calls = 0;

    @Controller("orders")
    class OrdersController {
      @Post()
      create(): string {
        calls += 1;
        return `created:${calls}`;
      }
    }

    @Module({
      imports: [IdempotencyModule.register({ ttlMs: 1_000, now: () => now })],
      controllers: [OrdersController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    expect(await (await application.handle(send("/orders", {}, "order-1"))).text()).toBe(
      "created:1",
    );
    now = 1_001;
    expect(await (await application.handle(send("/orders", {}, "order-1"))).text()).toBe(
      "created:2",
    );
  });

  test("does not record a Response the handler produced itself", async () => {
    let calls = 0;

    @Controller("orders")
    class OrdersController {
      @Post()
      create(): Response {
        calls += 1;
        return new Response(`created:${calls}`, { status: 200 });
      }
    }

    @Module({ imports: [IdempotencyModule.register()], controllers: [OrdersController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    await application.handle(send("/orders", {}, "order-1"));
    await application.handle(send("/orders", {}, "order-1"));

    expect(calls).toBe(2);
  });

  test("reports every invalid registration option", () => {
    const error = capture(() =>
      IdempotencyModule.register({
        ttlMs: 0,
        maxEntries: 0,
        header: " ",
        requireKey: "yes" as unknown as boolean,
        methods: [],
        now: "no" as unknown as () => number,
        onError: "no" as unknown as () => void,
        store: {} as unknown as IdempotencyStore,
      }),
    );

    expect(error.code).toBe("INVALID_IDEMPOTENCY_OPTIONS");
    expect(error.details).toEqual({
      issues: [
        "ttlMs must be a positive number",
        "maxEntries must be a positive integer",
        "header must be a non-empty string",
        "requireKey must be a boolean",
        "methods must be a non-empty array of strings",
        "now must be a function",
        "onError must be a function",
        "store is missing get, set, delete, clear",
      ],
    });
  });

  test("bounds the default store", () => {
    const store = new MemoryIdempotencyStore({ maxEntries: 1 });
    store.set("one", { status: 200, value: 1, fingerprint: "a" }, 1_000);
    store.set("two", { status: 200, value: 2, fingerprint: "b" }, 1_000);

    expect(store.get("one")).toBeUndefined();
    expect(store.get("two")?.value).toBe(2);
    expect(captureSync(() => new MemoryIdempotencyStore({ maxEntries: 0 })).code).toBe(
      "INVALID_IDEMPOTENCY_OPTIONS",
    );
  });

  test("deletes, clears, and prunes expired store entries", () => {
    let now = 0;
    const store = new MemoryIdempotencyStore({ now: () => now });
    store.set("one", { status: 200, value: 1, fingerprint: "a" }, 10);

    expect(store.delete("one")).toBe(true);
    expect(store.delete("one")).toBe(false);

    store.set("two", { status: 200, value: 2, fingerprint: "b" }, 10);
    store.clear();
    expect(store.get("two")).toBeUndefined();

    store.set("expired", { status: 200, value: 3, fingerprint: "c" }, 5);
    now = 100;
    store.set("fresh", { status: 200, value: 4, fingerprint: "d" }, 5);
    expect(store.get("expired")).toBeUndefined();
    expect(store.get("fresh")?.value).toBe(4);
  });

  test("fingerprints binary and absent bodies and skips a request without a key", async () => {
    @Controller("fingerprints")
    class FingerprintsController {
      @Post()
      create(@Body() body: unknown): string {
        return typeof body === "string" ? body : "binary";
      }

      @Get()
      read(): string {
        return "read";
      }
    }

    @Module({
      imports: [IdempotencyModule.register({ methods: ["POST", "GET"] })],
      controllers: [FingerprintsController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    expect((await application.handle(send("/fingerprints", { id: 1 }))).status).toBe(200);

    const binary = await application.handle(
      new Request("http://localhost/fingerprints", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "idempotency-key": "binary",
        },
        body: new Uint8Array([1, 2, 3]),
      }),
    );
    expect(await binary.text()).toBe("binary");

    const read = await application.handle(
      new Request("http://localhost/fingerprints", {
        headers: { "idempotency-key": "read" },
      }),
    );
    expect(await read.text()).toBe("read");
  });
});

function capture(run: () => unknown): AponiaError {
  return captureSync(run);
}

function captureSync(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}
