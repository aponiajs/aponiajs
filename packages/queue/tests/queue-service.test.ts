import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { QueueService } from "../src/index.ts";

describe("QueueService", () => {
  test("enqueues a frozen job and runs its handler on drain", async () => {
    const queue = new QueueService({ autoStart: false });
    const seen: unknown[] = [];
    queue.registerHandler("email.send", (payload, job) => {
      seen.push(payload, job.state, Object.isFrozen(job));
    });

    const job = queue.enqueue("email.send", { to: "ada@example.com" });

    expect(job.state).toBe("pending");
    expect(job.attempts).toBe(0);
    expect(Object.isFrozen(job)).toBe(true);
    expect(queue.stats()).toEqual({ pending: 1, running: 0, deadLettered: 0 });

    expect(await queue.drain()).toEqual({ completed: 1, retried: 0, deadLettered: 0, skipped: 0 });
    expect(seen).toEqual([{ to: "ada@example.com" }, "running", true]);
    expect(queue.pending()).toEqual([]);
  });

  test("retries a failed attempt after its backoff and then completes", async () => {
    let now = 1_000;
    const queue = new QueueService({ autoStart: false, backoffMs: 100, now: () => now });
    let attempts = 0;
    queue.registerHandler("flaky", () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("transient");
      }
    });

    queue.enqueue("flaky", null);
    expect(await queue.drain()).toMatchObject({ completed: 0, retried: 1 });

    const [pending] = queue.pending();
    expect(pending?.attempts).toBe(1);
    expect(pending?.availableAt).toBe(1_100);
    expect(pending?.lastError).toBe("transient");

    expect(await queue.drain()).toMatchObject({ completed: 0, retried: 0 });
    now += 100;
    expect(await queue.drain()).toMatchObject({ completed: 1 });
    expect(queue.pending()).toEqual([]);
  });

  test("doubles the delay and caps it", async () => {
    let now = 0;
    const queue = new QueueService({
      autoStart: false,
      backoffMs: 100,
      maxBackoffMs: 150,
      maxAttempts: 4,
      now: () => now,
    });
    queue.registerHandler("down", () => {
      throw new Error("down");
    });
    queue.enqueue("down", null);

    const delays: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const before = now;
      await queue.drain();
      const [pending] = queue.pending();
      const next = pending?.availableAt ?? before;
      delays.push(next - before);
      now = next;
    }

    expect(delays).toEqual([100, 150, 150]);
  });

  test("moves an exhausted job to the dead letters and revives it", async () => {
    let now = 0;
    const errors: string[] = [];
    const queue = new QueueService({
      autoStart: false,
      maxAttempts: 2,
      backoffMs: 10,
      now: () => now,
      onError: (error) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
    });
    let shouldFail = true;
    queue.registerHandler("job", () => {
      if (shouldFail) {
        throw new Error("boom");
      }
    });
    const job = queue.enqueue("job", 1);

    for (let round = 0; round < 2; round += 1) {
      await queue.drain();
      now += 10;
    }

    const [dead] = queue.deadLetters();
    expect(dead?.state).toBe("failed");
    expect(dead?.attempts).toBe(2);
    expect(dead?.lastError).toBe("boom");
    expect(errors).toEqual(["boom", "boom"]);
    expect(queue.stats()).toEqual({ pending: 0, running: 0, deadLettered: 1 });

    expect(queue.retryDeadLetter(job.id)).toMatchObject({ state: "pending", attempts: 0 });
    shouldFail = false;
    expect(await queue.drain()).toMatchObject({ completed: 1 });
    expect(queue.deadLetters()).toEqual([]);
  });

  test("dead-letters a job whose handler is missing", async () => {
    const queue = new QueueService({ autoStart: false, maxAttempts: 1 });
    const codes: string[] = [];
    queue.enqueue("nobody", null);

    const options = new QueueService({
      autoStart: false,
      maxAttempts: 1,
      onError: (error) => {
        codes.push(error instanceof AponiaError ? error.code : "not-aponia");
      },
    });
    options.enqueue("nobody", null);

    expect(await queue.drain()).toMatchObject({ deadLettered: 1 });
    expect(await options.drain()).toMatchObject({ deadLettered: 1 });
    expect(queue.deadLetters()[0]?.lastError).toContain("No queue handler is registered");
    expect(codes).toEqual(["QUEUE_HANDLER_MISSING"]);
  });

  test("deduplicates an idempotency key until the job completes", async () => {
    let now = 0;
    const queue = new QueueService({
      autoStart: false,
      maxAttempts: 1,
      now: () => now,
    });
    queue.registerHandler("once", () => {});

    const first = queue.enqueue("once", null, { idempotencyKey: "key-1" });
    const duplicate = queue.enqueue("once", null, { idempotencyKey: "key-1" });

    expect(duplicate.id).toBe(first.id);
    expect(queue.pending()).toHaveLength(1);

    await queue.drain();
    now = 1;
    const after = queue.enqueue("once", null, { idempotencyKey: "key-1" });
    expect(after.id).not.toBe(first.id);
  });

  test("keeps a dead letter's idempotency key", async () => {
    const queue = new QueueService({ autoStart: false, maxAttempts: 1 });
    queue.registerHandler("fails", () => {
      throw new Error("nope");
    });
    const job = queue.enqueue("fails", null, { idempotencyKey: "dead-key" });
    await queue.drain();

    const duplicate = queue.enqueue("fails", null, { idempotencyKey: "dead-key" });

    expect(duplicate.id).toBe(job.id);
    expect(duplicate.state).toBe("failed");
    expect(queue.pending()).toEqual([]);
  });

  test("refuses to enqueue past its capacity", () => {
    const queue = new QueueService({ autoStart: false, maxJobs: 1 });
    queue.enqueue("job", 1);

    const error = capture(() => queue.enqueue("job", 2));

    expect(error.code).toBe("QUEUE_CAPACITY_EXCEEDED");
    expect(error.details).toEqual({ maxJobs: 1 });
  });

  test("runs up to the configured concurrency", async () => {
    const queue = new QueueService({ autoStart: false, concurrency: 2 });
    let active = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    queue.registerHandler("slow", async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active -= 1;
    });
    queue.enqueue("slow", 1);
    queue.enqueue("slow", 2);

    const drained = queue.drain();
    await Bun.sleep(0);
    expect(release).toHaveLength(2);
    for (const resolve of release) {
      resolve();
    }
    await drained;

    expect(peak).toBe(2);
  });

  test("reports every invalid registration option in one refusal", () => {
    const error = capture(
      () =>
        new QueueService({
          concurrency: 0,
          maxAttempts: 0,
          backoffMs: -1,
          maxBackoffMs: -1,
          maxJobs: 0,
          autoStart: "yes" as unknown as boolean,
          onError: "no" as unknown as () => void,
          now: "no" as unknown as () => number,
        }),
    );

    expect(error.code).toBe("INVALID_QUEUE_OPTIONS");
    expect(error.details).toEqual({
      issues: [
        "concurrency must be a positive integer",
        "maxAttempts must be a positive integer",
        "backoffMs must be a non-negative finite number",
        "maxBackoffMs must be a non-negative finite number",
        "maxJobs must be a positive integer",
        "autoStart must be a boolean",
        "onError must be a function",
        "now must be a function",
      ],
    });
  });

  test("refuses job misuse", () => {
    const queue = new QueueService({ autoStart: false });

    expect(capture(() => queue.enqueue("", 1)).code).toBe("INVALID_QUEUE_JOB");
    expect(capture(() => queue.enqueue("job", 1, { maxAttempts: 0 })).code).toBe(
      "INVALID_QUEUE_JOB",
    );
    expect(capture(() => queue.enqueue("job", 1, { availableAt: Number.NaN })).code).toBe(
      "INVALID_QUEUE_JOB",
    );
    expect(capture(() => queue.enqueue("job", 1, { idempotencyKey: " " })).code).toBe(
      "INVALID_QUEUE_JOB",
    );
    expect(capture(() => queue.registerHandler("job", null as unknown as () => void)).code).toBe(
      "INVALID_QUEUE_JOB",
    );
    expect(capture(() => queue.registerHandler("", () => {})).code).toBe("INVALID_QUEUE_JOB");
    expect(capture(() => queue.retryDeadLetter("missing")).code).toBe("INVALID_QUEUE_JOB");
  });

  test("defers a job until its availableAt", async () => {
    let now = 0;
    const queue = new QueueService({ autoStart: false, now: () => now });
    queue.registerHandler("later", () => {});
    queue.enqueue("later", null, { availableAt: 50 });

    expect(await queue.drain()).toMatchObject({ completed: 0 });
    expect(queue.pending()).toHaveLength(1);

    now = 50;
    expect(await queue.drain()).toMatchObject({ completed: 1 });
  });

  test("schedules a background drain and resolves waitForIdle", async () => {
    const clock = fakeTimer();
    const queue = new QueueService({ timer: clock.timer });
    queue.registerHandler("quick", () => {});

    queue.enqueue("quick", null);
    expect(clock.scheduled).toHaveLength(1);
    expect(clock.scheduled[0]?.delay).toBe(0);

    clock.fire();
    await queue.waitForIdle();

    expect(queue.pending()).toEqual([]);
    expect(clock.scheduled).toHaveLength(0);
  });

  test("reschedules when a sooner job arrives", () => {
    let now = 0;
    const clock = fakeTimer();
    const queue = new QueueService({ timer: clock.timer, now: () => now, maxAttempts: 1 });
    queue.enqueue("job", null, { availableAt: 1_000 });
    expect(clock.scheduled[0]?.delay).toBe(1_000);

    queue.enqueue("job", null, { availableAt: 5 });

    expect(clock.cleared).toBe(1);
    expect(clock.scheduled[0]?.delay).toBe(5);
    now = 5;
  });

  test("pause cancels background work and resume schedules it again", () => {
    const clock = fakeTimer();
    const queue = new QueueService({ timer: clock.timer, now: () => 0 });
    queue.enqueue("job", null, { availableAt: 100 });
    expect(clock.scheduled).toHaveLength(1);

    queue.pause();
    expect(queue.paused).toBe(true);
    expect(clock.scheduled).toHaveLength(0);
    expect(clock.cleared).toBe(1);

    queue.enqueue("job", null, { availableAt: 50 });
    expect(clock.scheduled).toHaveLength(0);

    queue.resume();
    expect(queue.paused).toBe(false);
    expect(clock.scheduled).toHaveLength(1);
    expect(clock.scheduled[0]?.delay).toBe(50);
    queue.close();
  });

  test("close stops scheduling, cancels a timer, and refuses later work", async () => {
    const clock = fakeTimer();
    const queue = new QueueService({ timer: clock.timer, now: () => 0 });
    queue.registerHandler("job", () => {});
    queue.enqueue("job", null, { availableAt: 100 });

    const idle = queue.waitForIdle();
    queue.close();
    await idle;

    expect(clock.scheduled).toHaveLength(0);
    expect(capture(() => queue.enqueue("job", null)).code).toBe("INVALID_QUEUE_JOB");
    expect(capture(() => queue.registerHandler("job", () => {})).code).toBe("INVALID_QUEUE_JOB");
    expect(await queue.drain()).toEqual({ completed: 0, retried: 0, deadLettered: 0, skipped: 0 });
  });

  test("runs a higher priority before an earlier lower one", async () => {
    const queue = new QueueService({ autoStart: false });
    const order: string[] = [];
    queue.registerHandler<string>("job", (payload) => {
      order.push(payload);
    });

    queue.enqueue("job", "low", { priority: 1 });
    queue.enqueue("job", "high", { priority: 5 });
    await queue.drain();

    expect(order).toEqual(["high", "low"]);
    expect(queue.pending()).toEqual([]);
  });

  test("refuses a priority that is not a safe integer", () => {
    const queue = new QueueService({ autoStart: false });
    expect(capture(() => queue.enqueue("job", null, { priority: 1.5 })).code).toBe(
      "INVALID_QUEUE_JOB",
    );
  });

  test("fails an attempt that exceeds its timeout and clears a winning timer", async () => {
    const clock = fakeTimer();
    const queue = new QueueService({
      autoStart: false,
      jobTimeoutMs: 50,
      maxAttempts: 1,
      timer: clock.timer,
    });
    let started = false;
    queue.registerHandler("slow", () => {
      started = true;
      return new Promise<string>(() => {});
    });
    queue.registerHandler("fast", () => "ok");

    const slow = queue.enqueue("slow", null);
    const drained = queue.drain();
    while (!started) {
      await Promise.resolve();
    }
    expect(clock.scheduled).toHaveLength(1);
    clock.fire();
    expect(await drained).toMatchObject({ deadLettered: 1 });
    expect(queue.deadLetters()[0]?.lastError).toContain("exceeded its timeout");
    expect(slow.id).toBeDefined();

    const completed = queue.enqueue("fast", null, { timeoutMs: 100 });
    expect(await queue.drain()).toMatchObject({ completed: 1 });
    expect(queue.pending()).toEqual([]);
    expect(completed.attempts).toBe(0);
    expect(clock.cleared).toBeGreaterThan(0);
    expect(capture(() => queue.enqueue("fast", null, { timeoutMs: -1 })).code).toBe(
      "INVALID_QUEUE_JOB",
    );
  });

  test("clear drops pending jobs and dead letters", async () => {
    const queue = new QueueService({ autoStart: false, maxAttempts: 1 });
    queue.registerHandler("ok", () => {});
    queue.registerHandler("bad", () => {
      throw new Error("bad");
    });
    queue.enqueue("ok", 1);
    queue.enqueue("bad", 2);
    await queue.drain();

    queue.clear();

    expect(queue.pending()).toEqual([]);
    expect(queue.deadLetters()).toEqual([]);
    expect(queue.stats()).toEqual({ pending: 0, running: 0, deadLettered: 0 });
  });
});

function fakeTimer() {
  const scheduled: { readonly handler: () => void; readonly delay: number }[] = [];
  let cleared = 0;
  return {
    timer: {
      setTimeout(handler: () => void, delay: number): number {
        scheduled.push({ handler, delay });
        return scheduled.length;
      },
      clearTimeout(): void {
        cleared += 1;
        scheduled.shift();
      },
    },
    get scheduled(): readonly { readonly handler: () => void; readonly delay: number }[] {
      return scheduled;
    },
    get cleared(): number {
      return cleared;
    },
    fire(): void {
      scheduled.shift()?.handler();
    },
  };
}

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
