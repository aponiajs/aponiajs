import { afterEach, describe, expect, test } from "bun:test";
import { AponiaError, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { OutboxService, QueueModule, QueueService } from "./index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("QueueModule", () => {
  test("provides the queue and outbox an application declared", async () => {
    @Module({ imports: [QueueModule.register({ queue: { concurrency: 2 } })] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const queue = application.get(QueueService);
    const outbox = application.get(OutboxService);
    const seen: unknown[] = [];
    queue.registerHandler("greet", (payload) => {
      seen.push(payload);
    });

    queue.enqueue("greet", { name: "ada" });
    await queue.waitForIdle();

    expect(seen).toEqual([{ name: "ada" }]);
    expect(outbox.record("greeted", 1).name).toBe("greeted");
  });

  test("stops background work when the application closes", async () => {
    @Module({ imports: [QueueModule.register({ queue: { autoStart: false } })] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const queue = application.get(QueueService);
    await application.close();
    application = undefined;

    expect(() => queue.enqueue("late", null)).toThrow("queue is closed");
  });

  test("refuses two registrations that both export the same tokens", async () => {
    @Module({
      imports: [QueueModule.register(), QueueModule.register()],
      controllers: [],
    })
    class AppModule {}

    const created = await AponiaFactory.create(AppModule, { logger: false });
    application = created;

    expect(capture(() => created.get(QueueService)).code).toBe("AMBIGUOUS_PROVIDER");
  });

  test("reports every malformed queue, outbox, and extra option it refuses", () => {
    const cases: readonly [string, () => unknown][] = [
      ["options must be an object", () => QueueModule.forRoot(null as never)],
      ["queue must be an object when present", () => QueueModule.forRoot({ queue: "x" as never })],
      [
        "concurrency must be a positive integer",
        () => QueueModule.forRoot({ queue: { concurrency: 0 } }),
      ],
      [
        "backoffMs must be a non-negative finite number",
        () => QueueModule.forRoot({ queue: { backoffMs: -1 } }),
      ],
      [
        "jobTimeoutMs must be a non-negative integer",
        () => QueueModule.forRoot({ queue: { jobTimeoutMs: 1.5 } }),
      ],
      [
        "autoStart must be a boolean",
        () => QueueModule.forRoot({ queue: { autoStart: "yes" as never } }),
      ],
      [
        "onError must be a function",
        () => QueueModule.forRoot({ queue: { onError: "nope" as never } }),
      ],
      [
        "store must implement QueueStore",
        () => QueueModule.forRoot({ queue: { store: "nope" as never } }),
      ],
      [
        "store is missing load, save, remove, clear",
        () => QueueModule.forRoot({ queue: { store: {} as never } }),
      ],
      [
        "outbox must be an object when present",
        () => QueueModule.forRoot({ outbox: "x" as never }),
      ],
      [
        "outbox.maxEntries must be a positive integer",
        () => QueueModule.forRoot({ outbox: { maxEntries: 0 } }),
      ],
      [
        "outbox.now must be a function",
        () => QueueModule.forRoot({ outbox: { now: "nope" as never } }),
      ],
      [
        "outbox.store must implement OutboxStore",
        () => QueueModule.forRoot({ outbox: { store: "nope" as never } }),
      ],
      [
        "outbox.store is missing list, append, update, remove, clear",
        () => QueueModule.forRoot({ outbox: { store: {} as never } }),
      ],
      ["name must be a non-empty string", () => QueueModule.forRoot({ name: "" })],
      ["isGlobal must be a boolean", () => QueueModule.forRoot({ isGlobal: "yes" as never })],
    ];

    for (const [issue, run] of cases) {
      const failure = capture(run);
      expect(failure.code).toBe("INVALID_QUEUE_OPTIONS");
      expect((failure.details as { issues: readonly string[] }).issues).toContain(issue);
    }
  });

  test("the asynchronous registration is the same module under a name", () => {
    const definition = QueueModule.registerAsync({
      useFactory: () => ({ queue: { concurrency: 1 } }),
    });

    expect(definition.module).toBe(QueueModule);
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
