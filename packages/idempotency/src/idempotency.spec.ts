import { describe, expect, it } from "bun:test";
import { Body, Controller, Get, Module, Post } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { IdempotencyModule, MemoryIdempotencyStore, type IdempotencyStore } from "./index.ts";

describe("IdempotencyModule", () => {
  it("replays identical POST requests, rejects payload mismatches (422), and ignores GET", async () => {
    let executions = 0;

    @Controller("payments")
    class PaymentsController {
      @Get()
      list(): { readonly count: number } {
        return { count: executions };
      }

      @Post()
      create(@Body() body: { readonly amount: number }): {
        readonly id: number;
        readonly amount: number;
      } {
        executions += 1;
        return { id: executions, amount: body.amount };
      }
    }

    @Module({
      imports: [IdempotencyModule.forRoot()],
      controllers: [PaymentsController],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const getRes = await app.handle(new Request("http://localhost/payments"));
      expect(getRes.status).toBe(200);

      const unkeyedPost = await app.handle(
        new Request("http://localhost/payments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amount: 50 }),
        }),
      );
      expect(unkeyedPost.status).toBe(200);
      expect(executions).toBe(1);

      const first = await app.handle(
        new Request("http://localhost/payments", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "key-1" },
          body: JSON.stringify({ amount: 100 }),
        }),
      );
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ id: 2, amount: 100 });
      expect(first.headers.get("idempotent-replayed")).toBeNull();

      const replay = await app.handle(
        new Request("http://localhost/payments", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "key-1" },
          body: JSON.stringify({ amount: 100 }),
        }),
      );
      expect(replay.status).toBe(200);
      expect(replay.headers.get("idempotent-replayed")).toBe("true");
      expect(await replay.json()).toEqual({ id: 2, amount: 100 });
      expect(executions).toBe(2);

      const mismatch = await app.handle(
        new Request("http://localhost/payments", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "key-1" },
          body: JSON.stringify({ amount: 999 }),
        }),
      );
      expect(mismatch.status).toBe(422);
    } finally {
      await app.close();
    }
  });

  it("returns 409 for in-flight conflict, 503 on store error, and 400 when requireKey is true", async () => {
    const failingStore: IdempotencyStore = {
      acquire() {
        throw new Error("redis down");
      },
      complete() {},
      release() {},
    };

    @Controller("orders")
    class OrdersController {
      @Post()
      create(): { readonly ok: boolean } {
        return { ok: true };
      }
    }

    @Module({
      imports: [
        IdempotencyModule.forRoot({
          requireKey: true,
          store: failingStore,
        }),
      ],
      controllers: [OrdersController],
    })
    class FailModule {}

    const failApp = await AponiaFactory.create(FailModule, { logger: false });
    try {
      const missingKey = await failApp.handle(
        new Request("http://localhost/orders", { method: "POST" }),
      );
      expect(missingKey.status).toBe(400);

      const storeDown = await failApp.handle(
        new Request("http://localhost/orders", {
          method: "POST",
          headers: { "idempotency-key": "k-1" },
        }),
      );
      expect(storeDown.status).toBe(503);
    } finally {
      await failApp.close();
    }

    let clock = 1_000;
    const store = new MemoryIdempotencyStore(2, () => clock);
    expect(store.acquire("a", 100, "h1")).toEqual({ state: "acquired" });
    expect(store.acquire("a", 100, "h1")).toEqual({ state: "in_flight" });
    store.acquire("b", 100, "h2");
    store.acquire("c", 100, "h3"); // evicts "a"
    clock += 200;
    expect(store.acquire("b", 100, "h2")).toEqual({ state: "acquired" }); // expired "b"
    store.release("b");
    store.clear();
  });

  it("validates options and supports forRootAsync", async () => {
    expect(() => IdempotencyModule.forRoot({ headerName: "  " })).toThrow();
    expect(() => IdempotencyModule.forRoot({ ttlMs: 0 })).toThrow();
    expect(() => IdempotencyModule.forRoot({ maxKeys: 0 })).toThrow();

    @Controller("async")
    class AsyncController {
      @Post()
      create(): { readonly ok: boolean } {
        return { ok: true };
      }
    }

    @Module({
      imports: [
        IdempotencyModule.forRootAsync({
          useFactory: async () => ({ ttlMs: 5_000 }),
        }),
      ],
      controllers: [AsyncController],
    })
    class AsyncModule {}

    const app = await AponiaFactory.create(AsyncModule, { logger: false });
    try {
      const res = await app.handle(
        new Request("http://localhost/async", {
          method: "POST",
          headers: { "idempotency-key": "async-1" },
        }),
      );
      expect(res.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("handles in-flight 409, 500 handler failure release, and complete/release store errors", async () => {
    let released = 0;
    const store: IdempotencyStore = {
      acquire(key) {
        if (key.endsWith("inflight")) return { state: "in_flight" };
        return { state: "acquired" };
      },
      complete(key) {
        if (key.endsWith("fail-complete")) throw new Error("complete failed");
      },
      release(key) {
        released += 1;
        if (key.endsWith("fail-release")) throw new Error("release failed");
      },
    };

    @Controller("edges")
    class EdgesController {
      @Post("ok")
      ok(): { readonly ok: boolean } {
        return { ok: true };
      }
      @Post("fail-release")
      fail(): never {
        throw new Error("handler boom");
      }
    }

    @Module({
      imports: [IdempotencyModule.forRoot({ store })],
      controllers: [EdgesController],
    })
    class EdgesModule {}

    const app = await AponiaFactory.create(EdgesModule, { logger: false });
    try {
      const conflict = await app.handle(
        new Request("http://localhost/edges/ok", {
          method: "POST",
          headers: { "idempotency-key": "inflight" },
        }),
      );
      expect(conflict.status).toBe(409);

      const failComplete = await app.handle(
        new Request("http://localhost/edges/ok", {
          method: "POST",
          headers: { "idempotency-key": "fail-complete" },
        }),
      );
      expect(failComplete.status).toBe(503);

      const failRelease = await app.handle(
        new Request("http://localhost/edges/fail-release", {
          method: "POST",
          headers: { "idempotency-key": "fail-release" },
        }),
      );
      expect(failRelease.status).toBe(500);
      expect(released).toBe(1);
    } finally {
      await app.close();
    }
  });
});
