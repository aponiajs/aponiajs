import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { LifetimeScope, Scoped, withLifetime } from "../index.ts";

describe("LifetimeScope", () => {
  test("tracks a value until the scope exits", () => {
    const scope = new LifetimeScope({ label: "request" });
    const handle = scope.track({ id: 7 });

    expect(handle).toBeInstanceOf(Scoped);
    expect(handle.get()).toEqual({ id: 7 });
    expect(handle.label).toBe("request");
    expect(handle.revoked).toBe(false);
    expect(scope.isOpen).toBe(true);
    expect(scope.exitReason).toBeUndefined();

    scope.exit("response");

    expect(scope.isOpen).toBe(false);
    expect(scope.exitReason).toBe("response");
    expect(() => handle.get()).toThrow(
      expect.objectContaining({
        code: "STALE_LIFETIME",
        details: expect.objectContaining({ label: "request" }),
      }),
    );
  });

  test("moveOut transfers the value and revokes the handle", () => {
    const scope = new LifetimeScope();
    const handle = scope.track({ id: 1 });

    expect(handle.moveOut()).toEqual({ id: 1 });
    expect(handle.revoked).toBe(true);
    expect(() => handle.get()).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
    expect(() => handle.moveOut()).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
  });

  test("release and dispose stop later reads", () => {
    const scope = new LifetimeScope({ label: "released" });
    const released = scope.track(1);
    released.release();
    expect(() => released.get()).toThrow(
      expect.objectContaining({
        code: "STALE_LIFETIME",
        details: expect.objectContaining({ reason: "released" }),
      }),
    );

    const disposed = scope.track(2);
    disposed[Symbol.dispose]();
    expect(() => disposed.get()).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));

    const asyncDisposed = scope.track(3);
    void asyncDisposed[Symbol.asyncDispose]();
    expect(() => asyncDisposed.get()).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
  });

  test("exit is idempotent and keeps the first reason", () => {
    const scope = new LifetimeScope({ label: "idempotent" });
    scope.exit("first");
    scope.exit("second");

    expect(scope.exitReason).toBe("first");
    expect(() => scope.track(1)).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
    expect(() => scope.assertOpen("read")).toThrow(
      expect.objectContaining({
        code: "STALE_LIFETIME",
        details: expect.objectContaining({ operation: "read" }),
      }),
    );
  });

  test("a child scope is revoked with its parent", () => {
    const parent = new LifetimeScope({ label: "parent" });
    const child = parent.createChild({ label: "child" });
    const handle = child.track("value");

    expect(child.parent).toBe(parent);
    expect(handle.get()).toBe("value");

    parent.exit("parent-ended");

    expect(child.isOpen).toBe(false);
    expect(child.exitReason).toBe("parent-ended");
    expect(() => handle.get()).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
    expect(() => parent.createChild()).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
  });

  test("withLifetime exits on success and on failure", async () => {
    let successHandle: Scoped<number> | undefined;
    const value = await withLifetime(
      (scope) => {
        successHandle = scope.track(41);
        return successHandle.get() + 1;
      },
      { label: "work" },
    );

    expect(value).toBe(42);
    expect(() => successHandle?.get()).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));

    let failure: unknown;
    try {
      await withLifetime(() => {
        throw new Error("boom");
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("boom");
  });
});

describe("LifetimeScope.guard", () => {
  class Counter {
    #count: number;

    constructor(count: number) {
      this.#count = count;
    }

    get value(): number {
      return this.#count;
    }

    increment(by: number): number {
      this.#count += by;
      return this.#count;
    }
  }

  test("binds methods and getters to the target, including #private access", () => {
    const scope = new LifetimeScope({ label: "guard" });
    const target = new Counter(1);
    const guarded = scope.guard(target);

    expect(guarded).toBeInstanceOf(Counter);
    expect(guarded).not.toBe(target);
    expect(guarded.value).toBe(1);
    expect(guarded.increment(2)).toBe(3);
    expect(target.value).toBe(3);
    expect("value" in guarded).toBe(true);
    expect(Object.keys(guarded)).toEqual(Object.keys(target));
    expect(Object.getOwnPropertyDescriptor(guarded, "value")).toEqual(
      Object.getOwnPropertyDescriptor(target, "value"),
    );
  });

  test("forwards set, delete, and define while the scope is open", () => {
    const scope = new LifetimeScope();
    const target: { name?: string } = { name: "before" };
    const guarded = scope.guard(target);

    guarded.name = "after";
    expect(target.name).toBe("after");

    delete guarded.name;
    expect("name" in target).toBe(false);

    Object.defineProperty(guarded, "name", {
      value: "defined",
      enumerable: true,
      configurable: true,
    });
    expect(target.name).toBe("defined");
  });

  test("refuses every trapped operation after exit", () => {
    const scope = new LifetimeScope({ label: "closed" });
    const guarded = scope.guard({
      value: 1,
      method(): number {
        return 1;
      },
    });
    scope.exit("done");

    expect(() => guarded.value).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
    expect(() => {
      guarded.value = 2;
    }).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
    expect(() => {
      Reflect.deleteProperty(guarded, "value");
    }).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
    expect(() => Object.defineProperty(guarded, "value", { value: 2 })).toThrow(
      expect.objectContaining({ code: "STALE_LIFETIME" }),
    );
    expect(() => "value" in guarded).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
    expect(() => Object.keys(guarded)).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
    expect(() => Object.getOwnPropertyDescriptor(guarded, "value")).toThrow(
      expect.objectContaining({ code: "STALE_LIFETIME" }),
    );
    expect(() => guarded.method()).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
  });

  test("does not preserve identity or guard nested values", () => {
    const scope = new LifetimeScope();
    const nested = { count: 0 };
    const target = { nested };
    const guarded = scope.guard(target);

    expect(guarded).not.toBe(target);
    expect(guarded.nested).toBe(nested);
    guarded.nested.count = 5;
    expect(nested.count).toBe(5);
  });

  test("returns an invariant method unwrapped so the proxy stays legal", () => {
    const scope = new LifetimeScope();
    const target = {} as { execute: () => number };
    const execute = (): number => 1;
    Object.defineProperty(target, "execute", {
      value: execute,
      configurable: false,
      writable: false,
    });
    const guarded = scope.guard(target);

    expect(guarded.execute).toBe(execute);
    expect(guarded.execute()).toBe(1);
  });

  test("refuses arrays and functions", () => {
    const scope = new LifetimeScope();
    expect(() => scope.guard([] as unknown as object)).toThrow(TypeError);
    expect(() => scope.guard((() => 1) as unknown as object)).toThrow(TypeError);
  });

  test("reports a frozen structured failure", () => {
    const scope = new LifetimeScope({ label: "frozen" });
    scope.exit("closed");
    try {
      scope.assertOpen("read");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(AponiaError);
      const aponia = error as AponiaError;
      expect(aponia.code).toBe("STALE_LIFETIME");
      expect(aponia.details).toEqual({ label: "frozen", operation: "read", reason: "closed" });
      expect(Object.isFrozen(aponia.details)).toBe(true);
    }
  });
});
