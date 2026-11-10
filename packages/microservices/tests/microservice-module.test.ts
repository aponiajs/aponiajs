import { describe, expect, test } from "bun:test";
import { AponiaError, Module, provideClass } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  MicroserviceClientsModule,
  microserviceClientToken,
  type MicroserviceClient,
  type MicroserviceClientConfig,
} from "../src/index.ts";
import type { Transport } from "../src/transport/transport.types.ts";

class FakeClient implements MicroserviceClient {
  readonly name = "fake-client";
  readonly target = "default";
  connects = 0;
  closes = 0;

  async connect(): Promise<void> {
    this.connects += 1;
  }

  async send<T = unknown>(): Promise<T> {
    return 1 as T;
  }

  async emit(): Promise<void> {}

  async close(): Promise<void> {
    this.closes += 1;
  }
}

class FakeTransport implements Transport {
  readonly name = "fake-transport";
  connected = false;
  closed = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async publish(): Promise<void> {}

  async subscribe(): Promise<{ close(): void }> {
    return { close: () => undefined };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe("MicroserviceClientsModule", () => {
  test("provides one client and connects it during module init", async () => {
    const client = new FakeClient();

    @Module({ imports: [MicroserviceClientsModule.register({ client })] })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });
    try {
      expect(application.get(microserviceClientToken)).toBe(client);
      expect(client.connects).toBe(1);
    } finally {
      await application.close();
    }
    expect(client.closes).toBe(1);
  });

  test("leaves the client disconnected when autoConnect is false", async () => {
    const client = new FakeClient();

    @Module({
      imports: [MicroserviceClientsModule.register({ client, autoConnect: false })],
    })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });
    try {
      expect(application.get(microserviceClientToken)).toBe(client);
      expect(client.connects).toBe(0);
    } finally {
      await application.close();
    }
    expect(client.closes).toBe(1);
  });

  test("builds a client from configuration", async () => {
    const transport = new FakeTransport();
    const config: MicroserviceClientConfig = {
      transport,
      destination: "requests",
      replyTo: "replies.client",
    };

    @Module({
      imports: [MicroserviceClientsModule.register({ client: config, autoConnect: false })],
    })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const client = application.get(microserviceClientToken);
      expect(client.name).toBe("fake-transport");
      expect(client.target).toBe("default");
      expect(transport.connected).toBe(false);
    } finally {
      await application.close();
    }
    expect(transport.closed).toBe(true);
  });

  test("refuses an invalid registration", () => {
    const invalid = [{}, { client: {} }, { client: new FakeClient(), autoConnect: "yes" }];
    for (const options of invalid) {
      const failure = (() => {
        try {
          MicroserviceClientsModule.register(options as never);
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(AponiaError);
      expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    }
  });

  test("raises ambiguity when two registrations export the same token", async () => {
    class Consumer {
      constructor(readonly client: MicroserviceClient) {}
    }

    @Module({
      imports: [
        MicroserviceClientsModule.register({ client: new FakeClient() }),
        MicroserviceClientsModule.register({ client: new FakeClient() }),
      ],
      providers: [provideClass(Consumer, [microserviceClientToken])],
    })
    class RootModule {}

    const failure = await AponiaFactory.create(RootModule, { logger: false }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("AMBIGUOUS_PROVIDER");
  });
});
