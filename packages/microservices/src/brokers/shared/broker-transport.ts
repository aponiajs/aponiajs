import { invalidMicroserviceOptions } from "../../transport/transport-validation.ts";
import {
  TransportLifecycle,
  translateTransportFailure,
} from "../../transport/transport-lifecycle.ts";
import type {
  Transport,
  TransportHandler,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "../../transport/transport.types.ts";
import { brokerDestinationIssue, brokerGroupIssue } from "./broker-config.ts";

/**
 * The shared ordering every broker adapter uses.
 *
 * The base owns connection state and subscription tracking; an adapter supplies
 * only the SDK calls. A transport is terminal after close, concurrent
 * `connect()` calls share one attempt, and a subscription opened while the
 * transport is closing is refused before an SDK resource is allocated.
 *
 * @internal
 */
export abstract class BrokerTransport implements Transport {
  readonly name: string;
  readonly #lifecycle: TransportLifecycle;
  readonly #subscriptions = new Set<TransportSubscriptionHandle>();

  protected constructor(name: string) {
    this.name = name;
    this.#lifecycle = new TransportLifecycle(name);
  }

  /** Opens the SDK connection once. */
  async connect(): Promise<void> {
    await this.#lifecycle.connect(async () => {
      try {
        await this.open();
      } catch (error) {
        throw translateTransportFailure(error, this.name, "connect");
      }
    });
  }

  /** Publishes one encoded envelope after validating the destinations. */
  async publish(destination: string, payload: Uint8Array, replyTo?: string): Promise<void> {
    this.#assertOpen();
    this.#assertDestination(destination, "destination");
    if (replyTo !== undefined) {
      this.#assertDestination(replyTo, "replyTo");
    }
    try {
      await this.publishMessage(destination, payload, replyTo);
    } catch (error) {
      throw translateTransportFailure(error, this.name, "publish");
    }
  }

  /** Opens one subscription and tracks it for terminal close. */
  async subscribe(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle> {
    this.#assertOpen();
    this.#assertSubscription(subscription);
    let handle: TransportSubscriptionHandle;
    try {
      handle = await this.openSubscription(subscription, handler);
    } catch (error) {
      throw translateTransportFailure(error, this.name, "subscribe");
    }
    let tracked: TransportSubscriptionHandle;
    tracked = Object.freeze({
      close: async () => {
        this.#subscriptions.delete(tracked);
        await handle.close();
      },
    });
    this.#subscriptions.add(tracked);
    return tracked;
  }

  /** Closes every subscription, then releases the SDK connection. */
  async close(): Promise<void> {
    await this.#lifecycle.close(async () => {
      for (const subscription of [...this.#subscriptions].reverse()) {
        this.#subscriptions.delete(subscription);
        try {
          await subscription.close();
        } catch {
          // One subscription that refuses to close cannot keep the rest open.
        }
      }
      await this.release();
    });
  }

  /** Refuses an operation that runs before connect or after close. */
  protected assertOpen(): void {
    this.#assertOpen();
  }

  /** Opens the SDK connection. */
  protected abstract open(): Promise<void>;

  /** Publishes one encoded envelope through the SDK. */
  protected abstract publishMessage(
    destination: string,
    payload: Uint8Array,
    replyTo: string | undefined,
  ): Promise<void>;

  /** Opens one SDK subscription. */
  protected abstract openSubscription(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle>;

  /** Releases the SDK connection after every subscription is closed. */
  protected abstract release(): Promise<void>;

  #assertOpen(): void {
    this.#lifecycle.assertOpen();
  }

  #assertDestination(value: string, field: string): void {
    const issue = brokerDestinationIssue(value, field);
    if (issue !== undefined) {
      throw invalidMicroserviceOptions("microservice broker destination", [issue]);
    }
  }

  #assertSubscription(subscription: TransportSubscription): void {
    const issues = [
      brokerDestinationIssue(subscription.destination, "subscription.destination"),
      subscription.consumerGroup === undefined
        ? undefined
        : brokerGroupIssue(subscription.consumerGroup, "subscription.consumerGroup"),
    ].filter((issue): issue is string => issue !== undefined);
    if (issues.length > 0) {
      throw invalidMicroserviceOptions("microservice broker subscription", issues);
    }
  }
}
