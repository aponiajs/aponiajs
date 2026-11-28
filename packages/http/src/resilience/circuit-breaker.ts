import { AponiaError } from "@aponiajs/common";

/** Configuration for the per-origin HTTP circuit breaker. */
export interface CircuitBreakerOptions {
  /** Consecutive failures before opening the circuit; defaults to `5`. */
  readonly failureThreshold?: number;
  /** Duration in ms before an open circuit transitions to half-open; defaults to `30_000`. */
  readonly resetTimeoutMs?: number;
  /** Maximum concurrent probe calls permitted in half-open state; defaults to `1`. */
  readonly halfOpenMaxCalls?: number;
  /** HTTP status codes treated as circuit failures; defaults to `500..599`. */
  readonly failureStatuses?: readonly number[];
  /** Clock function for deterministic testing; defaults to `Date.now`. */
  readonly now?: () => number;
}

export type CircuitState = "closed" | "open" | "half-open";

interface OriginBucket {
  state: CircuitState;
  failures: number;
  openedAt: number;
  halfOpenInFlight: number;
}

/**
 * Per-origin 3-state (`closed` / `open` / `half-open`) circuit breaker.
 */
export class OriginCircuitBreaker {
  readonly #failureThreshold: number;
  readonly #resetTimeoutMs: number;
  readonly #halfOpenMaxCalls: number;
  readonly #failureStatuses: ReadonlySet<number> | undefined;
  readonly #now: () => number;
  readonly #origins = new Map<string, OriginBucket>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.#failureThreshold = options.failureThreshold ?? 5;
    this.#resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.#halfOpenMaxCalls = options.halfOpenMaxCalls ?? 1;
    this.#failureStatuses =
      options.failureStatuses !== undefined ? new Set(options.failureStatuses) : undefined;
    this.#now = options.now ?? Date.now;
  }

  /** Returns the current state for an origin (default `"closed"`). */
  getState(origin: string): CircuitState {
    const bucket = this.#origins.get(origin);
    if (bucket === undefined) {
      return "closed";
    }
    if (bucket.state === "open" && this.#now() - bucket.openedAt >= this.#resetTimeoutMs) {
      return "half-open";
    }
    return bucket.state;
  }

  /** Ensures a request to `origin` is permitted, or throws `HTTP_CIRCUIT_OPEN` (`503`). */
  acquire(origin: string): void {
    const bucket = this.#origins.get(origin);
    if (bucket === undefined || bucket.state === "closed") {
      return;
    }

    if (bucket.state === "open") {
      if (this.#now() - bucket.openedAt >= this.#resetTimeoutMs) {
        bucket.state = "half-open";
        bucket.halfOpenInFlight = 1;
        return;
      }
      throw new AponiaError(
        "HTTP_CIRCUIT_OPEN",
        `Circuit breaker is open for origin "${origin}".`,
        { status: 503 },
      );
    }

    if (bucket.halfOpenInFlight >= this.#halfOpenMaxCalls) {
      throw new AponiaError(
        "HTTP_CIRCUIT_OPEN",
        `Circuit breaker is half-open and saturated for origin "${origin}".`,
        { status: 503 },
      );
    }
    bucket.halfOpenInFlight += 1;
  }

  /** Returns whether an HTTP status code counts as a failure. */
  isFailureStatus(status: number): boolean {
    if (this.#failureStatuses !== undefined) {
      return this.#failureStatuses.has(status);
    }
    return status >= 500 && status <= 599;
  }

  /** Records a successful response and closes any half-open circuit. */
  recordSuccess(origin: string): void {
    const bucket = this.#origins.get(origin);
    if (bucket === undefined) {
      return;
    }
    bucket.state = "closed";
    bucket.failures = 0;
    bucket.halfOpenInFlight = 0;
  }

  /** Records a transport error or failure status and opens the circuit when threshold is reached. */
  recordFailure(origin: string): void {
    let bucket = this.#origins.get(origin);
    if (bucket === undefined) {
      bucket = { state: "closed", failures: 0, openedAt: 0, halfOpenInFlight: 0 };
      this.#origins.set(origin, bucket);
    }

    if (bucket.state === "half-open") {
      bucket.state = "open";
      bucket.openedAt = this.#now();
      bucket.halfOpenInFlight = 0;
      return;
    }

    bucket.failures += 1;
    if (bucket.failures >= this.#failureThreshold) {
      bucket.state = "open";
      bucket.openedAt = this.#now();
      bucket.halfOpenInFlight = 0;
    }
  }
}
