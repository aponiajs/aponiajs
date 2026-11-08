import { describe, expect, test } from "bun:test";
import { AponiaError, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  MemoryQueueStore,
  QueueModule,
  QueueService,
  type QueueJob,
  type QueueStore,
} from "../src/index.ts";

class TestStore implements QueueStore {
  readonly jobs = new Map<string, QueueJob>();
  readonly calls: string[] = [];
  failure: Error | undefined;

  async load(): Promise<readonly QueueJob[]> {
    this.calls.push("load");
    return [...this.jobs.values()];
  }

  async save(job: QueueJob): Promise<void> {
    this.calls.push(`save:${job.state}`);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    this.jobs.set(job.id, job);
  }

  async remove(id: string): Promise<void> {
    this.calls.push("remove");
    this.jobs.delete(id);
  }

  async clear(): Promise<void> {
    this.calls.push("clear");
    this.jobs.clear();
  }
}

function storedPending(overrides: Partial<QueueJob> = {}): QueueJob {
  return Object.freeze({
    id: "job-1",
    name: "restored",
    payload: { id: 1 },
    attempts: 1,
    maxAttempts: 3,
    priority: 0,
    timeoutMs: 0,
    state: "pending" as const,
    enqueuedAt: 1,
    availableAt: 1,
    idempotencyKey: "restored-key",
    ...overrides,
  });
}

describe("queue store", () => {
  test("records each state and forgets a completed job", async () => {
    const store = new TestStore();
    const queue = new QueueService({ autoStart: false, store });
    let runs = 0;
    queue.registerHandler("job", () => {
      runs += 1;
    });

    const job = queue.enqueue("job", 1);
    await queue.flush();
    expect(store.jobs.get(job.id)?.state).toBe("pending");

    await queue.drain();
    await queue.flush();

    expect(runs).toBe(1);
    expect(store.jobs.has(job.id)).toBe(false);
    expect(store.calls).toEqual(["save:pending", "remove"]);
  });

  test("records a retry and then a dead letter", async () => {
    const store = new TestStore();
    const queue = new QueueService({
      autoStart: false,
      store,
      maxAttempts: 1,
      backoffMs: 0,
    });
    queue.registerHandler("job", () => {
      throw new Error("failed");
    });

    const job = queue.enqueue("job", 1);
    await queue.drain();
    await queue.flush();

    expect(store.jobs.get(job.id)).toMatchObject({ state: "failed", attempts: 1 });

    queue.retryDeadLetter(job.id);
    await queue.flush();
    expect(store.jobs.get(job.id)?.state).toBe("pending");

    queue.clear();
    await queue.flush();
    expect(store.jobs.size).toBe(0);
    expect(store.calls).toContain("clear");
  });

  test("hydrates pending and dead-lettered jobs when the module initializes", async () => {
    const store = new TestStore();
    store.jobs.set("pending-1", storedPending({ id: "pending-1", name: "restored" }));
    store.jobs.set(
      "dead-1",
      storedPending({ id: "dead-1", name: "dead", state: "failed", lastError: "gone" }),
    );
    const queue = new QueueService({ autoStart: false, store, now: () => 100 });
    let runs = 0;
    queue.registerHandler("restored", () => {
      runs += 1;
    });

    await queue.onModuleInit();

    expect(queue.pending().map((job) => job.id)).toEqual(["pending-1"]);
    expect(queue.deadLetters().map((job) => job.id)).toEqual(["dead-1"]);
    expect(store.calls).toEqual(["load"]);

    await queue.drain();
    await queue.flush();

    expect(runs).toBe(1);
    expect(store.jobs.has("pending-1")).toBe(false);
    expect(store.jobs.has("dead-1")).toBe(true);
  });

  test("restores the idempotency key a stored job carried", async () => {
    const store = new TestStore();
    store.jobs.set("pending-1", storedPending({ id: "pending-1" }));
    const queue = new QueueService({ autoStart: false, store });
    queue.registerHandler("restored", () => {});
    await queue.onModuleInit();

    const duplicate = queue.enqueue("restored", null, { idempotencyKey: "restored-key" });

    expect(duplicate.id).toBe("pending-1");
    expect(queue.pending()).toHaveLength(1);
  });

  test("awaits an asynchronous store and surfaces its failure on flush", async () => {
    const store = new TestStore();
    const queue = new QueueService({ autoStart: false, store });
    queue.registerHandler("job", () => {});

    queue.enqueue("job", 1);
    await queue.flush();
    expect(store.jobs.size).toBe(1);

    store.failure = new Error("store down");
    queue.enqueue("job", 2);

    expect(queue.flush()).rejects.toThrow("store down");
    await queue.flush();
    expect(store.jobs.size).toBe(1);
  });

  test("refuses a store that does not implement its contract", () => {
    const missing = capture(() => new QueueService({ store: {} as unknown as QueueStore }));
    const blank = capture(() => new QueueService({ store: null as unknown as QueueStore }));

    expect(missing.code).toBe("INVALID_QUEUE_OPTIONS");
    expect(missing.details).toEqual({
      issues: ["store is missing load, save, remove, clear"],
    });
    expect(blank.details).toEqual({ issues: ["store must implement QueueStore"] });
  });

  test("flushes nothing when no store is registered", async () => {
    const queue = new QueueService({ autoStart: false });
    const pending = queue.flush();
    expect(await pending).toBeUndefined();
  });

  test("loads the backlog when an application boots", async () => {
    const store = new MemoryQueueStore();
    store.save(storedPending({ id: "boot-1", name: "boot" }));

    @Module({
      imports: [QueueModule.register({ queue: { store, autoStart: false } })],
    })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });
    try {
      expect(
        application
          .get(QueueService)
          .pending()
          .map((job) => job.id),
      ).toEqual(["boot-1"]);
    } finally {
      await application.close();
    }
  });

  test("bounds the default memory store", () => {
    const store = new MemoryQueueStore({ maxJobs: 1 });
    store.save(storedPending({ id: "one" }));
    store.save(storedPending({ id: "two" }));

    expect(store.load().map((job) => job.id)).toEqual(["two"]);
    expect(capture(() => new MemoryQueueStore({ maxJobs: 0 })).code).toBe("INVALID_QUEUE_OPTIONS");
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
