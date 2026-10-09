import { describe, expect, it } from "bun:test";
import { compileDirectMonomorphicInvoker } from "../src/routing/route-compiler.ts";

describe("Direct Monomorphic Invokers", () => {
  it("emits 0-argument function when no parameter decorators exist", () => {
    class HealthController {
      check() {
        return "ok";
      }
    }
    const instance = new HealthController();
    const invoker = compileDirectMonomorphicInvoker(instance, "check", [], true);

    expect(invoker.length).toBe(0); // 0 arguments! Sucrose skips context allocation
    expect(invoker()).toBe("ok");
  });

  it("emits 0-argument async function for asynchronous handlers without parameters", async () => {
    class AsyncHealthController {
      async check() {
        return "async-ok";
      }
    }
    const instance = new AsyncHealthController();
    const invoker = compileDirectMonomorphicInvoker(instance, "check", [], false);

    expect(invoker.length).toBe(0);
    expect(await invoker()).toBe("async-ok");
  });

  it("emits direct property accessor for parameters without generic spreading", () => {
    class UserController {
      getUser(id: string) {
        return { id };
      }
    }
    const instance = new UserController();
    const paramBindings = [{ index: 0, source: "params", key: "id" }];
    const invoker = compileDirectMonomorphicInvoker(
      instance,
      "getUser",
      paramBindings as any,
      true,
    );

    expect(invoker.length).toBe(1);
    expect(invoker({ params: { id: "u123" } })).toEqual({ id: "u123" });
  });

  it("emits direct property accessor for async single-param with key", async () => {
    class AsyncUserController {
      async getUser(id: string) {
        return { id, async: true };
      }
    }
    const instance = new AsyncUserController();
    const paramBindings = [{ index: 0, source: "params", key: "id" }];
    const invoker = compileDirectMonomorphicInvoker(
      instance,
      "getUser",
      paramBindings as any,
      false,
    );

    expect(invoker.length).toBe(1);
    expect(await invoker({ params: { id: "u456" } })).toEqual({ id: "u456", async: true });
  });

  it("emits single-source direct accessor without key for sync handler", () => {
    class BodyController {
      save(body: unknown) {
        return body;
      }
    }
    const instance = new BodyController();
    const paramBindings = [{ index: 0, source: "body" }];
    const invoker = compileDirectMonomorphicInvoker(instance, "save", paramBindings as any, true);

    expect(invoker.length).toBe(1);
    expect(invoker({ body: { name: "Alice" } })).toEqual({ name: "Alice" });
  });

  it("emits single-source direct accessor without key for async handler", async () => {
    class AsyncBodyController {
      async save(body: unknown) {
        return { saved: body };
      }
    }
    const instance = new AsyncBodyController();
    const paramBindings = [{ index: 0, source: "body" }];
    const invoker = compileDirectMonomorphicInvoker(instance, "save", paramBindings as any, false);

    expect(invoker.length).toBe(1);
    expect(await invoker({ body: { name: "Bob" } })).toEqual({ saved: { name: "Bob" } });
  });

  it("emits multi-param invoker for sync handler", () => {
    class MultiController {
      create(id: string, body: unknown, query: unknown) {
        return { id, body, query };
      }
    }
    const instance = new MultiController();
    const paramBindings = [
      { index: 0, source: "params", key: "id" },
      { index: 1, source: "body" },
      { index: 2, source: "query", key: "filter" },
    ];
    const invoker = compileDirectMonomorphicInvoker(instance, "create", paramBindings as any, true);

    expect(invoker.length).toBe(1);
    expect(
      invoker({
        params: { id: "1" },
        body: { name: "item" },
        query: { filter: "active" },
      }),
    ).toEqual({
      id: "1",
      body: { name: "item" },
      query: "active",
    });
  });

  it("emits multi-param invoker for async handler", async () => {
    class AsyncMultiController {
      async create(id: string, body: unknown) {
        return { id, body, async: true };
      }
    }
    const instance = new AsyncMultiController();
    const paramBindings = [
      { index: 0, source: "params", key: "id" },
      { index: 1, source: "body" },
    ];
    const invoker = compileDirectMonomorphicInvoker(
      instance,
      "create",
      paramBindings as any,
      false,
    );

    expect(invoker.length).toBe(1);
    expect(
      await invoker({
        params: { id: "2" },
        body: { title: "doc" },
      }),
    ).toEqual({
      id: "2",
      body: { title: "doc" },
      async: true,
    });
  });
});
