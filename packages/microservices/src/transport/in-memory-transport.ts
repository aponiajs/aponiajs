import { AponiaError } from "@aponiajs/common";
import type {
  MicroserviceHandler,
  MicroserviceMessage,
  MicroserviceReply,
  MicroserviceTransport,
} from "@aponiajs/common";

/** The failure one in-memory call reports to its caller. */
export class MicroserviceCallError extends Error {
  /** The stable code the application's dispatcher or this client answered with. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MicroserviceCallError";
    this.code = code;
  }
}

/** The options `InMemoryTransport` constructs with. */
export interface InMemoryTransportOptions {
  /** The name reported to handlers; defaults to `memory`. */
  readonly name?: string;
}

/**
 * An in-process transport and client over one application instance.
 *
 * It is the reference transport: the application subscribes with its
 * dispatcher at boot, and the same object exposes `send` for request/response
 * and `emit` for events. It is deliberately not a queue — no retry,
 * persistence, or cross-process delivery — and is useful for tests, modular
 * monoliths, and as the shape a broker adapter implements.
 */
export class InMemoryTransport implements MicroserviceTransport {
  readonly name: string;
  #handler: MicroserviceHandler | undefined;

  constructor(options: InMemoryTransportOptions = {}) {
    this.name = options.name ?? "memory";
    this.#handler = undefined;
    if (this.name.trim() === "") {
      throw new TypeError("InMemoryTransport requires a non-empty name.");
    }
    Object.freeze(this);
  }

  /** Starts delivering messages to one application's dispatcher. */
  subscribe(handler: MicroserviceHandler): void {
    if (this.#handler !== undefined) {
      throw new AponiaError(
        "INVALID_MICROSERVICE_TRANSPORT",
        `Transport "${this.name}" is already subscribed; one instance serves one application.`,
        { transport: this.name },
      );
    }
    this.#handler = handler;
  }

  /** Stops delivery; a later call reports that no application is connected. */
  close(): void {
    this.#handler = undefined;
  }

  /**
   * Sends a request and returns the handler's value.
   *
   * @param pattern - The pattern a handler declared.
   * @param data - The payload the handler binds.
   * @returns The handler's reply value.
   * @throws A `MicroserviceCallError` carrying the dispatcher's stable code.
   */
  async send<T = unknown>(pattern: string | number, data?: unknown): Promise<T> {
    const reply = await this.#dispatch(pattern, data);
    if (!reply.ok) {
      throw new MicroserviceCallError(reply.error.code, reply.error.message);
    }
    return reply.value as T;
  }

  /**
   * Sends an event and discards the handler's value.
   *
   * @param pattern - The pattern an event handler declared.
   * @param data - The payload the handler binds.
   * @throws A `MicroserviceCallError` when the handler or delivery fails.
   */
  async emit(pattern: string | number, data?: unknown): Promise<void> {
    const reply = await this.#dispatch(pattern, data);
    if (!reply.ok) {
      throw new MicroserviceCallError(reply.error.code, reply.error.message);
    }
  }

  async #dispatch(pattern: string | number, data: unknown): Promise<MicroserviceReply> {
    const normalized = typeof pattern === "number" ? String(pattern) : pattern.trim();
    if (normalized === "") {
      throw new TypeError("A message pattern requires a non-empty string or a number.");
    }
    const handler = this.#handler;
    if (handler === undefined) {
      throw new MicroserviceCallError(
        "TRANSPORT_NOT_CONNECTED",
        `Transport "${this.name}" is not connected to an application.`,
      );
    }
    const message: MicroserviceMessage = Object.freeze({
      pattern: normalized,
      data,
      transport: this.name,
    });
    return await handler(message);
  }
}
