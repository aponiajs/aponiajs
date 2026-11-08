# @aponiajs/queue

An in-process job queue and transactional outbox for AponiaJS, with bounded
retries, exponential backoff, dead letters, and idempotent enqueue.

```bash
bun add @aponiajs/queue@beta
```

## Use it

```ts
import { Module } from "@aponiajs/common";
import { QueueModule, QueueService } from "@aponiajs/queue";

@Module({
  imports: [QueueModule.register({ queue: { concurrency: 4, maxAttempts: 5 } })],
})
export class AppModule {}

const queue = application.get(QueueService);
queue.registerHandler("email.send", async (payload, job) => {
  await mailer.send(payload, { idempotencyKey: job.idempotencyKey });
});
queue.enqueue("email.send", { to: "ada@example.com" }, { idempotencyKey: "welcome:42" });
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

## Durable backlog

```ts
const store: QueueStore = createSharedBacklog();

QueueModule.register({ queue: { store } });
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
const outbox = application.get(OutboxService);
await database.transaction(async () => {
  const order = await orders.create(input);
  outbox.record("order.created", { orderId: order.id });
});
await outbox.flush((message) => events.publish(message.name, message.payload));
```

A message the sink rejects stays at the front of the outbox and the flush throws
`OUTBOX_DELIVERY_FAILED`, so the next flush retries it in order.

## Limits

Without a store, the queue is process-local and loses its backlog on restart.
A supplied store makes the backlog survive a restart, but it is still not a
broker: nothing claims a job, so run one consumer per backlog. The outbox is
process-local either way. `waitForIdle()` waits for the work that is runnable
now, not for a job whose backoff has not elapsed.

## Documentation

- [Agent surface](../../docs/agent/README.md)
- [Jobs and outbox guide](../../docs/queues.md)
- [Published packages](../../docs/packages.md)
- [npm](https://www.npmjs.com/package/@aponiajs/queue)
