import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { MqttTransport, mqttTransport } from "../src/brokers/mqtt/mqtt-transport.ts";
import type {
  MqttSdkClient,
  MqttSdkConnectOptions,
  MqttSdkModule,
  MqttSdkPublishOptions,
  MqttSdkSubscribeOptions,
} from "../src/brokers/mqtt/mqtt-transport.types.ts";
import type { TransportMessage } from "../src/transport/transport.types.ts";

const request = new Uint8Array([1, 2, 3]);
const reply = new Uint8Array([4, 5, 6]);

type Listener = (...args: never[]) => void;

class FakeMqttClient implements MqttSdkClient {
  readonly published: {
    readonly topic: string;
    readonly payload: Uint8Array;
    readonly qos: number | undefined;
  }[] = [];
  readonly subscriptions: { readonly topic: string; readonly qos: number | undefined }[] = [];
  readonly unsubscriptions: string[] = [];
  readonly removedListeners: string[] = [];
  readonly #listeners = new Map<string, Set<Listener>>();
  endCalls = 0;
  endFailure: Error | undefined;
  subscribeFailure: Error | undefined;
  unsubscribeFailure: Error | undefined;

  constructor(readonly autoConnect = true) {}

  start(): void {
    if (this.autoConnect) {
      queueMicrotask(() => this.emit("connect"));
    }
  }

  on(event: string, listener: Listener): void {
    let listeners = this.#listeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(event, listeners);
    }
    listeners.add(listener);
  }

  removeAllListeners(event?: string): void {
    if (event === undefined) {
      this.#listeners.clear();
      return;
    }
    this.removedListeners.push(event);
    this.#listeners.delete(event);
  }

  publishAsync(
    topic: string,
    payload: Uint8Array,
    options?: MqttSdkPublishOptions,
  ): Promise<unknown> {
    this.published.push({ topic, payload, qos: options?.qos });
    return Promise.resolve();
  }

  subscribeAsync(topic: string, options?: MqttSdkSubscribeOptions): Promise<unknown> {
    this.subscriptions.push({ topic, qos: options?.qos });
    if (this.subscribeFailure !== undefined) {
      return Promise.reject(this.subscribeFailure);
    }
    return Promise.resolve();
  }

  unsubscribeAsync(topic: string): Promise<unknown> {
    this.unsubscriptions.push(topic);
    if (this.unsubscribeFailure !== undefined) {
      return Promise.reject(this.unsubscribeFailure);
    }
    return Promise.resolve();
  }

  endAsync(): Promise<void> {
    this.endCalls += 1;
    if (this.endFailure !== undefined) {
      return Promise.reject(this.endFailure);
    }
    return Promise.resolve();
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of Array.from(this.#listeners.get(event) ?? [])) {
      listener(...(args as never[]));
    }
  }

  listenerCount(event: string): number {
    return this.#listeners.get(event)?.size ?? 0;
  }
}

function moduleFor(
  client: FakeMqttClient,
  onConnect?: (options: MqttSdkConnectOptions | undefined, url: string) => void,
): MqttSdkModule {
  return {
    connect: (url, options) => {
      onConnect?.(options, url);
      client.start();
      return client;
    },
  };
}

function loaderFor(
  client: FakeMqttClient,
  onConnect?: (options: MqttSdkConnectOptions | undefined, url: string) => void,
): () => Promise<MqttSdkModule> {
  return async () => moduleFor(client, onConnect);
}

describe("MQTT transport", () => {
  test("loads the SDK only when the connection opens", async () => {
    const client = new FakeMqttClient();
    let loads = 0;
    const transport = new MqttTransport({ url: "mqtt://broker:1883", clientId: "orders-1" }, () => {
      loads += 1;
      return Promise.resolve(moduleFor(client));
    });

    expect(loads).toBe(0);
    await transport.connect();
    expect(loads).toBe(1);
    await transport.connect();
    expect(loads).toBe(1);
    await transport.close();
  });

  test("connects MQTT 5 with a stable session and the default limits", async () => {
    const client = new FakeMqttClient();
    let seen: MqttSdkConnectOptions | undefined;
    let url = "";
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client, (options, seenUrl) => {
        seen = options;
        url = seenUrl;
      }),
    );

    await transport.connect();
    expect(transport.name).toBe("mqtt");
    expect(url).toBe("mqtt://broker:1883");
    expect(seen).toEqual({
      clientId: "orders-1",
      clean: false,
      reconnectPeriod: 0,
      connectTimeout: 10_000,
      protocolVersion: 5,
      properties: { sessionExpiryInterval: 86_400 },
    });
    await transport.close();
  });

  test("passes credentials, session expiry, timeout, and name", async () => {
    const client = new FakeMqttClient();
    let seen: MqttSdkConnectOptions | undefined;
    const transport = new MqttTransport(
      {
        url: "mqtts://broker:8883",
        clientId: "orders-1",
        username: "service",
        password: "secret",
        sessionExpirySeconds: 1,
        connectTimeoutMs: 250,
        name: "orders-mqtt",
      },
      loaderFor(client, (options) => {
        seen = options;
      }),
    );

    await transport.connect();
    expect(transport.name).toBe("orders-mqtt");
    expect(seen).toEqual({
      clientId: "orders-1",
      username: "service",
      password: "secret",
      clean: false,
      reconnectPeriod: 0,
      connectTimeout: 250,
      protocolVersion: 5,
      properties: { sessionExpiryInterval: 1 },
    });
    await transport.close();
  });

  test("publishes the envelope at QoS 1", async () => {
    const client = new FakeMqttClient();
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client),
    );

    await transport.connect();
    await transport.publish("orders.requests", request, "orders.replies.one");
    await transport.publish("orders.events", reply);

    expect(client.published).toEqual([
      { topic: "orders.requests", payload: request, qos: 1 },
      { topic: "orders.events", payload: reply, qos: 1 },
    ]);
    await transport.close();
  });

  test("delivers messages for the subscribed destination only", async () => {
    const client = new FakeMqttClient();
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client),
    );
    const seen: TransportMessage[] = [];

    await transport.connect();
    const handle = await transport.subscribe({ destination: "orders.requests" }, (message) => {
      seen.push(message);
      return "nack";
    });

    expect(client.subscriptions).toEqual([{ topic: "orders.requests", qos: 1 }]);
    client.emit("message", "orders.requests", request);
    client.emit("message", "orders.events", reply);
    await Bun.sleep(0);

    expect(seen).toEqual([{ payload: request }]);
    await handle.close();
  });

  test("ignores a malformed payload and an unrelated shared topic", async () => {
    const client = new FakeMqttClient();
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client),
    );
    const seen: TransportMessage[] = [];

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, (message) => {
      seen.push(message);
      return "ack";
    });

    expect(() => client.emit("message", "orders.requests", "not bytes")).not.toThrow();
    client.emit("message", "$share/workers", request);
    client.emit("message", "unrelated.topic", request);
    await Bun.sleep(0);

    expect(seen).toEqual([]);
    expect(() => client.emit("error", new Error("late socket error"))).not.toThrow();
    await transport.close();
  });

  test("accepts a module that exposes connect on its default export", async () => {
    const client = new FakeMqttClient();
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      async () => ({
        default: {
          connect: () => {
            client.start();
            return client;
          },
        },
      }),
    );

    await transport.connect();
    await transport.publish("orders.requests", request);
    expect(client.published).toEqual([{ topic: "orders.requests", payload: request, qos: 1 }]);
    await transport.close();
  });

  test("maps a consumer group to a shared subscription", async () => {
    const client = new FakeMqttClient();
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client),
    );
    const seen: TransportMessage[] = [];

    await transport.connect();
    const handle = await transport.subscribe(
      { destination: "orders.requests", consumerGroup: "workers" },
      (message) => {
        seen.push(message);
        return "ack";
      },
    );

    expect(client.subscriptions).toEqual([{ topic: "$share/workers/orders.requests", qos: 1 }]);
    client.emit("message", "$share/workers/orders.requests", request);
    client.emit("message", "orders.requests", reply);
    await Bun.sleep(0);

    expect(seen).toEqual([{ payload: request }, { payload: reply }]);
    await handle.close();
  });

  test("never throws from a delivery callback when the handler fails", async () => {
    const client = new FakeMqttClient();
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client),
    );

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => {
      throw new Error("handler failed");
    });

    expect(() => client.emit("message", "orders.requests", request)).not.toThrow();
    await Bun.sleep(0);
    await transport.close();
  });

  test("closes the subscription and the client idempotently", async () => {
    const client = new FakeMqttClient();
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client),
    );
    const seen: TransportMessage[] = [];

    await transport.connect();
    const handle = await transport.subscribe({ destination: "orders.requests" }, (message) => {
      seen.push(message);
      return "ack";
    });

    await handle.close();
    await handle.close();
    expect(client.unsubscriptions).toEqual(["orders.requests"]);

    client.emit("message", "orders.requests", request);
    await Bun.sleep(0);
    expect(seen).toEqual([]);

    await transport.close();
    await transport.close();
    expect(client.endCalls).toBe(1);
    expect(client.removedListeners).toContain("message");
    expect(client.removedListeners).toContain("error");
  });

  test("settles a subscription whose unsubscribe and end calls fail", async () => {
    const client = new FakeMqttClient();
    client.unsubscribeFailure = new Error("unsubscribe failed");
    client.endFailure = new Error("end failed");
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client),
    );

    await transport.connect();
    const handle = await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    await handle.close();
    await transport.close();

    expect(client.unsubscriptions).toEqual(["orders.requests"]);
    expect(client.endCalls).toBe(1);
  });

  test("releases a failed subscription attempt", async () => {
    const client = new FakeMqttClient();
    client.subscribeFailure = new Error("subscribe failed");
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client),
    );
    const seen: TransportMessage[] = [];

    await transport.connect();
    const failure = await transport
      .subscribe({ destination: "orders.requests" }, (message) => {
        seen.push(message);
        return "ack";
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_DELIVERY_FAILED");

    client.emit("message", "orders.requests", request);
    await Bun.sleep(0);
    expect(seen).toEqual([]);
    await transport.close();
  });

  test("closing before connect releases nothing", async () => {
    let loads = 0;
    const transport = new MqttTransport({ url: "mqtt://broker:1883", clientId: "orders-1" }, () => {
      loads += 1;
      return Promise.resolve(moduleFor(new FakeMqttClient()));
    });

    await transport.close();
    await transport.close();
    expect(loads).toBe(0);
  });

  test("rejects when the client emits an error while connecting", async () => {
    const client = new FakeMqttClient(false);
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client),
    );

    const connecting = transport.connect();
    await Bun.sleep(0);
    client.endFailure = new Error("end failed");
    client.emit("error", new Error("connection refused at mqtt://broker:1883"));

    const failure = await connecting.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).message).not.toContain("mqtt://broker:1883");
    expect(client.endCalls).toBe(1);
  });

  test("rejects when the client closes while connecting", async () => {
    const client = new FakeMqttClient(false);
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client),
    );

    const connecting = transport.connect();
    await Bun.sleep(0);
    client.emit("close");

    const failure = await connecting.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect(client.endCalls).toBe(1);
  });

  test("rejects when the client never connects in time", async () => {
    const client = new FakeMqttClient(false);
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1", connectTimeoutMs: 10 },
      loaderFor(client),
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect(client.endCalls).toBe(1);
  });

  test("reports the missing package without exposing the loader failure", async () => {
    const transport = new MqttTransport({ url: "mqtt://broker:1883", clientId: "orders-1" }, () =>
      Promise.reject(new Error("cannot resolve mqtt from /secret/path")),
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({ transport: "mqtt", package: "mqtt" });
    expect((failure as AponiaError).message).not.toContain("/secret/path");
  });

  test("reports a module or client without the required shape", async () => {
    const withoutConnect = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      async () => ({}),
    );
    const notAModule = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      async () =>
        ({
          connect: () => 42,
        }) as unknown as MqttSdkModule,
    );
    const incompleteClient = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      async () =>
        ({
          connect: () => ({ on: () => undefined }),
        }) as unknown as MqttSdkModule,
    );

    for (const transport of [withoutConnect, notAModule, incompleteClient]) {
      const failure = await transport.connect().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AponiaError);
      expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
      expect((failure as AponiaError).details).toEqual({ transport: "mqtt", package: "mqtt" });
    }
  });

  test("refuses invalid options before a connection opens", () => {
    for (const options of [
      {},
      { url: " ", clientId: "orders-1" },
      { url: "mqtt://broker:1883" },
      { url: "mqtt://broker:1883", clientId: "orders 1" },
      { url: "mqtt://broker:1883", clientId: "orders-1", username: "" },
      { url: "mqtt://broker:1883", clientId: "orders-1", sessionExpirySeconds: 0 },
      {
        url: "mqtt://broker:1883",
        clientId: "orders-1",
        sessionExpirySeconds: 4_294_967_296,
      },
      { url: "mqtt://broker:1883", clientId: "orders-1", connectTimeoutMs: 0 },
      { url: "mqtt://broker:1883", clientId: "orders-1", name: "orders mqtt" },
    ]) {
      const failure = (() => {
        try {
          new MqttTransport(options as never);
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(AponiaError);
      expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    }
  });

  test("refuses operations before connect and after close", async () => {
    const client = new FakeMqttClient();
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client),
    );

    const before = await transport
      .publish("orders.requests", request)
      .catch((error: unknown) => error);
    expect(before).toBeInstanceOf(AponiaError);
    expect((before as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");

    await transport.connect();
    await transport.close();
    const after = await transport
      .publish("orders.requests", request)
      .catch((error: unknown) => error);
    expect(after).toBeInstanceOf(AponiaError);
    expect((after as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    const reconnect = await transport.connect().catch((error: unknown) => error);
    expect(reconnect).toBeInstanceOf(AponiaError);
  });

  test("rejects an invalid subscription destination before the SDK sees it", async () => {
    const client = new FakeMqttClient();
    const transport = new MqttTransport(
      { url: "mqtt://broker:1883", clientId: "orders-1" },
      loaderFor(client),
    );

    await transport.connect();
    const failure = await transport
      .subscribe({ destination: "orders/#" }, () => "ack")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    expect(client.subscriptions).toEqual([]);
    await transport.close();
  });

  test("builds the public factory", () => {
    expect(mqttTransport({ url: "mqtt://broker:1883", clientId: "orders-1" }).name).toBe("mqtt");
    expect(
      mqttTransport({ url: "mqtt://broker:1883", clientId: "orders-1", name: "orders" }).name,
    ).toBe("orders");
  });
});
