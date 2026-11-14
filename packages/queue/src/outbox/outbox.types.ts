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
  /**
   * A synchronous durable store. The service hydrates from it at construction
   * and writes every change back; omitting it keeps the outbox process-local.
   */
  readonly store?: OutboxStore;
}

/**
 * A durable home for recorded messages.
 *
 * The operations are synchronous so `record` stays synchronous: a SQLite
 * driver is synchronous, and a network store belongs behind an application
 * adapter rather than in this contract.
 */
export interface OutboxStore {
  /** Every stored message, oldest first. */
  list(): readonly OutboxMessage[];
  append(message: OutboxMessage): void;
  update(message: OutboxMessage): void;
  remove(id: string): void;
  clear(): void;
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
