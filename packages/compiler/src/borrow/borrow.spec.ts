import { describe, expect, test } from "bun:test";
import {
  AsyncLocalStorageBorrowContext,
  AsyncRwLock,
  type DeepReadonly,
  RwCell,
} from "../index.ts";

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition did not become true");
}

async function expectRejection(promise: Promise<unknown>, expected: object): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toMatchObject(expected);
    return;
  }
  throw new Error("Expected the operation to reject.");
}

describe("RwCell", () => {
  test("many readers inspect a deep readonly view", () => {
    const cell = new RwCell({ count: 1, nested: { label: "x" } });
    const first = cell.read((state) => state.count);
    const second = cell.read((state) => state.nested.label);

    expect(first).toBe(1);
    expect(second).toBe("x");
    expect(cell.version).toBe(0);
  });

  test("a reader may nest a reader", () => {
    const cell = new RwCell({ count: 1 });

    expect(cell.read(() => cell.read((state) => state.count))).toBe(1);
  });

  test("a reader receives one proxy per nested value", () => {
    const cell = new RwCell({ nested: { value: 1 } });

    cell.read((state) => {
      expect(state.nested).toBe(state.nested);
    });
  });

  test("a write mutates through the exclusive view and bumps version", () => {
    const cell = new RwCell({ count: 0, items: [1] });

    const result = cell.write((state) => {
      state.count += 1;
      state.items.push(2);
      state.items[0] = 3;
      return state.count;
    });

    expect(result).toBe(1);
    expect(cell.version).toBe(1);
    expect(cell.read((state) => [...state.items])).toEqual([3, 2]);
  });

  test("a write through a read view throws READONLY_VIEW", () => {
    const cell = new RwCell({ count: 0, items: [1], nested: { value: 1 } });

    cell.read((state) => {
      expect(() => {
        (state as { count: number }).count = 1;
      }).toThrow(expect.objectContaining({ code: "READONLY_VIEW" }));
      expect(() => {
        (state.items as number[]).push(2);
      }).toThrow(expect.objectContaining({ code: "READONLY_VIEW" }));
      expect(() => {
        delete (state.nested as { value?: number }).value;
      }).toThrow(expect.objectContaining({ code: "READONLY_VIEW" }));
      expect(() => Object.defineProperty(state, "count", { value: 2 })).toThrow(
        expect.objectContaining({ code: "READONLY_VIEW" }),
      );
      expect(() => Object.setPrototypeOf(state, null)).toThrow(
        expect.objectContaining({ code: "READONLY_VIEW" }),
      );
    });
  });

  test("a captured read view is stale after release", () => {
    const cell = new RwCell({ nested: { value: 1 } });
    let captured!: DeepReadonly<{ nested: { value: number } }>;
    let nested!: DeepReadonly<{ value: number }>;

    cell.read((state) => {
      captured = state;
      nested = state.nested;
    });

    expect(() => captured.nested).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
    expect(() => nested.value).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
  });

  test("a captured exclusive view is stale after release", () => {
    const cell = new RwCell({ value: 1 });
    let captured!: { value: number };

    cell.write((state) => {
      captured = state;
    });

    expect(() => captured.value).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
    expect(() => {
      captured.value = 2;
    }).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
  });

  test("a write inside a read fails fast with conflict details", () => {
    const cell = new RwCell({ count: 0 }, { label: "counter" });

    cell.read(() => {
      expect(() => cell.write(() => undefined)).toThrow(
        expect.objectContaining({
          code: "BORROW_CONFLICT",
          details: expect.objectContaining({
            operation: "write",
            reason: "conflict",
            label: "counter",
            readers: 1,
            writer: false,
          }),
        }),
      );
    });
  });

  test("a read or write inside a write fails fast", () => {
    const cell = new RwCell({ count: 0 }, { label: "counter" });

    cell.write(() => {
      expect(() => cell.read(() => undefined)).toThrow(
        expect.objectContaining({ code: "BORROW_CONFLICT" }),
      );
      expect(() => cell.write(() => undefined)).toThrow(
        expect.objectContaining({ code: "BORROW_CONFLICT" }),
      );
    });
  });

  test("async readers run concurrently and an async writer conflicts", async () => {
    const cell = new RwCell({ count: 0 });
    const gate = deferred();
    const started: string[] = [];

    const first = cell.tryReadAsync(async () => {
      started.push("first");
      await gate.promise;
      return "first";
    });
    const second = cell.tryReadAsync(() => {
      started.push("second");
      return "second";
    });

    await waitFor(() => started.length === 2);
    expect(await second).toBe("second");
    await expectRejection(
      cell.tryWriteAsync(() => undefined),
      {
        code: "BORROW_CONFLICT",
      },
    );

    gate.resolve();
    expect(await first).toBe("first");
  });

  test("an async read conflicts with an async writer", async () => {
    const cell = new RwCell({ count: 0 });
    const gate = deferred();
    const writer = cell.tryWriteAsync(async (state) => {
      state.count = 1;
      await gate.promise;
    });

    await expectRejection(
      cell.tryReadAsync(() => 1),
      { code: "BORROW_CONFLICT" },
    );
    await expectRejection(
      cell.tryWriteAsync(() => 1),
      { code: "BORROW_CONFLICT" },
    );

    gate.resolve();
    await writer;
    expect(cell.version).toBe(1);
  });

  test("Map, Set, Date, and class instances pass by reference", () => {
    class Holder {
      #value = 1;
      get value(): number {
        return this.#value;
      }
    }
    const map = new Map([["a", 1]]);
    const set = new Set([1]);
    const date = new Date(0);
    const holder = new Holder();
    const cell = new RwCell({ map, set, date, holder });

    cell.read((state) => {
      expect(state.map).toBe(map);
      expect(state.set).toBe(set);
      expect(state.date).toBe(date);
      expect(state.holder).toBe(holder);
    });
    cell.write((state) => {
      expect(state.map).toBe(map);
      expect(state.holder).toBe(holder);
    });
  });
});

describe("AsyncRwLock", () => {
  test("readers run concurrently", async () => {
    const lock = new AsyncRwLock({ label: "shared" });
    const gate = deferred();
    const started: string[] = [];

    const first = lock.read(async () => {
      started.push("first");
      await gate.promise;
    });
    const second = lock.read(() => {
      started.push("second");
    });

    await waitFor(() => started.length === 2);
    expect(lock.queueDepth).toBe(0);
    gate.resolve();
    await Promise.all([first, second]);
  });

  test("a writer waits for readers and later readers wait behind the writer", async () => {
    const lock = new AsyncRwLock({ label: "ordered" });
    const gate = deferred();
    const order: string[] = [];

    const reader = lock.read(async () => {
      order.push("reader");
      await gate.promise;
    });
    await waitFor(() => order.includes("reader"));

    const writer = lock.write(() => {
      order.push("writer");
    });
    const later = lock.read(() => {
      order.push("later");
    });
    await waitFor(() => lock.queueDepth === 2);

    expect(order).toEqual(["reader"]);
    gate.resolve();
    await Promise.all([reader, writer, later]);
    expect(order).toEqual(["reader", "writer", "later"]);
  });

  test("a nested read inside a read is allowed", async () => {
    const lock = new AsyncRwLock();

    expect(await lock.read(async () => await lock.read(() => 42))).toBe(42);
  });

  test("a conflicting nested acquisition fails immediately as self-reentrant", async () => {
    const lock = new AsyncRwLock({ label: "reentrant" });

    await lock.read(async () => {
      await expectRejection(
        lock.write(() => undefined),
        {
          code: "BORROW_CONFLICT",
          details: expect.objectContaining({ reason: "self-reentrant", operation: "write" }),
        },
      );
    });

    await lock.write(async () => {
      await expectRejection(
        lock.read(() => undefined),
        {
          code: "BORROW_CONFLICT",
          details: expect.objectContaining({ reason: "self-reentrant", operation: "read" }),
        },
      );
      await expectRejection(
        lock.write(() => undefined),
        {
          code: "BORROW_CONFLICT",
          details: expect.objectContaining({ reason: "self-reentrant", operation: "write" }),
        },
      );
    });
  });

  test("a queued waiter times out with queue depth", async () => {
    const lock = new AsyncRwLock({ label: "timeout" });
    const gate = deferred();
    const writer = lock.write(async () => {
      await gate.promise;
    });
    await waitFor(() => lock.queueDepth === 0);

    await expectRejection(
      lock.read(() => undefined, { timeoutMs: 10 }),
      {
        code: "BORROW_CONFLICT",
        details: expect.objectContaining({ reason: "timeout", operation: "read" }),
      },
    );

    gate.resolve();
    await writer;
  });

  test("a pre-aborted acquisition refuses before queueing", async () => {
    const lock = new AsyncRwLock({ label: "abort" });
    const controller = new AbortController();
    controller.abort();

    await expectRejection(
      lock.write(() => undefined, { signal: controller.signal }),
      {
        code: "BORROW_CONFLICT",
        details: expect.objectContaining({ reason: "aborted", stage: "acquire" }),
      },
    );
  });

  test("an abort removes a queued waiter", async () => {
    const lock = new AsyncRwLock({ label: "abort-wait" });
    const gate = deferred();
    const writer = lock.write(async () => {
      await gate.promise;
    });
    await waitFor(() => lock.queueDepth === 0);

    const controller = new AbortController();
    const queued = lock.read(() => undefined, { signal: controller.signal });
    await waitFor(() => lock.queueDepth === 1);
    controller.abort();

    await expectRejection(queued, {
      code: "BORROW_CONFLICT",
      details: expect.objectContaining({ reason: "aborted", stage: "wait" }),
    });
    gate.resolve();
    await writer;
  });

  test("BorrowContext records and clears the current token", () => {
    const context = new AsyncLocalStorageBorrowContext();
    const token = { lock: Symbol("lock"), mode: "read" as const };

    expect(context.current()).toBeUndefined();
    expect(context.run(token, () => context.current())).toBe(token);
    expect(context.current()).toBeUndefined();
  });
});
