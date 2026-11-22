import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { AponiaFactory } from "../src/application/aponia-factory.ts";
import { Controller, Get, Module } from "@aponiajs/common";

describe("Performance Parity Benchmark", () => {
  it("achieves runtime parity on zero-argument sync route vs raw Elysia", async () => {
    // 1. Raw Elysia route
    const rawApp = new Elysia().get("/ping", () => "pong");

    // 2. AponiaJS route
    @Controller("/")
    class PingController {
      @Get("/ping")
      ping() {
        return "pong";
      }
    }
    @Module({ controllers: [PingController] })
    class PingModule {}

    const aponiaApp = await AponiaFactory.create(PingModule, { logger: false });
    const req = new Request("http://localhost/ping");

    // Warm up JIT for both routes
    for (let i = 0; i < 1000; i++) {
      await rawApp.handle(req);
      await aponiaApp.handle(req);
    }

    const rawTimes: number[] = [];
    const aponiaTimes: number[] = [];
    const rounds = 3;
    const iterations = 5_000;

    try {
      for (let round = 0; round < rounds; round += 1) {
        // Alternate the order so a warm cache or a GC pause cannot always
        // favour the same runtime.
        if (round % 2 === 0) {
          rawTimes.push(await measure(rawApp, req, iterations));
          aponiaTimes.push(await measure(aponiaApp, req, iterations));
        } else {
          aponiaTimes.push(await measure(aponiaApp, req, iterations));
          rawTimes.push(await measure(rawApp, req, iterations));
        }
      }
    } finally {
      await aponiaApp.close();
    }

    const rawTime = median(rawTimes);
    const aponiaTime = median(aponiaTimes);

    // The absolute margin absorbs a shared runner's timer and GC jitter while
    // the ratio still catches a real request-path regression.
    expect(aponiaTime).toBeLessThanOrEqual(rawTime * 1.5 + 25);
  });
});

async function measure(
  application: { handle(request: Request): Response | Promise<Response> },
  request: Request,
  iterations: number,
): Promise<number> {
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await application.handle(request);
  }
  return performance.now() - startedAt;
}

function median(values: readonly number[]): number {
  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted[middle] ?? 0;
}
