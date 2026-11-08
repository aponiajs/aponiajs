# Jobs and the Outbox

`@aponiajs/queue` adds an in-process job queue and a transactional outbox.

```ts
@Module({
  imports: [QueueModule.register({ queue: { concurrency: 4, maxAttempts: 5 } })],
})
export class AppModule {}
```

```ts
const queue = application.get(QueueService);
queue.registerHandler("email.send", async (payload, job) => {
  await mailer.send(payload, { idempotencyKey: job.idempotencyKey });
});
queue.enqueue("email.send", { to: "ada@example.com" }, { idempotencyKey: "welcome:42" });
```

`enqueue` schedules a drain unless `autoStart` is `false`; `drain()` runs every
job whose `availableAt` has passed, in batches of `concurrency`, and answers
completed, retried, and dead-lettered counts. `pause()` cancels automatic
draining and `resume()` schedules it again; an explicit `drain()` still runs
while paused.

## Retries

A failed attempt is retried with `backoffMs * 2^(attempts - 1)`, capped by
`maxBackoffMs`. Due jobs run by `priority` descending, then enqueue time.
`jobTimeoutMs`, or a per-enqueue `timeoutMs`, fails an attempt that runs too
long; the failure follows the retry policy and ends in the dead letter queue
when the budget is exhausted. The attempt budget is the job's `maxAttempts`, which defaults to
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
await database.transaction(async () => {
  const order = await orders.create(input);
  outbox.record("order.created", { orderId: order.id });
});
await outbox.flush((message) => events.publish(message.name, message.payload));
```

`flush` delivers oldest first and stops at the first rejection, which stays at
the front with its attempt count raised; the call throws
`OUTBOX_DELIVERY_FAILED`. A later flush retries it first, so delivery keeps its
order. `maxEntries` bounds the outbox and drops the oldest message when full.

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
