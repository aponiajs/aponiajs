import { describe, expect, test } from "bun:test";
import { AponiaError, type AponiaMiddleware, type RouteContext } from "@aponiajs/common";
import { type AponiaContainer } from "@aponiajs/core";
import { Elysia } from "elysia";
import { mountMiddleware, resolveMiddleware } from "../src/middleware/middleware-pipeline.ts";

class DummyMiddleware implements AponiaMiddleware {
  async use(_ctx: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    return await next();
  }
}

class BadMiddlewareConstructor implements AponiaMiddleware {
  constructor() {
    throw new Error("bad constructor");
  }

  async use(_ctx: RouteContext, next: () => Promise<unknown>): Promise<unknown> {
    return await next();
  }
}

describe("middleware-pipeline", () => {
  test("resolves middleware from container when available", () => {
    const mwInstance = new DummyMiddleware();
    const mockContainer = {
      get: (token: unknown) => (token === DummyMiddleware ? mwInstance : undefined),
    } as unknown as AponiaContainer;

    expect(resolveMiddleware(DummyMiddleware, mockContainer)).toBe(mwInstance);
  });

  test("falls back to instantiation when container throws", () => {
    const mockContainer = {
      get: () => {
        throw new Error("not in container");
      },
    } as unknown as AponiaContainer;

    expect(resolveMiddleware(DummyMiddleware, mockContainer)).toBeInstanceOf(DummyMiddleware);
  });

  test("throws INVALID_MIDDLEWARE when constructor throws", () => {
    expect(() => resolveMiddleware(BadMiddlewareConstructor)).toThrow(AponiaError);
    try {
      resolveMiddleware(BadMiddlewareConstructor);
    } catch (error) {
      expect((error as AponiaError).code).toBe("INVALID_MIDDLEWARE");
    }
  });

  test("throws INVALID_MIDDLEWARE on non-middleware object", () => {
    expect(() => resolveMiddleware({} as never)).toThrow(AponiaError);
    expect(() => resolveMiddleware(null as never)).toThrow(AponiaError);
  });

  test("mountMiddleware does nothing when configs are empty", () => {
    const app = new Elysia();
    mountMiddleware(app, []);
    // No errors thrown
    expect(true).toBe(true);
  });
});
