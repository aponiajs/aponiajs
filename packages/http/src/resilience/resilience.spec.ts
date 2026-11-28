import { describe, expect, it } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { BulkheadLimiter, HttpService, OriginCircuitBreaker } from "../index.ts";

describe("HTTP Resilience: Circuit Breaker & Bulkhead", () => {
  it("transitions OriginCircuitBreaker through closed -> open -> half-open -> closed", () => {
    let clock = 1_000;
    const breaker = new OriginCircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 5_000,
      halfOpenMaxCalls: 1,
      failureStatuses: [500, 503],
      now: () => clock,
    });

    const origin = "https://api.example.com";
    expect(breaker.getState(origin)).toBe("closed");
    breaker.acquire(origin);
    breaker.recordSuccess(origin);
    expect(breaker.isFailureStatus(503)).toBe(true);
    expect(breaker.isFailureStatus(404)).toBe(false);

    breaker.recordFailure(origin);
    expect(breaker.getState(origin)).toBe("closed");
    breaker.recordFailure(origin);
    expect(breaker.getState(origin)).toBe("open");

    expect(() => breaker.acquire(origin)).toThrow(AponiaError);

    clock += 5_000;
    expect(breaker.getState(origin)).toBe("half-open");
    breaker.acquire(origin); // 1st probe allowed
    expect(() => breaker.acquire(origin)).toThrow(AponiaError); // halfOpenMaxCalls=1 saturated

    breaker.recordFailure(origin); // re-opens on probe failure
    expect(breaker.getState(origin)).toBe("open");

    clock += 5_000;
    breaker.acquire(origin);
    breaker.recordSuccess(origin);
    expect(breaker.getState(origin)).toBe("closed");
  });

  it("enforces BulkheadLimiter concurrency, queue, timeout, and release", async () => {
    const bulkhead = new BulkheadLimiter({
      maxConcurrent: 1,
      maxQueue: 1,
      queueTimeoutMs: 50,
    });

    const release1 = await bulkhead.acquire();
    const queuedPromise = bulkhead.acquire();
    // 3rd request exceeds maxQueue=1
    await expect(bulkhead.acquire()).rejects.toThrow(AponiaError);

    // Wait for queuedPromise to time out
    await expect(queuedPromise).rejects.toThrow(AponiaError);

    release1();
    release1(); // idempotent release

    const release2 = await bulkhead.acquire();
    const queuedSuccess = bulkhead.acquire();
    release2();
    const release3 = await queuedSuccess;
    release3();
  });

  it("integrates circuitBreaker and bulkhead into HttpService", async () => {
    let calls = 0;
    let clock = 1_000;
    const service = new HttpService({
      baseUrl: "https://example.com",
      headers: {},
      timeoutMs: 5_000,
      retries: 0,
      retryDelayMs: 10,
      maxResponseBytes: 1024 * 1024,
      maxRedirects: 3,
      allowPrivateNetworks: true,
      pinResolvedAddress: false,
      resolveAddresses: async () => ["93.184.216.34"],
      fetch: (async () => {
        calls += 1;
        if (calls <= 2) {
          return new Response("err", { status: 503 });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
      circuitBreaker: {
        failureThreshold: 2,
        resetTimeoutMs: 5_000,
        now: () => clock,
      },
      bulkhead: {
        maxConcurrent: 2,
        maxQueue: 0,
      },
    });

    await expect(service.get("/a")).rejects.toThrow();
    await expect(service.get("/a")).rejects.toThrow();
    // Circuit is now open — 3rd call fails fast without calling fetch
    await expect(service.get("/a")).rejects.toThrow("Circuit breaker is open");
    expect(calls).toBe(2);

    clock += 5_000;
    const res = await service.get<{ ok: boolean }>("/a");
    expect(res.data).toEqual({ ok: true });
  });
});
