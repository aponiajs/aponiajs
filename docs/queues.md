# Jobs and the Outbox

`@aponiajs/queue` adds an in-process job queue and a transactional outbox.

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

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

`enqueue` schedules a drain unless `autoStart` is `false`; `drain()` runs every
job whose `availableAt` has passed, in batches of `concurrency`, and answers
completed, retried, and dead-lettered counts. `Mailer` is an application
provider, so the handler closes over the application's own services. `pause()` cancels automatic
draining and `resume()` schedules it again; an explicit `drain()` still runs
while paused.

## Retries

A failed attempt is retried with `backoffMs * 2^(attempts - 1)`, capped by
`maxBackoffMs`. Due jobs run by `priority` descending, then enqueue time.
`jobTimeoutMs`, or a per-enqueue `timeoutMs`, fails an attempt that runs too
long; the failure follows the retry policy and ends in the dead letter queue
when the budget is exhausted. The handler receives
`(payload, job, signal)`; the signal aborts on timeout and when the queue
closes. Cancellation is cooperative: a handler that ignores the signal keeps
running, so the queue cannot promise that a timed-out side effect stopped. The attempt budget is the job's `maxAttempts`, which defaults to
the registration's and can be set per enqueue. A job that exhausts the budget
moves to the dead letter queue; `deadLetters()` lists them and
`retryDeadLetter(id)` revives one with a fresh budget.

`onError` receives every failed attempt. The handler receives a frozen snapshot
of the job, including `attempts` and `lastError`, so a handler can log the
reason it is running again.

## Idempotency

An `idempotencyKey` suppresses a second enqueue while the first job is pending,
running, or dead-lettered. A completed job forgets its key, so the same key can
be used later for a new job. The queue never inspects or rewrites the payload.

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

`flush` delivers oldest first and stops at the first rejection, which stays at
the front with its attempt count raised; the call throws
`OUTBOX_DELIVERY_FAILED`. A later flush retries it first, so delivery keeps its
order. `flush(sink, { signal })` also stops between messages when the signal is
aborted, leaving the undelivered tail. `maxEntries` bounds the outbox and drops
the oldest message when full.

## Durable backlog

```ts
QueueModule.register({ queue: { store: sharedBacklog } });
```

A `QueueStore` receives every job state and rebuilds the backlog when the
module initializes. It is a backlog rather than a broker: the service still
schedules and runs handlers, and nothing claims a job, so one consumer owns one
backlog. A stored `running` job is hydrated as pending with its attempt count
kept, which is what a process that stopped mid-run leaves behind.

`enqueue` does not await the store; `await queue.flush()` waits for the tracked
writes and rethrows the first failure. `MemoryQueueStore` is the bounded
in-memory implementation for tests.

## Limits

Without a store, a restart loses the queue, and the outbox is always
process-local. Use a broker plus a durable outbox table when the application
needs several consumers and delivery beyond one process.

See the [package README](../packages/queue/README.md) for the full contract.
