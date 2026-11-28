import { AponiaError } from "@aponiajs/common";

/** Configuration for the outbound HTTP concurrency bulkhead. */
export interface BulkheadOptions {
  /** Maximum concurrent in-flight requests. */
  readonly maxConcurrent: number;
  /** Maximum requests allowed to wait in queue; defaults to `0`. */
  readonly maxQueue?: number;
  /** Optional timeout in ms while waiting in queue. */
  readonly queueTimeoutMs?: number;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Bounded concurrency and queue limiter for outbound HTTP requests.
 */
export class BulkheadLimiter {
  readonly #maxConcurrent: number;
  readonly #maxQueue: number;
  readonly #queueTimeoutMs: number | undefined;
  readonly #queue: Waiter[] = [];
  #active = 0;

  constructor(options: BulkheadOptions) {
    this.#maxConcurrent = options.maxConcurrent;
    this.#maxQueue = options.maxQueue ?? 0;
    this.#queueTimeoutMs = options.queueTimeoutMs;
  }

  /** Acquires a concurrency slot and returns a release callback. */
  acquire(): Promise<() => void> {
    if (this.#active < this.#maxConcurrent) {
      this.#active += 1;
      return Promise.resolve(this.#releaseOnce());
    }

    if (this.#queue.length >= this.#maxQueue) {
      return Promise.reject(
        new AponiaError(
          "HTTP_BULKHEAD_REJECTED",
          "Outbound HTTP bulkhead capacity and queue are exhausted.",
          { status: 503 },
        ),
      );
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (this.#queueTimeoutMs !== undefined) {
        waiter.timer = setTimeout(() => {
          const index = this.#queue.indexOf(waiter);
          if (index !== -1) {
            this.#queue.splice(index, 1);
          }
          reject(
            new AponiaError(
              "HTTP_BULKHEAD_REJECTED",
              "Outbound HTTP bulkhead queue wait timed out.",
              { status: 503 },
            ),
          );
        }, this.#queueTimeoutMs);
      }
      this.#queue.push(waiter);
    });
  }

  #releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.#queue.shift();
      if (next !== undefined) {
        if (next.timer !== undefined) {
          clearTimeout(next.timer);
        }
        next.resolve(this.#releaseOnce());
        return;
      }
      this.#active -= 1;
    };
  }
}
