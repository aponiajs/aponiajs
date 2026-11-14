import type { QueueJob, QueueTimer } from "./queue-job.types.ts";
import type { QueueStore } from "./queue-store.types.ts";

/** Registration options for one queue. */
export interface QueueServiceOptions {
  /** How many jobs may run at once; defaults to 1. */
  readonly concurrency?: number;
  /** The default attempt budget; defaults to 3. */
  readonly maxAttempts?: number;
  /** The first retry delay; each following delay doubles; defaults to 100 ms. */
  readonly backoffMs?: number;
  /** The retry delay ceiling; defaults to 30 seconds. */
  readonly maxBackoffMs?: number;
  /** How many jobs may wait at once; defaults to 1000. */
  readonly maxJobs?: number;
  /** How long one attempt may run; `0` means no limit and is the default. */
  readonly jobTimeoutMs?: number;
  /** Whether `enqueue` schedules draining itself; defaults to true. */
  readonly autoStart?: boolean;
  /**
   * The backlog the queue keeps outside its memory.
   *
   * The default is memory only. A durable store rebuilds the pending jobs and
   * the dead letters when the module initializes; `flush()` waits for the
   * writes the service has started.
   */
  readonly store?: QueueStore;
  /** The clock retry delay and availability read; defaults to `Date.now`. */
  readonly now?: () => number;
  /** The timer background draining uses. */
  readonly timer?: QueueTimer;
  /** Called with a failed attempt; defaults to silence. */
  readonly onError?: (error: unknown, job: QueueJob<unknown>) => void;
}

/** The options the service reads after validation. */
export interface ResolvedQueueServiceOptions {
  readonly concurrency: number;
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly maxBackoffMs: number;
  readonly maxJobs: number;
  readonly jobTimeoutMs: number;
  readonly autoStart: boolean;
  readonly now: () => number;
  readonly timer: QueueTimer;
  readonly onError: (error: unknown, job: QueueJob<unknown>) => void;
}
