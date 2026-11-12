/** One recorded message waiting to be delivered. */
export interface OutboxMessage<TPayload = unknown> {
  readonly id: string;
  readonly name: string;
  readonly payload: TPayload;
  readonly attempts: number;
  readonly recordedAt: number;
}

/** The sink `OutboxService.flush` delivers into. */
/** A promise-returning sink is awaited before the message is removed. */
export type OutboxSink = (message: OutboxMessage) => unknown;

/** Registration options for one outbox. */
export interface OutboxOptions {
  /** How many messages may wait at once; defaults to 1000. */
  readonly maxEntries?: number;
  /** The clock a record reads; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** Options one `flush` run accepts. */
export interface OutboxFlushOptions {
  /** Stops between messages; the undelivered tail stays in the outbox. */
  readonly signal?: AbortSignal;
}

/** What one `flush` run delivered. */
export interface OutboxFlushResult {
  readonly delivered: number;
  readonly remaining: number;
}
