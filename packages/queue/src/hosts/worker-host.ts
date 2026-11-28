import { AponiaError } from "@aponiajs/common";
import type { QueueJob } from "../interfaces/queue-job.interface.ts";

/**
 * The base class a `@Processor()` implements.
 *
 * `@nestjs/bullmq`'s `WorkerHost` exposes a BullMQ `Worker` and an abstract
 * `process(job)`. This package has no broker worker: `process` receives the
 * in-process queue's frozen job snapshot, and `worker` refuses rather than
 * inventing one.
 *
 * @example
 * ```ts
 * @Processor("email")
 * class EmailProcessor extends WorkerHost {
 *   async process(job: QueueJob<{ to: string }>): Promise<void> { ... }
 * }
 * ```
 */
export abstract class WorkerHost<TJob extends QueueJob = QueueJob> {
  /**
   * The broker worker, which this package does not have.
   *
   * @throws An `AponiaError` with `INVALID_QUEUE_JOB`; use the `process(job)`
   * argument.
   */
  get worker(): never {
    throw new AponiaError(
      "INVALID_QUEUE_JOB",
      "WorkerHost.worker is unavailable: this package runs an in-process queue with no broker worker.",
    );
  }

  /** Handles one job snapshot. */
  abstract process(job: TJob, token?: string): unknown;
}
