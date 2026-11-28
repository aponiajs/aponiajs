import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  InjectQueue,
  JOB_REF,
  MODULE_OPTIONS_TOKEN,
  MemoryQueueStore,
  OutboxService,
  Processor,
  QueueModule,
  QueueService,
  WorkerHost,
  getQueueToken,
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

test("the registration is a builder definition with an options token and extras", () => {
  const definition = QueueModule.forRoot({ queue: { concurrency: 2 }, isGlobal: true });
  const asyncDefinition = QueueModule.forRootAsync({
    useFactory: async () => ({ queue: { concurrency: 2 } }),
  });

  expect(definition.module).toBe(QueueModule);
  expect(definition.global).toBe(true);
  expect(definition.exports).toContain(MODULE_OPTIONS_TOKEN);
  expect(definition.exports).toContain(getQueueToken("default"));
  expect(definition.exports).toContain(JOB_REF);
  expect(asyncDefinition.exports).toContain(MODULE_OPTIONS_TOKEN);
  expect(() => QueueModule.forRoot({ queue: { concurrency: 0 } })).toThrow();
});

test("the BullMQ-shaped processor surface is exported", () => {
  expect(typeof Processor).toBe("function");
  expect(typeof WorkerHost).toBe("function");
  expect(typeof InjectQueue).toBe("function");
  expect(JOB_REF).toBeDefined();
  expect(getQueueToken("email")).toBe("AponiaQueue_email");
});
