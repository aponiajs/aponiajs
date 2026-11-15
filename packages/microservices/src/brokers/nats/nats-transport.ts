import { brokerDestinationIssue } from "../shared/broker-config.ts";
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
  TransportSubscription,
  TransportSubscriptionHandle,
} from "../../transport/transport.types.ts";
import type {
  NatsSdkConnection,
  NatsSdkLoader,
  NatsSdkModule,
  NatsTransportOptions,
} from "./nats-transport.types.ts";

const transportName = "nats";
const packageName = "nats";
const defaultServers = "127.0.0.1:4222";
const defaultConnectTimeoutMs = 10_000;

interface ResolvedNatsOptions {
  readonly servers: string | readonly string[];
  readonly user: string | undefined;
  readonly pass: string | undefined;
  readonly token: string | undefined;
  readonly connectTimeoutMs: number;
  readonly name: string;
}

/**
 * Creates a NATS transport.
 *
 * The caller supplies the concrete destinations. Requests and replies travel
 * as separate subjects, and a NATS reply field is used when the client names
 * one. Core NATS is at-most-once; this adapter makes no durability claim.
 *
 * @param options - Servers, optional credentials, timeout, and name.
 * @returns A transport whose `connect` must succeed before use.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_OPTIONS` when an option is invalid.
 */
export function natsTransport(options: NatsTransportOptions = {}): NatsTransport {
  return new NatsTransport(options);
}

/**
 * The NATS adapter.
 *
 * @internal
 */
export class NatsTransport extends BrokerTransport {
  readonly #options: ResolvedNatsOptions;
  readonly #loader: NatsSdkLoader;
  #connection: NatsSdkConnection | undefined;

  constructor(options: NatsTransportOptions = {}, loader?: NatsSdkLoader) {
    const resolved = resolveOptions(options);
    super(resolved.name);
    this.#options = resolved;
    this.#loader = loader ?? loadNatsSdk;
  }

  protected async open(): Promise<void> {
    const module = await loadBrokerSdk(transportName, packageName, this.#loader);
    if (typeof module.connect !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    const connection = await module.connect({
      servers: this.#options.servers,
      timeout: this.#options.connectTimeoutMs,
      name: this.#options.name,
      ...(this.#options.user === undefined ? {} : { user: this.#options.user }),
      ...(this.#options.pass === undefined ? {} : { pass: this.#options.pass }),
      ...(this.#options.token === undefined ? {} : { token: this.#options.token }),
    });
    if (typeof connection !== "object" || connection === null) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    this.#connection = connection;
  }

  protected async publishMessage(
    destination: string,
    payload: Uint8Array,
    replyTo: string | undefined,
  ): Promise<void> {
    const connection = this.#requireConnection();
    connection.publish(
      destination,
      payload,
      replyTo === undefined ? undefined : { reply: replyTo },
    );
  }

  protected async openSubscription(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle> {
    const connection = this.#requireConnection();
    const queue = subscription.consumerGroup;
    if (queue !== undefined) {
      const issue = brokerIdentifierIssue(queue, "subscription.consumerGroup");
      if (issue !== undefined) {
        throw invalidMicroserviceOptions("NATS transport subscription", [issue]);
      }
    }
    const handle = connection.subscribe(subscription.destination, {
      ...(queue === undefined ? {} : { queue }),
      callback: (error, message) => {
        if (error !== null || message === undefined) {
          return;
        }
        void Promise.resolve(handler(toTransportMessage(message))).catch(() => undefined);
      },
    });
    let closed = false;
    return Object.freeze({
      close: async () => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          await handle.drain();
        } catch {
          handle.unsubscribe();
        }
      },
    });
  }

  protected async release(): Promise<void> {
    const connection = this.#connection;
    this.#connection = undefined;
    if (connection === undefined) {
      return;
    }
    try {
      await connection.drain();
    } catch {
      connection.close();
    }
  }

  #requireConnection(): NatsSdkConnection {
    const connection = this.#connection;
    if (connection === undefined) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return connection;
  }
}

function toTransportMessage(message: { readonly data: Uint8Array; readonly reply?: string }): {
  readonly payload: Uint8Array;
  readonly replyTo?: string;
} {
  return Object.freeze({
    payload: message.data,
    ...(message.reply === undefined ? {} : { replyTo: message.reply }),
  });
}

function resolveOptions(options: NatsTransportOptions): ResolvedNatsOptions {
  const issues = [
    serversIssue(options.servers),
    options.user === undefined ? undefined : optionalBrokerStringIssue(options.user, "user"),
    options.pass === undefined ? undefined : optionalBrokerStringIssue(options.pass, "pass"),
    options.token === undefined ? undefined : optionalBrokerStringIssue(options.token, "token"),
    options.name === undefined ? undefined : brokerIdentifierIssue(options.name, "name"),
    options.connectTimeoutMs === undefined
      ? undefined
      : positiveIntegerIssue(options.connectTimeoutMs, "connectTimeoutMs"),
  ];
  const collected = brokerOptionsIssues(issues);
  if (collected.length > 0) {
    throw invalidMicroserviceOptions("NATS transport options", collected);
  }
  return Object.freeze({
    servers: options.servers ?? defaultServers,
    user: options.user,
    pass: options.pass,
    token: options.token,
    connectTimeoutMs: options.connectTimeoutMs ?? defaultConnectTimeoutMs,
    name: options.name ?? transportName,
  });
}

function serversIssue(servers: string | readonly string[] | undefined): string | undefined {
  if (servers === undefined) {
    return undefined;
  }
  if (typeof servers === "string") {
    if (brokerDestinationIssue(servers, "servers") !== undefined) {
      return "servers must be a non-empty server address of at most 2048 characters";
    }
    return undefined;
  }
  if (!Array.isArray(servers) || servers.length === 0) {
    return "servers must be a non-empty server address or a non-empty list of them";
  }
  for (const server of servers) {
    if (brokerDestinationIssue(server, "servers") !== undefined) {
      return "servers must contain only non-empty server addresses of at most 2048 characters";
    }
  }
  return undefined;
}

async function loadNatsSdk(): Promise<NatsSdkModule> {
  return (await import("nats")) as unknown as NatsSdkModule;
}
