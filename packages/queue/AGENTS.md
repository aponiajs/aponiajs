# @aponiajs/queue — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The in-process job queue, its retry and dead-letter policy, and the
transactional outbox. It is a leaf: nothing in the framework depends on it.

| Domain    | Owns                                                           |
| --------- | -------------------------------------------------------------- |
| `module/` | `QueueModule.register` and the resolved option contract        |
| `queue/`  | `QueueService`, job snapshots, handlers, retries, dead letters |
| `outbox/` | `OutboxService` and its delivery contract                      |

`src/index.ts` is the only public barrel. Keep `*.types.ts` beside the runtime
that reads it.

## Invariants

- **A store is a backlog, not a broker.** A supplied store survives a restart
  and can be shared, but nothing claims a job: describe it as durable backlog
  storage for one consumer, never as a distributed queue. The outbox stays
  process-local.
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
  path. Never leave the timer armed after the handler settles.
- **Pause stops the worker, not the queue.** `pause()` cancels the scheduled
  drain and later enqueues stay pending; an explicit `drain()` still runs. Do not
  make `pause()` refuse enqueue or drop jobs.
- **A completed job forgets its idempotency key; a dead letter keeps it.** A
  duplicate `enqueue` with a key that names a dead letter returns that dead
  letter instead of enqueuing a second job.
- **`drain` never waits for a backoff.** It runs what is due now and returns;
  `waitForIdle` means "nothing runnable", not "queue empty".
- **The outbox delivers in order and stops at the first rejection.** The
  rejected message stays at the front and is reattempted by the next flush.
- **Configuration failures are `AponiaError` with `INVALID_QUEUE_OPTIONS` and a
  frozen issue list.** Job misuse is `INVALID_QUEUE_JOB`.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. Both lanes
boot a real application through `AponiaFactory.create` and read the injected
`QueueService` and `OutboxService`. Coverage must exercise success, retry,
dead-letter, idempotency, capacity, and lifecycle paths without wall-clock
waits.
