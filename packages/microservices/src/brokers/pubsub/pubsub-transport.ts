import {
  brokerIdentifierIssue,
  brokerOptionsIssues,
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
  PubSubDeliveredMessage,
  PubSubSdkClient,
  PubSubSdkLoader,
  PubSubSdkModule,
  PubSubTransportOptions,
} from "./pubsub-transport.types.ts";

const transportName = "gcp-pubsub";
const packageName = "@google-cloud/pubsub";
const defaultFlowControlMaxMessages = 100;
const defaultConnectTimeoutMs = 10_000;

interface ResolvedPubSubOptions {
  readonly projectId: string | undefined;
  readonly flowControlMaxMessages: number;
  readonly connectTimeoutMs: number;
  readonly name: string;
}

/**
 * Creates a Google Cloud Pub/Sub transport.
 *
 * Publish destinations are topics and subscription destinations are
 * subscriptions; the framework never provisions either. A reply topic and the
 * per-client subscription that receives it are distinct resources, which is
 * what `replySubscription` on the client configuration names.
 *
 * @param options - Optional project, flow control, timeout, and name.
 * @returns A transport whose `connect` must succeed before use.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_OPTIONS` when an option is invalid.
 */
export function pubSubTransport(options: PubSubTransportOptions = {}): PubSubTransport {
  return new PubSubTransport(options);
}

/**
 * The Google Cloud Pub/Sub adapter.
 *
 * @internal
 */
export class PubSubTransport extends BrokerTransport {
  readonly #options: ResolvedPubSubOptions;
  readonly #loader: PubSubSdkLoader;
  #client: PubSubSdkClient | undefined;

  constructor(options: PubSubTransportOptions = {}, loader?: PubSubSdkLoader) {
    const resolved = resolveOptions(options);
    super(resolved.name);
    this.#options = resolved;
    this.#loader = loader ?? loadPubSubSdk;
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
    const client = this.#requireClient();
    const topic = client.topic(destination);
    if (typeof topic !== "object" || topic === null || typeof topic.publish !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    await topic.publish(payload);
  }

  protected async openSubscription(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle> {
    const client = this.#requireClient();
    const sdkSubscription = client.subscription(subscription.destination, {
      flowControl: { maxMessages: this.#options.flowControlMaxMessages },
    });
    if (
      typeof sdkSubscription !== "object" ||
      sdkSubscription === null ||
      typeof sdkSubscription.on !== "function" ||
      typeof sdkSubscription.close !== "function"
    ) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    sdkSubscription.on("error", () => {
      // A subscription error is transient; the SDK keeps delivering until close.
    });
    sdkSubscription.on("message", (message) => {
      void this.#settle(message, handler);
    });
    let closed = false;
    return Object.freeze({
      close: async (): Promise<void> => {
        if (closed) {
          return;
        }
        closed = true;
        await sdkSubscription.close();
      },
    });
  }

  protected async release(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    if (client === undefined) {
      return;
    }
    try {
      await client.close();
    } catch {
      // A client that refuses to close has already released its channels.
    }
  }

  async #createClient(): Promise<PubSubSdkClient> {
    const module = await loadBrokerSdk(transportName, packageName, this.#loader);
    if (typeof module !== "object" || module === null) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    requireSdkFunction(module.PubSub, transportName, packageName);
    const client =
      this.#options.projectId === undefined
        ? new module.PubSub()
        : new module.PubSub({ projectId: this.#options.projectId });
    if (typeof client !== "object" || client === null) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    if (typeof client.topic !== "function" || typeof client.subscription !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    if (typeof client.close !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return client;
  }

  async #settle(message: PubSubDeliveredMessage, handler: TransportHandler): Promise<void> {
    let decision: TransportDecision = "nack";
    const payload = message.data instanceof Uint8Array ? message.data : undefined;
    if (payload !== undefined) {
      try {
        decision = await handler({ payload });
      } catch {
        decision = "nack";
      }
    }
    try {
      if (decision === "ack") {
        message.ack();
        return;
      }
      message.nack();
    } catch {
      // The subscription settles the message again when the SDK call fails.
    }
  }

  #requireClient(): PubSubSdkClient {
    const client = this.#client;
    if (client === undefined) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return client;
  }
}

function resolveOptions(options: PubSubTransportOptions): ResolvedPubSubOptions {
  const issues = [
    options.projectId === undefined
      ? undefined
      : brokerIdentifierIssue(options.projectId, "projectId"),
    options.flowControlMaxMessages === undefined
      ? undefined
      : positiveIntegerIssue(options.flowControlMaxMessages, "flowControlMaxMessages"),
    options.connectTimeoutMs === undefined
      ? undefined
      : positiveIntegerIssue(options.connectTimeoutMs, "connectTimeoutMs"),
    options.name === undefined ? undefined : brokerIdentifierIssue(options.name, "name"),
  ];
  const collected = brokerOptionsIssues(issues);
  if (collected.length > 0) {
    throw invalidMicroserviceOptions("Google Cloud Pub/Sub transport options", collected);
  }
  return Object.freeze({
    projectId: options.projectId,
    flowControlMaxMessages: options.flowControlMaxMessages ?? defaultFlowControlMaxMessages,
    connectTimeoutMs: options.connectTimeoutMs ?? defaultConnectTimeoutMs,
    name: options.name ?? transportName,
  });
}

async function loadPubSubSdk(): Promise<PubSubSdkModule> {
  return (await import("@google-cloud/pubsub")) as unknown as PubSubSdkModule;
}
