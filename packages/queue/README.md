# @aponiajs/queue

An in-process job queue and transactional outbox for AponiaJS, with bounded
retries, exponential backoff, dead letters, and idempotent enqueue.

```bash
bun add @aponiajs/queue@alpha
```

## Use it

```ts
import { Injectable, Module, type OnModuleInit } from "@aponiajs/common";
import { QueueModule, QueueService } from "@aponiajs/queue";

@Injectable()
class EmailJobs implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly mailer: Mailer,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler("email.send", async (payload, job) => {
      await this.mailer.send(payload, { idempotencyKey: job.idempotencyKey });
    });
  }

  enqueueWelcome(to: string): Promise<unknown> {
    return this.queue.enqueue("email.send", { to }, { idempotencyKey: `welcome:${to}` });
  }
}

@Module({
  imports: [QueueModule.register({ queue: { concurrency: 4, maxAttempts: 5 } })],
  providers: [EmailJobs],
  exports: [EmailJobs],
})
export class AppModule {}
```

A queue handler is registered once, where the application owns the work. A
controller or service that injects `EmailJobs` enqueues through it; nothing
registers a handler at module scope. `Mailer` is an application provider, so the
handler closes over the same dependencies as the rest of the application.

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

`enqueue` schedules a drain by default. Call `await queue.drain()` to run every
due job now, or disable `autoStart` and drive the queue yourself.
`pause()` stops automatic draining and cancels its timer; `resume()` schedules
it again. An explicit `drain()` still runs while paused.

## Retries and dead letters

- A failed attempt is retried with `backoffMs * 2^(attempts - 1)`, capped at `maxBackoffMs`.
- A job that exhausts `maxAttempts` moves to the dead letter queue.
- `queue.deadLetters()` lists them; `queue.retryDeadLetter(id)` grants a fresh attempt budget.
- `queue.stats()` reports pending, running, and dead-lettered counts.
- `priority` orders due jobs: a higher value runs first, then earlier enqueue time.
- `jobTimeoutMs` (or a per-job `timeoutMs`) fails an attempt that runs too long; a failed attempt follows the retry policy, and an exhausted job is dead-lettered with the timeout as its last error.
- The handler receives `(payload, job, signal)`; the signal aborts on timeout and on `close()`. Cancellation is cooperative.
- `onModuleDestroy` drains due jobs, aborts in-flight work, and flushes tracked writes.

## Durable backlog

```ts
const store: QueueStore = createSharedBacklog();
const jobs = QueueModule.register({ queue: { store } });

@Module({ imports: [jobs] })
export class AppModule {}
```

A store receives each job state and rebuilds the backlog when the module
initializes, so a restart no longer starts with an empty queue. The service
still owns scheduling, retries, and handlers; a store is a backlog, not a
broker, and two processes sharing one store both read the same pending jobs.

- Writes are tracked, not awaited by `enqueue`. `await queue.flush()` waits for
  them and rethrows the first store failure.
- A job stored as `running` (a process that stopped mid-run) is hydrated as
  pending, with its attempt count kept.
- `MemoryQueueStore` is the bounded in-memory implementation for tests and
  single-process durability checks.
- `onModuleDestroy` stops scheduling and flushes outstanding writes.

## Outbox

```ts
import { Injectable } from "@aponiajs/common";
import { DatabaseService } from "@aponiajs/database";
import { OutboxService } from "@aponiajs/queue";
import { sql } from "drizzle-orm";

@Injectable()
class OrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly publisher: OrderPublisher,
  ) {}

  async create(id: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.execute(sql`insert into orders (id) values (${id})`);
      this.outbox.record("order.created", { orderId: id });
    });
    await this.outbox.flush((message) => this.publisher.publish(message.name, message.payload));
  }
}
```

`OrderPublisher` is an application provider that performs the actual delivery.
The outbox records the message inside the transaction and flushes it afterwards.

A message the sink rejects stays at the front of the outbox and the flush throws
`OUTBOX_DELIVERY_FAILED`, so the next flush retries it in order.

## Limits

Without a store, the queue is process-local and loses its backlog on restart.
A supplied store makes the backlog survive a restart, but it is still not a
broker: nothing claims a job, so run one consumer per backlog. The outbox is
process-local unless an `OutboxStore` is supplied; `SqliteOutboxStore` is the
bundled durable one, and the application owns its database. `waitForIdle()`
waits for the work that is runnable now, not for a job whose backoff has not
elapsed.

## Documentation

- [Agent surface](../../docs/agent/README.md)
- [Jobs and outbox guide](../../docs/queues.md)
- [Published packages](../../docs/packages.md)
- [npm](https://www.npmjs.com/package/@aponiajs/queue)
