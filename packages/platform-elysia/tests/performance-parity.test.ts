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

    // Measure raw Elysia
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) {
      await rawApp.handle(req);
    }
    const rawTime = performance.now() - t0;

    // Measure AponiaJS
    const t1 = performance.now();
    for (let i = 0; i < 10000; i++) {
      await aponiaApp.handle(req);
    }
    const aponiaTime = performance.now() - t1;

    // Parity verification (Aponia throughput within 1.25x of raw time under test suite load)
    expect(aponiaTime).toBeLessThanOrEqual(rawTime * 1.25 + 5);
  });
});
