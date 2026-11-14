import {
  brokerIdentifierIssue,
  brokerOptionsIssues,
  optionalBrokerStringIssue,
  positiveIntegerIssue,
} from "../shared/broker-config.ts";
import { brokerSdkShapeFailure, loadBrokerSdk } from "../shared/broker-sdk.ts";
import { BrokerTransport } from "../shared/broker-transport.ts";
import { invalidMicroserviceOptions } from "../../transport/transport-validation.ts";
import type {
  TransportHandler,
  TransportMessage,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "../../transport/transport.types.ts";
import type {
  MqttSdkClient,
  MqttSdkConnectOptions,
  MqttSdkLoader,
  MqttSdkModule,
  MqttTransportOptions,
} from "./mqtt-transport.types.ts";

const transportName = "mqtt";
const packageName = "mqtt";
const defaultSessionExpirySeconds = 86_400;
const defaultConnectTimeoutMs = 10_000;

/** The largest session-expiry interval the MQTT 5 protocol can carry. */
const maximumSessionExpirySeconds = 4_294_967_295;

/** The prefix MQTT uses to route one topic to a shared subscription group. */
const sharedSubscriptionPrefix = "$share/";

interface ResolvedMqttOptions {
  readonly url: string;
  readonly clientId: string;
  readonly username: string | undefined;
  readonly password: string | undefined;
  readonly sessionExpirySeconds: number;
  readonly connectTimeoutMs: number;
  readonly name: string;
}

interface MqttDispatchEntry {
  readonly handler: TransportHandler;
}

/**
 * Creates an MQTT transport.
 *
 * The adapter connects MQTT 5 with a stable, non-clean session so QoS 1
 * delivery can resume, publishes every envelope at QoS 1, and maps a
 * `consumerGroup` to an MQTT shared subscription. MQTT has no per-message
 * acknowledgement, so a handler's `ack` or `nack` decision is ignored after
 * the handler settles.
 *
 * @param options - The URL, client identity, optional credentials, and limits.
 * @returns A transport whose `connect` must succeed before use.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_OPTIONS` when an option is invalid.
 */
export function mqttTransport(options: MqttTransportOptions): MqttTransport {
  return new MqttTransport(options);
}

/**
 * The MQTT adapter.
 *
 * @internal
 */
export class MqttTransport extends BrokerTransport {
  readonly #options: ResolvedMqttOptions;
  readonly #loader: MqttSdkLoader;
  readonly #dispatch = new Map<string, Set<MqttDispatchEntry>>();
  #client: MqttSdkClient | undefined;

  constructor(options: MqttTransportOptions, loader?: MqttSdkLoader) {
    const resolved = resolveOptions(options);
    super(resolved.name);
    this.#options = resolved;
    this.#loader = loader ?? loadMqttSdk;
  }

  protected async open(): Promise<void> {
    const module = await loadBrokerSdk(transportName, packageName, this.#loader);
    const connect = module.connect ?? module.default?.connect;
    if (typeof connect !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    const created: unknown = connect(this.#options.url, this.#connectOptions());
    if (!hasClientShape(created)) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    try {
      await waitForConnect(created, this.#options.connectTimeoutMs);
    } catch (error) {
      await endClient(created);
      throw error;
    }
    this.#client = created;
    created.on("error", ignoreClientError);
    created.on("message", (topic, payload) => this.#deliver(topic, payload));
  }

  protected async publishMessage(
    destination: string,
    payload: Uint8Array,
    _replyTo: string | undefined,
  ): Promise<void> {
    const client = this.#requireClient();
    await client.publishAsync(destination, payload, { qos: 1 });
  }

  protected async openSubscription(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle> {
    const client = this.#requireClient();
    const destination = subscription.destination;
    const group = subscription.consumerGroup;
    const topic =
      group === undefined ? destination : `${sharedSubscriptionPrefix}${group}/${destination}`;
    const entry: MqttDispatchEntry = Object.freeze({ handler });
    let entries = this.#dispatch.get(destination);
    if (entries === undefined) {
      entries = new Set();
      this.#dispatch.set(destination, entries);
    }
    entries.add(entry);
    try {
      await client.subscribeAsync(topic, { qos: 1 });
    } catch (error) {
      removeDispatchEntry(this.#dispatch, destination, entry);
      throw error;
    }
    let closed = false;
    return Object.freeze({
      close: async (): Promise<void> => {
        if (closed) {
          return;
        }
        closed = true;
        removeDispatchEntry(this.#dispatch, destination, entry);
        try {
          await client.unsubscribeAsync(topic);
        } catch {
          // Closing is terminal; a client that already dropped the session cannot keep it open.
        }
      },
    });
  }

  protected async release(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    this.#dispatch.clear();
    if (client === undefined) {
      return;
    }
    client.removeAllListeners?.("message");
    client.removeAllListeners?.("error");
    try {
      await client.endAsync();
    } catch {
      // Closing is terminal; the session is released either way.
    }
  }

  #connectOptions(): MqttSdkConnectOptions {
    const options = this.#options;
    return {
      clientId: options.clientId,
      ...(options.username === undefined ? {} : { username: options.username }),
      ...(options.password === undefined ? {} : { password: options.password }),
      clean: false,
      reconnectPeriod: 0,
      connectTimeout: options.connectTimeoutMs,
      protocolVersion: 5,
      properties: { sessionExpiryInterval: options.sessionExpirySeconds },
    };
  }

  #deliver(topic: string, payload: Uint8Array): void {
    if (!(payload instanceof Uint8Array)) {
      return;
    }
    const entries = this.#dispatch.get(normalizeDeliveredTopic(topic));
    if (entries === undefined) {
      return;
    }
    const message: TransportMessage = Object.freeze({ payload });
    for (const entry of entries) {
      settleHandler(entry.handler, message);
    }
  }

  #requireClient(): MqttSdkClient {
    const client = this.#client;
    if (client === undefined) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return client;
  }
}

function resolveOptions(options: MqttTransportOptions): ResolvedMqttOptions {
  const issues = [
    options.url === undefined ? "url is required" : optionalBrokerStringIssue(options.url, "url"),
    options.clientId === undefined
      ? "clientId is required"
      : brokerIdentifierIssue(options.clientId, "clientId"),
    options.username === undefined
      ? undefined
      : optionalBrokerStringIssue(options.username, "username"),
    options.password === undefined
      ? undefined
      : optionalBrokerStringIssue(options.password, "password"),
    sessionExpiryIssue(options.sessionExpirySeconds),
    options.connectTimeoutMs === undefined
      ? undefined
      : positiveIntegerIssue(options.connectTimeoutMs, "connectTimeoutMs"),
    options.name === undefined ? undefined : brokerIdentifierIssue(options.name, "name"),
  ];
  const collected = brokerOptionsIssues(issues);
  if (collected.length > 0) {
    throw invalidMicroserviceOptions("MQTT transport options", collected);
  }
  return Object.freeze({
    url: options.url,
    clientId: options.clientId,
    username: options.username,
    password: options.password,
    sessionExpirySeconds: options.sessionExpirySeconds ?? defaultSessionExpirySeconds,
    connectTimeoutMs: options.connectTimeoutMs ?? defaultConnectTimeoutMs,
    name: options.name ?? transportName,
  });
}

function sessionExpiryIssue(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const issue = positiveIntegerIssue(value, "sessionExpirySeconds");
  if (issue !== undefined) {
    return issue;
  }
  if (value > maximumSessionExpirySeconds) {
    return `sessionExpirySeconds must be at most ${maximumSessionExpirySeconds}`;
  }
  return undefined;
}

function hasClientShape(value: unknown): value is MqttSdkClient {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const client = value as Record<string, unknown>;
  return (
    typeof client["on"] === "function" &&
    typeof client["publishAsync"] === "function" &&
    typeof client["subscribeAsync"] === "function" &&
    typeof client["unsubscribeAsync"] === "function" &&
    typeof client["endAsync"] === "function"
  );
}

/**
 * Resolves once the MQTT client reports its session is connected.
 *
 * Every listener the wait installs is removed and the timer is cleared on the
 * success, failure, and timeout paths alike.
 */
function waitForConnect(client: MqttSdkClient, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const detach = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      client.removeAllListeners?.("connect");
      client.removeAllListeners?.("error");
      client.removeAllListeners?.("close");
    };
    const settle = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      detach();
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    };
    client.on("connect", () => settle());
    client.on("error", () => settle(new Error("The MQTT client failed to connect.")));
    client.on("close", () => settle(new Error("The MQTT client closed while connecting.")));
    timer = setTimeout(
      () => settle(new Error("The MQTT client did not connect in time.")),
      timeoutMs,
    );
  });
}

async function endClient(client: MqttSdkClient): Promise<void> {
  client.removeAllListeners?.("connect");
  client.removeAllListeners?.("error");
  client.removeAllListeners?.("close");
  try {
    await client.endAsync();
  } catch {
    // The connect attempt already failed; closing is best effort.
  }
}

function removeDispatchEntry(
  dispatch: Map<string, Set<MqttDispatchEntry>>,
  destination: string,
  entry: MqttDispatchEntry,
): void {
  const entries = dispatch.get(destination);
  entries?.delete(entry);
  if (entries?.size === 0) {
    dispatch.delete(destination);
  }
}

/**
 * Removes the shared-subscription prefix a broker may echo in the topic.
 *
 * MQTT 5 delivers a shared subscription with the original topic, but a broker
 * that echoes the filter is normalized rather than silently dropped.
 */
function normalizeDeliveredTopic(topic: string): string {
  if (!topic.startsWith(sharedSubscriptionPrefix)) {
    return topic;
  }
  const groupEnd = topic.indexOf("/", sharedSubscriptionPrefix.length);
  if (groupEnd === -1) {
    return topic;
  }
  return topic.slice(groupEnd + 1);
}

function settleHandler(handler: TransportHandler, message: TransportMessage): void {
  void (async () => {
    try {
      await handler(message);
    } catch {
      // MQTT 5 has no per-message settlement; there is nothing to nack.
    }
  })();
}

/** Keeps an unexpected client error from surfacing as an unhandled event. */
function ignoreClientError(): void {
  // Delivery and connect failures are reported through the operation that saw them.
}

async function loadMqttSdk(): Promise<MqttSdkModule> {
  return (await import("mqtt")) as unknown as MqttSdkModule;
}
