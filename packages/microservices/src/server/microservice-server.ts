import {
  AponiaError,
  MESSAGE_HANDLER_ERROR_CODE,
  messageFailure,
  type LoggerService,
  type MicroserviceHandler,
  type MicroserviceMessage,
  type MicroserviceReply,
} from "@aponiajs/common";
import {
  decodeMicroserviceEnvelope,
  encodeMicroserviceReply,
  readMicroserviceRequestContext,
} from "../envelope/microservice-envelope.ts";
import type {
  MicroserviceEnvelope,
  MicroserviceReplyEnvelope,
} from "../envelope/microservice-envelope.types.ts";
import {
  TransportLifecycle,
  translateTransportFailure,
  unavailable,
  withTimeout,
} from "../transport/transport-lifecycle.ts";
import {
  invalidMicroserviceOptions,
  isTransportString,
  maximumTransportDestinationLength,
  maximumTransportGroupLength,
  maximumTransportIdentifierLength,
} from "../transport/transport-validation.ts";
import type {
  Transport,
  TransportDecision,
  TransportMessage,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "../transport/transport.types.ts";
import type { MicroserviceServer, MicroserviceServerConfig } from "./microservice-server.types.ts";

const defaultMaxInFlight = 1_000;
const defaultConnectTimeoutMs = 10_000;
const defaultCloseTimeoutMs = 5_000;

interface ResolvedServerConfig {
  readonly transport: Transport;
  readonly subscriptions: readonly TransportSubscription[];
  readonly target: string;
  readonly name: string;
  readonly replyDestinations: ReadonlySet<string> | undefined;
  readonly maxInFlight: number;
  readonly connectTimeoutMs: number;
  readonly closeTimeoutMs: number;
  readonly logger: LoggerService | undefined;
}

/**
 * Creates a message-pattern server over one broker transport.
 *
 * The server checks the target before dispatch, checks the reply destination
 * before invoking a handler, bounds the handlers that run at once, and
 * publishes every reply as a CBOR v1 envelope. A malformed request is settled
 * without invoking a handler; when its reply destination is readable and
 * allowed, the server answers with `INVALID_MICROSERVICE_ENVELOPE`.
 *
 * @param config - The transport, consumed destinations, target, and limits.
 * @returns A server an application accepts as a microservice transport.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_OPTIONS` when a setting is invalid.
 *
 * @example
 * ```ts
 * const server = createMicroserviceServer({
 *   transport: mqttTransport({ url, clientId: "orders-1" }),
 *   subscriptions: [{ destination: "aponia.orders.requests" }],
 *   replyDestinations: ["aponia.orders.replies.orders-1"],
 * });
 * const app = await AponiaFactory.create(AppModule, { microservices: [server] });
 * ```
 */
export function createMicroserviceServer(config: MicroserviceServerConfig): MicroserviceServer {
  return new MicroserviceServerRuntime(resolveConfig(config));
}

class MicroserviceServerRuntime implements MicroserviceServer {
  readonly name: string;
  readonly target: string;
  readonly #config: ResolvedServerConfig;
  readonly #lifecycle: TransportLifecycle;
  readonly #subscriptions: TransportSubscriptionHandle[] = [];
  #handler: MicroserviceHandler | undefined;
  #inFlight = 0;
  #closed = false;

  constructor(config: ResolvedServerConfig) {
    this.#config = config;
    this.name = config.name;
    this.target = config.target;
    this.#lifecycle = new TransportLifecycle(config.name);
  }

  async subscribe(handler: MicroserviceHandler): Promise<void> {
    if (this.#closed) {
      throw unavailable(this.name);
    }
    if (this.#handler !== undefined) {
      throw new AponiaError(
        "INVALID_MICROSERVICE_TRANSPORT",
        `Microservice server "${this.name}" is already subscribed.`,
        { transport: this.name },
      );
    }
    if (typeof handler !== "function") {
      throw new AponiaError(
        "INVALID_MICROSERVICE_TRANSPORT",
        `Microservice server "${this.name}" requires a handler function.`,
        { transport: this.name },
      );
    }
    this.#handler = handler;
    try {
      await this.#lifecycle.connect(async () => {
        await this.#connectTransport();
        await this.#openSubscriptions();
      });
    } catch (error) {
      this.#handler = undefined;
      this.#closed = true;
      await this.#release();
      throw translateTransportFailure(error, this.#config.transport.name, "subscribe");
    }
  }

  async close(): Promise<void> {
    if (this.#closed) {
      await this.#lifecycle.close(() => this.#release());
      return;
    }
    this.#closed = true;
    await this.#lifecycle.close(() => this.#release());
  }

  async #connectTransport(): Promise<void> {
    try {
      await withTimeout(this.#config.transport.connect(), this.#config.connectTimeoutMs, () =>
        translateTransportFailure(undefined, this.#config.transport.name, "connect"),
      );
    } catch (error) {
      throw translateTransportFailure(error, this.#config.transport.name, "connect");
    }
  }

  async #openSubscriptions(): Promise<void> {
    for (const subscription of this.#config.subscriptions) {
      const handle = await this.#config.transport.subscribe(subscription, (message) =>
        this.#deliver(message),
      );
      this.#subscriptions.push(handle);
    }
  }

  async #deliver(message: TransportMessage): Promise<TransportDecision> {
    let envelope: MicroserviceEnvelope;
    try {
      envelope = decodeMicroserviceEnvelope(message.payload);
    } catch {
      return await this.#answerMalformed(message.payload);
    }

    if (envelope.kind === "event") {
      await this.#dispatchEvent(envelope);
      return "ack";
    }
    if (envelope.kind === "reply") {
      return "ack";
    }

    const destination = this.#resolveReplyDestination(message.replyTo, envelope.replyTo);
    if (destination === undefined) {
      this.#log("A microservice request named a reply destination outside the allowlist.");
      return "ack";
    }
    if (envelope.target !== this.#config.target) {
      return await this.#replyAndSettle(
        destination,
        envelope.id,
        failedReply("INVALID_MICROSERVICE_MESSAGE", "The message target is not served here."),
      );
    }
    if (this.#inFlight >= this.#config.maxInFlight) {
      return await this.#replyAndSettle(
        destination,
        envelope.id,
        failedReply(
          "MICROSERVICE_SERVER_OVERLOADED",
          "The microservice server is at its in-flight limit.",
        ),
      );
    }

    this.#inFlight += 1;
    let reply: MicroserviceReply;
    try {
      reply = await this.#invoke(envelope, destination);
    } finally {
      this.#inFlight -= 1;
    }
    return await this.#replyAndSettle(destination, envelope.id, reply);
  }

  async #dispatchEvent(envelope: Extract<MicroserviceEnvelope, { kind: "event" }>): Promise<void> {
    if (envelope.target !== this.#config.target) {
      this.#log("A microservice event named another target and was dropped.");
      return;
    }
    const handler = this.#handler;
    if (handler === undefined) {
      return;
    }
    if (this.#inFlight >= this.#config.maxInFlight) {
      this.#log("A microservice event was dropped at the in-flight limit.");
      return;
    }
    this.#inFlight += 1;
    try {
      await handler(messageFromEnvelope(envelope, this.#config.transport.name, undefined));
    } catch {
      this.#log("A microservice event handler failed.");
    } finally {
      this.#inFlight -= 1;
    }
  }

  async #invoke(
    envelope: Extract<MicroserviceEnvelope, { kind: "request" }>,
    replyTo: string,
  ): Promise<MicroserviceReply> {
    const handler = this.#handler;
    if (handler === undefined) {
      return failedReply(MESSAGE_HANDLER_ERROR_CODE, "The message handler is unavailable.");
    }
    try {
      return await handler(messageFromEnvelope(envelope, this.#config.transport.name, replyTo));
    } catch {
      this.#log("A microservice request handler failed.");
      return failedReply(MESSAGE_HANDLER_ERROR_CODE, "The message handler failed.");
    }
  }

  async #answerMalformed(payload: Uint8Array): Promise<TransportDecision> {
    const context = readMicroserviceRequestContext(payload);
    if (context === undefined || !this.#isAllowed(context.replyTo)) {
      return "ack";
    }
    try {
      await this.#publishReply(
        context.replyTo,
        context.id,
        failedReply("INVALID_MICROSERVICE_ENVELOPE", "The microservice envelope is invalid."),
      );
    } catch {
      this.#log("A microservice envelope failure could not be answered.");
    }
    return "ack";
  }

  async #replyAndSettle(
    destination: string,
    id: string,
    reply: MicroserviceReply,
  ): Promise<TransportDecision> {
    try {
      await this.#publishReply(destination, id, reply);
      return "ack";
    } catch {
      this.#log("A microservice reply could not be published.");
      return "nack";
    }
  }

  async #publishReply(destination: string, id: string, reply: MicroserviceReply): Promise<void> {
    let encoded: Uint8Array;
    try {
      encoded = encodeMicroserviceReply(toReplyEnvelope(id, reply));
    } catch {
      encoded = encodeMicroserviceReply(
        toReplyEnvelope(
          id,
          failedReply(
            MESSAGE_HANDLER_ERROR_CODE,
            "The message handler returned an unencodable value.",
          ),
        ),
      );
    }
    await this.#config.transport.publish(destination, encoded);
  }

  #resolveReplyDestination(hinted: string | undefined, declared: string): string | undefined {
    if (hinted !== undefined && this.#isAllowed(hinted)) {
      return hinted;
    }
    return this.#isAllowed(declared) ? declared : undefined;
  }

  #isAllowed(destination: string): boolean {
    const allowlist = this.#config.replyDestinations;
    return allowlist === undefined || allowlist.has(destination);
  }

  #log(message: string): void {
    this.#config.logger?.error(message, "MicroservicesController");
  }

  async #release(): Promise<void> {
    const handles = this.#subscriptions.splice(0).reverse();
    for (const handle of handles) {
      try {
        await withTimeout(Promise.resolve(handle.close()), this.#config.closeTimeoutMs, () =>
          translateTransportFailure(undefined, this.#config.transport.name, "close"),
        );
      } catch {
        this.#log("A microservice subscription did not close cleanly.");
      }
    }
    try {
      await withTimeout(this.#config.transport.close(), this.#config.closeTimeoutMs, () =>
        translateTransportFailure(undefined, this.#config.transport.name, "close"),
      );
    } catch {
      this.#log("The microservice transport did not close cleanly.");
    }
  }
}

function messageFromEnvelope(
  envelope: Extract<MicroserviceEnvelope, { kind: "request" | "event" }>,
  transport: string,
  replyTo: string | undefined,
): MicroserviceMessage {
  return Object.freeze({
    id: envelope.id,
    kind: envelope.kind,
    pattern: envelope.pattern,
    data: envelope.data,
    target: envelope.target,
    ...(replyTo === undefined ? {} : { replyTo }),
    transport,
  });
}

function failedReply(code: string, message: string): MicroserviceReply {
  return Object.freeze({ ok: false, error: messageFailure(code, message) });
}

function toReplyEnvelope(id: string, reply: MicroserviceReply): MicroserviceReplyEnvelope {
  return reply.ok
    ? Object.freeze({
        v: 1 as const,
        kind: "reply" as const,
        id,
        ok: true as const,
        value: reply.value,
      })
    : Object.freeze({
        v: 1 as const,
        kind: "reply" as const,
        id,
        ok: false as const,
        error: reply.error,
      });
}

function resolveConfig(config: MicroserviceServerConfig): ResolvedServerConfig {
  const issues: string[] = [];
  if (typeof config?.transport !== "object" || config.transport === null) {
    issues.push("transport must be a transport adapter");
  } else {
    for (const member of ["connect", "publish", "subscribe", "close"] as const) {
      if (typeof config.transport[member] !== "function") {
        issues.push(`transport.${member} must be a function`);
      }
    }
    if (!isTransportString(config.transport.name, maximumTransportIdentifierLength)) {
      issues.push("transport.name must be a non-empty string of at most 128 characters");
    }
  }
  const subscriptions = config?.subscriptions;
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    issues.push("subscriptions must contain at least one destination");
  } else {
    subscriptions.forEach((subscription, index) => {
      if (!isTransportString(subscription?.destination, maximumTransportDestinationLength)) {
        issues.push(
          `subscriptions[${index}].destination must be a non-empty string of at most 2048 characters`,
        );
      }
      if (
        subscription?.consumerGroup !== undefined &&
        !isTransportString(subscription.consumerGroup, maximumTransportGroupLength)
      ) {
        issues.push(
          `subscriptions[${index}].consumerGroup must be a non-empty string of at most 512 characters`,
        );
      }
    });
  }
  if (
    config?.target !== undefined &&
    !isTransportString(config.target, maximumTransportIdentifierLength)
  ) {
    issues.push("target must be a non-empty string of at most 128 characters");
  }
  if (
    config?.name !== undefined &&
    !isTransportString(config.name, maximumTransportIdentifierLength)
  ) {
    issues.push("name must be a non-empty string of at most 128 characters");
  }
  const replyDestinations = config?.replyDestinations;
  if (replyDestinations !== undefined) {
    if (!Array.isArray(replyDestinations)) {
      issues.push("replyDestinations must be an array when provided");
    } else {
      replyDestinations.forEach((destination, index) => {
        if (!isTransportString(destination, maximumTransportDestinationLength)) {
          issues.push(
            `replyDestinations[${index}] must be a non-empty string of at most 2048 characters`,
          );
        }
      });
    }
  }
  const maxInFlight = config?.maxInFlight ?? defaultMaxInFlight;
  const connectTimeoutMs = config?.connectTimeoutMs ?? defaultConnectTimeoutMs;
  const closeTimeoutMs = config?.closeTimeoutMs ?? defaultCloseTimeoutMs;
  if (!Number.isInteger(maxInFlight) || maxInFlight < 1) {
    issues.push("maxInFlight must be a positive integer");
  }
  if (!Number.isInteger(connectTimeoutMs) || connectTimeoutMs < 1) {
    issues.push("connectTimeoutMs must be a positive integer");
  }
  if (!Number.isInteger(closeTimeoutMs) || closeTimeoutMs < 1) {
    issues.push("closeTimeoutMs must be a positive integer");
  }
  if (config?.logger !== undefined) {
    for (const member of ["log", "error"] as const) {
      if (typeof config.logger[member] !== "function") {
        issues.push(`logger.${member} must be a function`);
      }
    }
  }
  if (issues.length > 0) {
    throw invalidMicroserviceOptions("microservice server configuration", issues);
  }

  return Object.freeze({
    transport: config.transport,
    subscriptions: Object.freeze(
      config.subscriptions.map((subscription) => Object.freeze({ ...subscription })),
    ),
    target: config.target ?? "default",
    name: config.name ?? config.transport.name,
    replyDestinations:
      config.replyDestinations === undefined ? undefined : new Set(config.replyDestinations),
    maxInFlight,
    connectTimeoutMs,
    closeTimeoutMs,
    logger: config.logger,
  });
}
