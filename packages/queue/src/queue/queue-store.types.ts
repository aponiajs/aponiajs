import type { QueueJob } from "./queue-job.types.ts";

/**
 * The backlog a queue keeps outside its own memory.
 *
 * A store receives every job state the service records, so a durable
 * implementation can rebuild the queue after a restart. It is not a broker:
 * the service still owns scheduling, retries, and handlers, and two processes
 * sharing one store both read the same backlog.
 */
export interface QueueStore {
  /** Every job the store currently holds, pending, running, or dead-lettered. */
  load(): readonly QueueJob[] | PromiseLike<readonly QueueJob[]>;
  /** Records one job's latest state. */
  save(job: QueueJob): void | PromiseLike<void>;
  /** Removes one job that completed or was cleared. */
  remove(id: string): void | PromiseLike<void>;
  /** Removes every job. */
  clear(): void | PromiseLike<void>;
}
