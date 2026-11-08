/** Where one job stands. */
export type QueueJobState = "pending" | "running" | "completed" | "failed";

/** A frozen view of one job. */
export interface QueueJob<TPayload = unknown> {
  readonly id: string;
  readonly name: string;
  readonly payload: TPayload;
  /** How many times the handler ran; `0` before the first attempt. */
  readonly attempts: number;
  readonly maxAttempts: number;
  /** The dispatch priority; a higher value runs first. Defaults to `0`. */
  readonly priority: number;
  /** How long one attempt may run; `0` means no limit. */
  readonly timeoutMs: number;
  readonly state: QueueJobState;
  readonly enqueuedAt: number;
  /** When the next attempt may run. */
  readonly availableAt: number;
  readonly idempotencyKey?: string;
  readonly lastError?: string;
}

/** A handler a queue runs for one job name. */
export type QueueHandler<TPayload = unknown> = (
  payload: TPayload,
  job: QueueJob<TPayload>,
) => unknown;

/** The per-job options `enqueue` accepts. */
export interface QueueEnqueueOptions {
  /** Overrides the registration's attempt budget for this job. */
  readonly maxAttempts?: number;
  /** Suppresses a second enqueue while a job with this key is pending or running. */
  readonly idempotencyKey?: string;
  /** Defers the first attempt until this time; defaults to now. */
  readonly availableAt?: number;
  /** The dispatch priority; a higher value runs before a lower one. */
  readonly priority?: number;
  /** Overrides the registration's attempt timeout for this job. */
  readonly timeoutMs?: number;
}

/** What one `drain()` run did. */
export interface QueueDrainSummary {
  readonly completed: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly skipped: number;
}

/** A count of the queue's current contents. */
export interface QueueStats {
  readonly pending: number;
  readonly running: number;
  readonly deadLettered: number;
}

/** The timer `QueueService` uses for background draining. */
export interface QueueTimer {
  setTimeout(handler: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}
