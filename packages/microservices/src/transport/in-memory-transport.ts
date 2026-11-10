import { AponiaError, normalizeMessagePattern } from "@aponiajs/common";
import type {
  MicroserviceHandler,
  MicroserviceMessage,
  MicroserviceReply,
  MicroserviceTransport,
} from "@aponiajs/common";
import { MicroserviceCallError } from "../client/microservice-call-error.ts";

/** The options `InMemoryTransport` constructs with. */
export interface InMemoryTransportOptions {
  /** The name reported to handlers; defaults to `memory`. */
  readonly name?: string;
  /** The service target handlers receive; defaults to `default`. */
  readonly target?: string;
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
  readonly target: string;
  #handler: MicroserviceHandler | undefined;

  constructor(options: InMemoryTransportOptions = {}) {
    this.name = options.name ?? "memory";
    this.target = options.target ?? "default";
    this.#handler = undefined;
    if (this.name.trim() === "") {
      throw new TypeError("InMemoryTransport requires a non-empty name.");
    }
    if (this.target.trim() === "") {
      throw new TypeError("InMemoryTransport requires a non-empty target.");
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
    const reply = await this.#dispatch("request", pattern, data);
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
    const reply = await this.#dispatch("event", pattern, data);
    if (!reply.ok) {
      throw new MicroserviceCallError(reply.error.code, reply.error.message);
    }
  }

  async #dispatch(
    kind: "request" | "event",
    pattern: string | number,
    data: unknown,
  ): Promise<MicroserviceReply> {
    const normalized = normalizeMessagePattern(pattern);
    const handler = this.#handler;
    if (handler === undefined) {
      throw new MicroserviceCallError(
        "TRANSPORT_NOT_CONNECTED",
        `Transport "${this.name}" is not connected to an application.`,
      );
    }
    const message: MicroserviceMessage = Object.freeze({
      id: crypto.randomUUID(),
      kind,
      pattern: normalized,
      data,
      target: this.target,
      transport: this.name,
    });
    return await handler(message);
  }
}
