import { AponiaError, normalizeMessagePattern } from "@aponiajs/common";
import {
  decodeMicroserviceEnvelope,
  encodeMicroserviceEnvelope,
} from "../envelope/microservice-envelope.ts";
import { microserviceEnvelopeVersion } from "../envelope/microservice-envelope.constants.ts";
import type { MicroserviceReplyEnvelope } from "../envelope/microservice-envelope.types.ts";
import {
  TransportLifecycle,
  translateTransportFailure,
  withTimeout,
} from "../transport/transport-lifecycle.ts";
import {
  invalidMicroserviceOptions,
  isTransportString,
  maximumTransportDestinationLength,
  maximumTransportIdentifierLength,
} from "../transport/transport-validation.ts";
import type {
  Transport,
  TransportMessage,
  TransportSubscriptionHandle,
} from "../transport/transport.types.ts";
import { MicroserviceCallError } from "./microservice-call-error.ts";
import type { MicroserviceClient, MicroserviceClientConfig } from "./microservice-client.types.ts";

const defaultRequestTimeoutMs = 30_000;
const defaultConnectTimeoutMs = 10_000;
const defaultMaxPendingCalls = 1_000;

interface ResolvedClientConfig {
  readonly transport: Transport;
  readonly destination: string;
  readonly replyTo: string;
  readonly replySubscription: string;
  readonly target: string;
  readonly name: string;
  readonly requestTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly maxPendingCalls: number;
}

interface PendingCall {
  readonly resolve: (reply: MicroserviceReplyEnvelope) => void;
  readonly reject: (error: MicroserviceCallError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Creates a client over one broker transport.
 *
 * The client owns one reply subscription, correlates replies by the request
 * identifier in the CBOR envelope, and bounds both the pending calls and the
 * time one call may wait. It never logs a payload or an SDK error.
 *
 * @param config - The transport, destinations, target, and limits.
 * @returns A client whose `connect` must succeed before a call is sent.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_OPTIONS` when a setting is invalid.
 *
 * @example
 * ```ts
 * const client = createMicroserviceClient({
 *   transport: mqttTransport({ url, clientId: "orders-1" }),
 *   destination: "aponia.orders.requests",
 *   replyTo: "aponia.orders.replies.orders-1",
 * });
 * await client.connect();
 * const order = await client.send("orders.findOne", { id: "1" });
 * ```
 */
export function createMicroserviceClient(config: MicroserviceClientConfig): MicroserviceClient {
  return new MicroserviceClientRuntime(resolveConfig(config));
}

class MicroserviceClientRuntime implements MicroserviceClient {
  readonly name: string;
  readonly target: string;
  readonly #config: ResolvedClientConfig;
  readonly #lifecycle: TransportLifecycle;
  readonly #pending = new Map<string, PendingCall>();
  #subscription: TransportSubscriptionHandle | undefined;

  constructor(config: ResolvedClientConfig) {
    this.#config = config;
    this.name = config.name;
    this.target = config.target;
    this.#lifecycle = new TransportLifecycle(config.name);
  }

  async connect(): Promise<void> {
    await this.#lifecycle.connect(async () => {
      await this.#connectTransport();
      try {
        this.#subscription = await this.#config.transport.subscribe(
          { destination: this.#config.replySubscription },
          (message) => this.#receiveReply(message),
        );
      } catch (error) {
        await this.#closeQuietly();
        throw translateTransportFailure(error, this.#config.transport.name, "subscribe");
      }
    });
  }

  async send<T = unknown>(pattern: string | number, data?: unknown): Promise<T> {
    this.#assertOpen();
    const normalized = normalizeMessagePattern(pattern);
    if (this.#pending.size >= this.#config.maxPendingCalls) {
      throw new MicroserviceCallError(
        "MICROSERVICE_CLIENT_OVERLOADED",
        "The microservice client has no room for another pending call.",
      );
    }

    const id = crypto.randomUUID();
    const payload = encodeMicroserviceEnvelope({
      v: microserviceEnvelopeVersion,
      kind: "request",
      id,
      pattern: normalized,
      data,
      target: this.#config.target,
      replyTo: this.#config.replyTo,
    });
    const pending = this.#createPendingCall(id);
    try {
      await this.#config.transport.publish(this.#config.destination, payload, this.#config.replyTo);
    } catch (error) {
      this.#failPending(id, translateTransportFailure(error, this.name, "publish"));
      await pending.promise;
    }

    const reply = await pending.promise;
    if (!reply.ok) {
      throw new MicroserviceCallError(reply.error.code, reply.error.message);
    }
    return reply.value as T;
  }

  async emit(pattern: string | number, data?: unknown): Promise<void> {
    this.#assertOpen();
    const normalized = normalizeMessagePattern(pattern);
    const payload = encodeMicroserviceEnvelope({
      v: microserviceEnvelopeVersion,
      kind: "event",
      id: crypto.randomUUID(),
      pattern: normalized,
      data,
      target: this.#config.target,
    });
    try {
      await this.#config.transport.publish(this.#config.destination, payload);
    } catch (error) {
      throw toCallError(translateTransportFailure(error, this.name, "publish"));
    }
  }

  async close(): Promise<void> {
    await this.#lifecycle.close(async () => {
      this.#rejectAll("MICROSERVICE_CLIENT_CLOSED", "The microservice client is closed.");
      const subscription = this.#subscription;
      this.#subscription = undefined;
      if (subscription !== undefined) {
        try {
          await subscription.close();
        } catch {
          // A reply subscription that refuses to close cannot keep the client open.
        }
      }
      await this.#closeQuietly();
    });
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

  #receiveReply(message: TransportMessage): "ack" {
    let envelope;
    try {
      envelope = decodeMicroserviceEnvelope(message.payload);
    } catch {
      return "ack";
    }
    if (envelope.kind !== "reply") {
      return "ack";
    }
    const pending = this.#pending.get(envelope.id);
    if (pending === undefined) {
      return "ack";
    }
    this.#pending.delete(envelope.id);
    clearTimeout(pending.timer);
    pending.resolve(envelope);
    return "ack";
  }

  #createPendingCall(id: string): { readonly promise: Promise<MicroserviceReplyEnvelope> } {
    let resolveCall: ((reply: MicroserviceReplyEnvelope) => void) | undefined;
    let rejectCall: ((error: MicroserviceCallError) => void) | undefined;
    const promise = new Promise<MicroserviceReplyEnvelope>((resolve, reject) => {
      resolveCall = resolve;
      rejectCall = reject;
    });
    const timer = setTimeout(() => {
      if (this.#pending.delete(id)) {
        rejectCall?.(
          new MicroserviceCallError(
            "MICROSERVICE_REQUEST_TIMEOUT",
            "The microservice request did not answer before its timeout.",
          ),
        );
      }
    }, this.#config.requestTimeoutMs);
    this.#pending.set(
      id,
      Object.freeze({
        resolve: (reply: MicroserviceReplyEnvelope) => resolveCall?.(reply),
        reject: (error: MicroserviceCallError) => rejectCall?.(error),
        timer,
      }),
    );
    return { promise };
  }

  #failPending(id: string, error: AponiaError): void {
    const call = this.#pending.get(id);
    if (call === undefined) {
      return;
    }
    this.#pending.delete(id);
    clearTimeout(call.timer);
    call.reject(new MicroserviceCallError(error.code, error.message));
  }

  #rejectAll(code: string, message: string): void {
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new MicroserviceCallError(code, message));
    }
  }

  #assertOpen(): void {
    try {
      this.#lifecycle.assertOpen();
    } catch {
      throw new MicroserviceCallError(
        "MICROSERVICE_TRANSPORT_UNAVAILABLE",
        `The microservice client "${this.name}" is not connected.`,
      );
    }
  }

  async #closeQuietly(): Promise<void> {
    try {
      await this.#config.transport.close();
    } catch {
      // Close is best effort; the client is terminal either way.
    }
  }
}

function resolveConfig(config: MicroserviceClientConfig): ResolvedClientConfig {
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
  if (!isTransportString(config?.destination, maximumTransportDestinationLength)) {
    issues.push("destination must be a non-empty string of at most 2048 characters");
  }
  if (!isTransportString(config?.replyTo, maximumTransportDestinationLength)) {
    issues.push("replyTo must be a non-empty string of at most 2048 characters");
  }
  if (
    config?.replySubscription !== undefined &&
    !isTransportString(config.replySubscription, maximumTransportDestinationLength)
  ) {
    issues.push("replySubscription must be a non-empty string of at most 2048 characters");
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
  const requestTimeoutMs = config?.requestTimeoutMs ?? defaultRequestTimeoutMs;
  const connectTimeoutMs = config?.connectTimeoutMs ?? defaultConnectTimeoutMs;
  const maxPendingCalls = config?.maxPendingCalls ?? defaultMaxPendingCalls;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
    issues.push("requestTimeoutMs must be a positive integer");
  }
  if (!Number.isInteger(connectTimeoutMs) || connectTimeoutMs < 1) {
    issues.push("connectTimeoutMs must be a positive integer");
  }
  if (!Number.isInteger(maxPendingCalls) || maxPendingCalls < 1) {
    issues.push("maxPendingCalls must be a positive integer");
  }
  if (issues.length > 0) {
    throw invalidMicroserviceOptions("microservice client configuration", issues);
  }

  return Object.freeze({
    transport: config.transport,
    destination: config.destination,
    replyTo: config.replyTo,
    replySubscription: config.replySubscription ?? config.replyTo,
    target: config.target ?? "default",
    name: config.name ?? config.transport.name,
    requestTimeoutMs,
    connectTimeoutMs,
    maxPendingCalls,
  });
}

function toCallError(error: AponiaError): MicroserviceCallError {
  return new MicroserviceCallError(error.code, error.message);
}
