# @aponiajs/queue — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The in-process job queue, its retry and dead-letter policy, and the
transactional outbox. It is a leaf: nothing in the framework depends on it.

| Domain        | Owns                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------- |
| `module/`     | `QueueModule.forRoot`, the `.module-definition.ts` builder, and the resolved option contract |
| `queue/`      | `QueueService`, job snapshots, handlers, retries, dead letters, `JobRefService`              |
| `outbox/`     | `OutboxService` and its delivery contract                                                    |
| `decorators/` | `@Processor()`, `@InjectQueue()`, and `getQueueToken()`                                      |
| `hosts/`      | `WorkerHost`                                                                                 |
| `processors/` | `ProcessorExplorer`, which registers decorated processors                                    |
| `interfaces/` | the job, queue, outbox, and module contracts                                                 |

`src/index.ts` is the only public barrel. The registration is a
`ConfigurableModuleBuilder` definition with `MODULE_OPTIONS_TOKEN`
(`QUEUE_MODULE_OPTIONS`), `isGlobal`, and `name` (the `@InjectQueue()` token);
`register`/`registerAsync` remain as deprecated aliases.

## Invariants

- **A store is a backlog, not a broker.** A supplied store survives a restart
  and can be shared, but nothing claims a job: describe it as durable backlog
  storage for one consumer, never as a distributed queue. The outbox is
  process-local unless an `OutboxStore` is supplied; `SqliteOutboxStore` is the
  bundled durable implementation and the application owns the database.
- **Writes are tracked and flushable.** `enqueue` does not await the store;
  `flush()` waits for every tracked write and rethrows the first failure, and
  `onModuleDestroy` flushes before the queue stops. Hydration treats a stored
  `running` job as pending with its attempt count kept.
- **Job snapshots are frozen.** A handler receives a frozen snapshot, not the
  mutable record the queue owns.
- **Retries are deterministic.** The delay is
  `backoffMs * 2^(attempts - 1)` capped by `maxBackoffMs`, and `availableAt` is
  the only gate a drain reads. The clock and timer are injectable so no test
  sleeps.
- **Priority orders one drain, not the backlog.** Due jobs sort by priority
  descending, then enqueue time, then id; a delayed retry does not gain priority.
- **A timeout is a failed attempt.** The timer is injected, the winning handler
  clears it, and an overrun reports `QUEUE_JOB_TIMEOUT` through the normal retry
  path. Never leave the timer armed after the handler settles. The per-job
  `AbortController` is aborted before the timeout rejects and on `close()`;
  cancellation stays cooperative and the docs must say so.
- **Shutdown drains, then closes, then flushes.** `onModuleDestroy` awaits
  `drain()` before `close()` so due jobs run, then aborts in-flight work and
  flushes tracked writes.
- **Pause stops the worker, not the queue.** `pause()` cancels the scheduled
  drain and later enqueues stay pending; an explicit `drain()` still runs. Do not
  make `pause()` refuse enqueue or drop jobs.
- **A completed job forgets its idempotency key; a dead letter keeps it.** A
  duplicate `enqueue` with a key that names a dead letter returns that dead
  letter instead of enqueuing a second job.
- **Dead letters are bounded.** `maxDeadLetters` defaults to `maxJobs` and
  evicts the oldest entry; hydration applies the same bound.
- **A handler runs outside request context.** Wrap the handler in
  `runOutsideAsyncContexts` so a timer created during a request cannot leak its
  identity, tenant, or session into the job.
- **`drain` never waits for a backoff.** It runs what is due now and returns;
  `waitForIdle` means "nothing runnable", not "queue empty".
- **The outbox delivers in order and stops at the first rejection.** The
  rejected message stays at the front and is reattempted by the next flush.
  `flush(sink, { signal })` stops between messages and leaves the undelivered
  tail.
- **Configuration failures are `AponiaError` with `INVALID_QUEUE_OPTIONS` and a
  frozen issue list.** Job misuse is `INVALID_QUEUE_JOB`.
- **The registration fails fast and reports every issue.** `forRoot` validates
  the queue bounds, the outbox bounds, and both store shapes before the module is
  imported; `forRootAsync` validates the resolved value when the options token
  first resolves. The issue list is total, not first-failure.
- **The processor surface is a name mapping, not a broker.** `@Processor("email")`
  registers its `WorkerHost.process(job)` as the handler for job name `email`;
  it does not subscribe to a queue, claim a worker, or renew a lock. `WorkerHost.worker`
  refuses rather than inventing one, and `JOB_REF` is a forwarding view of the
  job the current async chain is handling, answering `undefined` outside a
  handler. `getQueueToken(name)` is `AponiaQueue_<name>`, not BullMQ's
  `BullQueue_<name>`.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. Both lanes
boot a real application through `AponiaFactory.create` and read the injected
`QueueService` and `OutboxService`. Coverage must exercise success, retry,
dead-letter, idempotency, capacity, and lifecycle paths without wall-clock
waits.
