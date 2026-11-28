import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, test } from "bun:test";
import { registerAsyncContextExit, runOutsideAsyncContexts } from "../index.ts";

describe("async-context boundaries", () => {
  test("enters every registered boundary in order and returns the work result", () => {
    const order: string[] = [];
    const removeFirst = registerAsyncContextExit((work) => {
      order.push("first");
      return work();
    });
    const removeSecond = registerAsyncContextExit((work) => {
      order.push("second");
      return work();
    });

    try {
      expect(
        runOutsideAsyncContexts(() => {
          order.push("work");
          return 42;
        }),
      ).toBe(42);
      expect(order).toEqual(["first", "second", "work"]);
    } finally {
      removeFirst();
      removeSecond();
    }
  });

  test("leaves an AsyncLocalStorage store registered by a runtime", () => {
    const storage = new AsyncLocalStorage<string>();
    const remove = registerAsyncContextExit((work) => storage.exit(work));
    try {
      storage.run("tenant-a", () => {
        expect(runOutsideAsyncContexts(() => storage.getStore())).toBeUndefined();
      });
    } finally {
      remove();
    }
  });
});
