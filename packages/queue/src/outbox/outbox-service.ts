import { randomUUID } from "node:crypto";
import { AponiaError } from "@aponiajs/common";
import type {
  OutboxFlushOptions,
  OutboxFlushResult,
  OutboxMessage,
  OutboxOptions,
  OutboxSink,
  OutboxStore,
} from "./outbox.types.ts";

interface MutableMessage {
  readonly id: string;
  readonly name: string;
  readonly payload: unknown;
  attempts: number;
  readonly recordedAt: number;
}

/**
 * Records messages inside the transaction boundary and delivers them after it.
 *
 * The built-in outbox is process-local: a restart loses it, and two instances
 * keep separate outboxes. It records intent, not durable state.
 */
export class OutboxService {
  readonly #messages: MutableMessage[] = [];
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #store: OutboxStore | undefined;
  #flushing = false;

  constructor(options: OutboxOptions = {}) {
    const maxEntries = options.maxEntries ?? 1_000;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new AponiaError("INVALID_QUEUE_OPTIONS", "The outbox registration is invalid.", {
        issues: Object.freeze(["maxEntries must be a positive integer"]),
      });
    }
    this.#maxEntries = maxEntries;
    this.#now = options.now ?? Date.now;
    this.#store = options.store;

    if (this.#store !== undefined) {
      const stored = this.#store.list();
      const retained = stored.slice(Math.max(0, stored.length - this.#maxEntries));
      this.#messages.push(...retained.map(toMutable));
    }
  }

  /** Records one message and returns its frozen form. */
  record<TPayload>(name: string, payload: TPayload): OutboxMessage<TPayload> {
    if (typeof name !== "string" || name.trim() === "") {
      throw new AponiaError(
        "INVALID_QUEUE_JOB",
        "An outbox message name must be a non-empty string.",
      );
    }
    if (this.#messages.length >= this.#maxEntries) {
      this.#messages.shift();
    }
    const message: MutableMessage = {
      id: randomUUID(),
      name,
      payload,
      attempts: 0,
      recordedAt: this.#now(),
    };
    this.#messages.push(message);
    this.#store?.append(freezeMessage(message));
    return freezeMessage(message) as OutboxMessage<TPayload>;
  }

  /** The recorded messages, oldest first. */
  pending(): readonly OutboxMessage[] {
    return Object.freeze(this.#messages.map((message) => freezeMessage(message)));
  }

  /**
   * Delivers recorded messages in order and removes the ones the sink accepted.
   * A rejected message stays at the front of the outbox for the next flush.
   */
  async flush(sink: OutboxSink, options: OutboxFlushOptions = {}): Promise<OutboxFlushResult> {
    if (typeof sink !== "function") {
      throw new AponiaError("INVALID_QUEUE_JOB", "An outbox sink must be a function.");
    }
    if (this.#flushing) {
      throw new AponiaError("INVALID_QUEUE_JOB", "An outbox flush is already running.");
    }
    this.#flushing = true;
    let delivered = 0;
    try {
      while (this.#messages.length > 0) {
        if (options.signal?.aborted === true) {
          break;
        }
        const message = this.#messages[0] as MutableMessage;
        message.attempts += 1;
        this.#store?.update(freezeMessage(message));
        try {
          await sink(freezeMessage(message));
        } catch (error) {
          throw new AponiaError("OUTBOX_DELIVERY_FAILED", "An outbox message was not delivered.", {
            messageId: message.id,
            attempts: message.attempts,
            cause: error instanceof Error ? error.message : String(error),
          });
        }
        this.#messages.shift();
        this.#store?.remove(message.id);
        delivered += 1;
      }
    } finally {
      this.#flushing = false;
    }
    return Object.freeze({ delivered, remaining: this.#messages.length });
  }

  /** Drops every recorded message. */
  clear(): void {
    this.#messages.length = 0;
    this.#store?.clear();
  }
}

function toMutable(message: OutboxMessage): MutableMessage {
  return {
    id: message.id,
    name: message.name,
    payload: message.payload,
    attempts: message.attempts,
    recordedAt: message.recordedAt,
  };
}

function freezeMessage(message: MutableMessage): OutboxMessage {
  return Object.freeze({
    id: message.id,
    name: message.name,
    payload: message.payload,
    attempts: message.attempts,
    recordedAt: message.recordedAt,
  });
}
