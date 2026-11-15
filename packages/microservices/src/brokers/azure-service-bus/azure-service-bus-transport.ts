import {
  brokerIdentifierIssue,
  brokerOptionsIssues,
  optionalBrokerStringIssue,
  positiveIntegerIssue,
} from "../shared/broker-config.ts";
import { brokerSdkShapeFailure, loadBrokerSdk, requireSdkFunction } from "../shared/broker-sdk.ts";
import { BrokerTransport } from "../shared/broker-transport.ts";
import { invalidMicroserviceOptions } from "../../transport/transport-validation.ts";
import { transportFailure, withTimeout } from "../../transport/transport-lifecycle.ts";
import type {
  TransportDecision,
  TransportHandler,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "../../transport/transport.types.ts";
import type {
  AzureSdkClient,
  AzureSdkLoader,
  AzureSdkModule,
  AzureSdkReceivedMessage,
  AzureSdkReceiverSubscription,
  AzureSdkSender,
  AzureServiceBusTransportOptions,
} from "./azure-service-bus-transport.types.ts";

const transportName = "azure-service-bus";
const packageName = "@azure/service-bus";
const defaultMaxConcurrentCalls = 16;
const defaultMaxAutoLockRenewalDurationMs = 300_000;
const defaultConnectTimeoutMs = 10_000;
const maximumConnectionStringLength = 4_096;

interface ResolvedAzureOptions {
  readonly connectionString: string;
  readonly maxConcurrentCalls: number;
  readonly maxAutoLockRenewalDurationMs: number;
  readonly connectTimeoutMs: number;
  readonly name: string;
}

/**
 * Creates an Azure Service Bus transport.
 *
 * Destinations are queue names and the framework never provisions a queue.
 * Each client needs its own reply queue: the server publishes a reply to the
 * queue the envelope names, it does not address a caller identity.
 *
 * @param options - Connection string, concurrency, lock renewal, timeout, and name.
 * @returns A transport whose `connect` must succeed before use.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_OPTIONS` when an option is invalid.
 */
export function azureServiceBusTransport(
  options: AzureServiceBusTransportOptions,
): AzureServiceBusTransport {
  return new AzureServiceBusTransport(options);
}

/**
 * The Azure Service Bus adapter.
 *
 * @internal
 */
export class AzureServiceBusTransport extends BrokerTransport {
  readonly #options: ResolvedAzureOptions;
  readonly #loader: AzureSdkLoader;
  readonly #senders = new Map<string, Promise<AzureSdkSender>>();
  #client: AzureSdkClient | undefined;

  constructor(options: AzureServiceBusTransportOptions, loader?: AzureSdkLoader) {
    const resolved = resolveOptions(options);
    super(resolved.name);
    this.#options = resolved;
    this.#loader = loader ?? loadAzureSdk;
  }

  protected async open(): Promise<void> {
    const client = await withTimeout(this.#createClient(), this.#options.connectTimeoutMs, () =>
      transportFailure(transportName, "connect"),
    );
    this.#client = client;
  }

  protected async publishMessage(
    destination: string,
    payload: Uint8Array,
    _replyTo: string | undefined,
  ): Promise<void> {
    const sender = await this.#requireSender(destination);
    await sender.sendMessages({ body: payload });
  }

  protected async openSubscription(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle> {
    const client = this.#requireClient();
    const receiver = client.createReceiver(subscription.destination, {
      receiveMode: "peekLock",
      maxAutoLockRenewalDurationInMs: this.#options.maxAutoLockRenewalDurationMs,
    });
    if (
      typeof receiver !== "object" ||
      receiver === null ||
      typeof receiver.subscribe !== "function" ||
      typeof receiver.close !== "function"
    ) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    // The SDK takes the handlers first and the subscribe options second.
    const sdkSubscription: AzureSdkReceiverSubscription = receiver.subscribe(
      {
        processMessage: (message) => this.#settle(message, handler),
        processError: async () => undefined,
      },
      {
        autoCompleteMessages: false,
        maxConcurrentCalls: this.#options.maxConcurrentCalls,
      },
    );
    if (
      typeof sdkSubscription !== "object" ||
      sdkSubscription === null ||
      typeof sdkSubscription.close !== "function"
    ) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    let closed = false;
    return Object.freeze({
      close: async (): Promise<void> => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          await sdkSubscription.close();
        } finally {
          await receiver.close();
        }
      },
    });
  }

  protected async release(): Promise<void> {
    const senders = [...this.#senders.values()];
    this.#senders.clear();
    for (const sender of senders) {
      try {
        const resolved = await sender;
        await resolved.close();
      } catch {
        // A sender that never opened or refused to close has nothing left to release.
      }
    }
    const client = this.#client;
    this.#client = undefined;
    if (client === undefined) {
      return;
    }
    try {
      await client.close();
    } catch {
      // A client that refuses to close has already released its links.
    }
  }

  async #createClient(): Promise<AzureSdkClient> {
    const module = await loadBrokerSdk(transportName, packageName, this.#loader);
    if (typeof module !== "object" || module === null) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    requireSdkFunction(module.ServiceBusClient, transportName, packageName);
    const client = new module.ServiceBusClient(this.#options.connectionString);
    if (typeof client !== "object" || client === null) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    if (typeof client.createSender !== "function" || typeof client.createReceiver !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    if (typeof client.close !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return client;
  }

  async #requireSender(queue: string): Promise<AzureSdkSender> {
    const cached = this.#senders.get(queue);
    if (cached !== undefined) {
      return cached;
    }
    const client = this.#requireClient();
    const created = Promise.resolve()
      .then(() => client.createSender(queue))
      .then((sender) => {
        if (
          typeof sender !== "object" ||
          sender === null ||
          typeof sender.sendMessages !== "function" ||
          typeof sender.close !== "function"
        ) {
          throw brokerSdkShapeFailure(transportName, packageName);
        }
        return sender;
      });
    this.#senders.set(queue, created);
    try {
      return await created;
    } catch (error) {
      this.#senders.delete(queue);
      throw error;
    }
  }

  async #settle(message: AzureSdkReceivedMessage, handler: TransportHandler): Promise<void> {
    let decision: TransportDecision = "nack";
    const payload = message.body instanceof Uint8Array ? message.body : undefined;
    if (payload !== undefined) {
      try {
        decision = await handler({ payload });
      } catch {
        decision = "nack";
      }
    }
    try {
      if (decision === "ack") {
        await message.complete();
        return;
      }
      await message.abandon();
    } catch {
      // An unsettled message returns to the queue when its lock expires.
    }
  }

  #requireClient(): AzureSdkClient {
    const client = this.#client;
    if (client === undefined) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return client;
  }
}

function resolveOptions(options: AzureServiceBusTransportOptions): ResolvedAzureOptions {
  const issues = [
    connectionStringIssue(options.connectionString),
    options.maxConcurrentCalls === undefined
      ? undefined
      : positiveIntegerIssue(options.maxConcurrentCalls, "maxConcurrentCalls"),
    options.maxAutoLockRenewalDurationMs === undefined
      ? undefined
      : positiveIntegerIssue(options.maxAutoLockRenewalDurationMs, "maxAutoLockRenewalDurationMs"),
    options.connectTimeoutMs === undefined
      ? undefined
      : positiveIntegerIssue(options.connectTimeoutMs, "connectTimeoutMs"),
    options.name === undefined ? undefined : brokerIdentifierIssue(options.name, "name"),
  ];
  const collected = brokerOptionsIssues(issues);
  if (collected.length > 0) {
    throw invalidMicroserviceOptions("Azure Service Bus transport options", collected);
  }
  return Object.freeze({
    connectionString: options.connectionString,
    maxConcurrentCalls: options.maxConcurrentCalls ?? defaultMaxConcurrentCalls,
    maxAutoLockRenewalDurationMs:
      options.maxAutoLockRenewalDurationMs ?? defaultMaxAutoLockRenewalDurationMs,
    connectTimeoutMs: options.connectTimeoutMs ?? defaultConnectTimeoutMs,
    name: options.name ?? transportName,
  });
}

function connectionStringIssue(value: unknown): string | undefined {
  if (value === undefined) {
    return "connectionString must be a non-empty string of at most 4096 characters";
  }
  return optionalBrokerStringIssue(value, "connectionString", maximumConnectionStringLength);
}

async function loadAzureSdk(): Promise<AzureSdkModule> {
  return (await import("@azure/service-bus")) as unknown as AzureSdkModule;
}
