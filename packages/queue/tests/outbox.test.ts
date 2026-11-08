import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { OutboxService } from "../src/index.ts";

describe("OutboxService", () => {
  test("records frozen messages in order and flushes them", async () => {
    const outbox = new OutboxService({ now: () => 7 });
    const first = outbox.record("order.created", { id: 1 });
    outbox.record("order.paid", { id: 1 });

    expect(first.attempts).toBe(0);
    expect(first.recordedAt).toBe(7);
    expect(Object.isFrozen(first)).toBe(true);
    expect(outbox.pending().map((message) => message.name)).toEqual([
      "order.created",
      "order.paid",
    ]);

    const delivered: string[] = [];
    expect(
      await outbox.flush((message) => {
        delivered.push(message.name);
      }),
    ).toEqual({ delivered: 2, remaining: 0 });
    expect(delivered).toEqual(["order.created", "order.paid"]);
    expect(outbox.pending()).toEqual([]);
  });

  test("keeps a rejected message at the front for the next flush", async () => {
    const outbox = new OutboxService();
    outbox.record("first", 1);
    outbox.record("second", 2);
    let failing = true;

    const error = await reject(
      outbox.flush(() => {
        if (failing) {
          throw new Error("sink down");
        }
      }),
    );

    expect(error.code).toBe("OUTBOX_DELIVERY_FAILED");
    expect(error.details).toMatchObject({ attempts: 1, cause: "sink down" });
    const [remaining] = outbox.pending();
    expect(remaining?.name).toBe("first");
    expect(remaining?.attempts).toBe(1);
    expect(outbox.pending()).toHaveLength(2);

    failing = false;
    expect(await outbox.flush(() => {})).toEqual({ delivered: 2, remaining: 0 });
  });

  test("is bounded and evicts the oldest message", () => {
    const outbox = new OutboxService({ maxEntries: 1 });
    outbox.record("old", 1);
    outbox.record("new", 2);

    expect(outbox.pending().map((message) => message.name)).toEqual(["new"]);
  });

  test("refuses a nameless message, a non-function sink, and overlapping flushes", async () => {
    const outbox = new OutboxService();

    expect(capture(() => outbox.record("", 1)).code).toBe("INVALID_QUEUE_JOB");
    expect((await reject(outbox.flush("no" as unknown as () => void))).code).toBe(
      "INVALID_QUEUE_JOB",
    );

    outbox.record("message", 1);
    const overlapCodes: string[] = [];
    expect(
      await outbox.flush(async () => {
        overlapCodes.push((await reject(outbox.flush(() => {}))).code);
      }),
    ).toEqual({ delivered: 1, remaining: 0 });
    expect(overlapCodes).toEqual(["INVALID_QUEUE_JOB"]);
  });

  test("reports an invalid capacity and clears its messages", () => {
    expect(capture(() => new OutboxService({ maxEntries: 0 })).code).toBe("INVALID_QUEUE_OPTIONS");

    const outbox = new OutboxService();
    outbox.record("message", 1);
    outbox.clear();
    expect(outbox.pending()).toEqual([]);
  });
});

function capture(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}

async function reject(promise: Promise<unknown>): Promise<AponiaError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the promise to reject with an AponiaError.");
}
