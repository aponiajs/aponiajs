import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  MemoryQueueStore,
  OutboxService,
  QueueModule,
  QueueService,
  type QueueModuleOptions,
  type QueueStore,
  type QueueServiceOptions,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented queue contract", () => {
  const queue: QueueServiceOptions = { concurrency: 2, maxAttempts: 3 };
  const options: QueueModuleOptions = { queue, outbox: { maxEntries: 10 } };

  expect(options.queue?.concurrency).toBe(2);
  expect(options.outbox?.maxEntries).toBe(10);
});

test("drains a job and flushes an outbox message through a booted application", async () => {
  @Module({ imports: [QueueModule.register({ queue: { autoStart: false } })] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const queue = application.get(QueueService);
    const outbox = application.get(OutboxService);
    const seen: unknown[] = [];
    queue.registerHandler("greet", (payload) => {
      seen.push(payload);
    });
    queue.enqueue("greet", "ada");

    expect(await queue.drain()).toMatchObject({ completed: 1 });
    expect(seen).toEqual(["ada"]);

    outbox.record("greeted", 1);
    expect(await outbox.flush(() => {})).toEqual({ delivered: 1, remaining: 0 });
  } finally {
    await application.close();
  }
});

test("accepts a durable backlog store", async () => {
  const store: QueueStore = new MemoryQueueStore();
  const queue = new QueueService({ autoStart: false, store });
  queue.registerHandler("job", () => {});

  queue.enqueue("job", 1);
  await queue.flush();
  expect(store.load()).toHaveLength(1);

  await queue.drain();
  await queue.flush();
  expect(store.load()).toHaveLength(0);
});
