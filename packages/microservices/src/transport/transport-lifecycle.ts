import { AponiaError } from "@aponiajs/common";

/**
 * The connection state one adapter moves through.
 *
 * Shared so every adapter answers the same questions the same way: a second
 * connect is a no-op, a close during connect waits for the attempt, and no
 * operation runs after close. Adapters supply the SDK-specific open and close
 * work; this class supplies the ordering.
 *
 * @internal
 */
export class TransportLifecycle {
  readonly #name: string;
  #state: "idle" | "connecting" | "open" | "closing" | "closed" = "idle";
  #connecting: Promise<void> | undefined;
  #closing: Promise<void> | undefined;

  constructor(name: string) {
    this.#name = name;
  }

  /** Opens once; concurrent and repeated calls share the same attempt. */
  async connect(open: () => Promise<void>): Promise<void> {
    if (this.#state === "open") {
      return;
    }
    if (this.#state === "closed" || this.#state === "closing") {
      throw unavailable(this.#name);
    }
    if (this.#connecting !== undefined) {
      return this.#connecting;
    }

    this.#state = "connecting";
    const attempt = (async () => {
      try {
        await open();
        this.#state = "open";
      } catch (error) {
        this.#state = "idle";
        throw error;
      } finally {
        this.#connecting = undefined;
      }
    })();
    this.#connecting = attempt;
    return attempt;
  }

  /** Runs a connected operation; refuses before connect and after close. */
  assertOpen(): void {
    if (this.#state !== "open") {
      throw unavailable(this.#name);
    }
  }

  /** Closes once; waits for a connect attempt before releasing resources. */
  async close(release: () => Promise<void>): Promise<void> {
    if (this.#state === "closed") {
      return;
    }
    if (this.#closing !== undefined) {
      return this.#closing;
    }

    this.#state = "closing";
    this.#closing = (async () => {
      try {
        if (this.#connecting !== undefined) {
          await this.#connecting.catch(() => undefined);
        }
        await release();
      } finally {
        this.#state = "closed";
        this.#closing = undefined;
      }
    })();
    return this.#closing;
  }
}

/**
 * The failure every operation reports when the transport is not open.
 *
 * @internal
 */
export function unavailable(name: string): AponiaError {
  return new AponiaError(
    "MICROSERVICE_TRANSPORT_UNAVAILABLE",
    `The microservice transport "${name}" is not connected.`,
    { transport: name },
  );
}

/**
 * A sanitized SDK failure.
 *
 * The SDK's own error is deliberately dropped: it can carry a connection
 * string, a credential, a topic, or a payload fragment. The operation and
 * transport name are the only facts a caller receives.
 *
 * @internal
 */
export function transportFailure(
  name: string,
  operation: "connect" | "publish" | "subscribe" | "close",
): AponiaError {
  const code =
    operation === "connect" ? "MICROSERVICE_TRANSPORT_UNAVAILABLE" : "MICROSERVICE_DELIVERY_FAILED";
  return new AponiaError(code, `The microservice transport "${name}" failed to ${operation}.`, {
    transport: name,
    operation,
  });
}

/**
 * Bounds one SDK operation with a timer.
 *
 * The timer is always cleared. The raced promise is already attached to the
 * race, so a late settlement is observed and discarded rather than reported as
 * an unhandled rejection.
 *
 * @internal
 */
export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  failure: () => AponiaError,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(failure()), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

const translatableCodes = new Set([
  "MICROSERVICE_TRANSPORT_UNAVAILABLE",
  "MICROSERVICE_DELIVERY_FAILED",
  "MICROSERVICE_REQUEST_TIMEOUT",
  "MICROSERVICE_CLIENT_CLOSED",
  "MICROSERVICE_CLIENT_OVERLOADED",
  "MICROSERVICE_SERVER_OVERLOADED",
]);

/**
 * Preserves a framework failure and sanitizes anything that came from an SDK.
 *
 * An adapter has already translated its SDK failure by the time it reaches
 * this helper, so an `AponiaError` is safe to rethrow unchanged. Every other
 * value is replaced, because an SDK error can contain a connection string,
 * a credential, or a payload fragment.
 *
 * @internal
 */
export function translateTransportFailure(
  error: unknown,
  name: string,
  operation: "connect" | "publish" | "subscribe" | "close",
): AponiaError {
  if (error instanceof AponiaError && translatableCodes.has(error.code)) {
    return error;
  }
  return transportFailure(name, operation);
}
