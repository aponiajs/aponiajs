import { afterEach, describe, expect, test } from "bun:test";
import { AponiaError, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { OutboxService, QueueModule, QueueService } from "../src/index.ts";

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
