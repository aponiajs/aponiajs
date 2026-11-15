import { describe, expect, test } from "bun:test";
import { AponiaError, Injectable } from "@aponiajs/common";
import { EventEmitter, OnEvent, getEventHandlers } from "../src/index.ts";

describe("EventEmitter", () => {
  test("runs handlers in registration order and awaits each one", async () => {
    const events = new EventEmitter();
    const calls: string[] = [];

    events.on("work", () => {
      calls.push("first");
    });
    events.on("work", async () => {
      await Bun.sleep(1);
      calls.push("second");
    });
    events.on("work", () => {
      calls.push("third");
    });

    await events.emit("work", undefined);

    expect(calls).toEqual(["first", "second", "third"]);
  });

  test("runs a once handler once and removes it before invocation", async () => {
    const events = new EventEmitter();
    let calls = 0;

    events.once("work", () => {
      calls += 1;
      expect(events.listenerCount("work")).toBe(0);
    });

    await events.emit("work", undefined);
    await events.emit("work", undefined);

    expect(calls).toBe(1);
  });

  test("removes a handler through off and through its disposer", async () => {
    const events = new EventEmitter();
    const calls: string[] = [];
    const first = () => {
      calls.push("first");
    };
    const second = () => {
      calls.push("second");
    };
    const unsubscribe = events.on("work", first);
    events.on("work", second);

    expect(events.off("work", first)).toBe(true);
    expect(events.off("work", first)).toBe(false);
    unsubscribe();
    unsubscribe();
    await events.emit("work", undefined);

    expect(calls).toEqual(["second"]);
  });

  test("runs every handler and reports all failures after they finish", async () => {
    const events = new EventEmitter();
    const calls: string[] = [];
    events.on("work", () => {
      calls.push("first");
      throw new Error("first failed");
    });
    events.on("work", async () => {
      calls.push("second");
      throw new Error("second failed");
    });
    events.on("work", () => {
      calls.push("third");
    });

    const error = await captureAponiaError(() => events.emit("work", undefined));

    expect(calls).toEqual(["first", "second", "third"]);
    expect(error.code).toBe("EVENT_HANDLER_ERROR");
    expect(error.details).toEqual({
      event: "work",
      failures: ["first failed", "second failed"],
    });
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(Object.isFrozen((error.details as { failures: unknown }).failures)).toBe(true);
  });

  test("preserves null, false, and zero payloads", async () => {
    const events = new EventEmitter();
    const seen: unknown[] = [];
    events.on("value", (payload) => {
      seen.push(payload);
    });

    await events.emit("value", null);
    await events.emit("value", false);
    await events.emit("value", 0);

    expect(seen).toEqual([null, false, 0]);
  });

  test("binds decorated methods and unbinds them together", async () => {
    const events = new EventEmitter();
    const seen: string[] = [];

    @Injectable()
    class Listener {
      @OnEvent("first")
      first(value: string): void {
        seen.push(`first:${value}`);
      }

      @OnEvent("second")
      second(value: string): void {
        seen.push(`second:${value}`);
      }
    }

    const listener = new Listener();
    expect(getEventHandlers(listener)).toEqual([
      { event: "first", propertyKey: "first" },
      { event: "second", propertyKey: "second" },
    ]);

    const unbind = events.bind(listener);
    await events.emit("first", "a");
    await events.emit("second", "b");
    unbind();
    await events.emit("first", "c");

    expect(seen).toEqual(["first:a", "second:b"]);
  });

  test("refuses a decorated property that is not a method", () => {
    const events = new EventEmitter();

    class Broken {
      handler(): void {}
    }
    OnEvent("work")(
      Broken.prototype,
      "handler",
      Object.getOwnPropertyDescriptor(Broken.prototype, "handler")!,
    );
    const broken = new Broken();
    (broken as unknown as { handler: unknown }).handler = "not a function";

    expect(() => events.bind(broken)).toThrow(
      expect.objectContaining({ code: "EVENT_HANDLER_ERROR" }),
    );
  });
});

async function captureAponiaError(run: () => Promise<unknown>): Promise<AponiaError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}
