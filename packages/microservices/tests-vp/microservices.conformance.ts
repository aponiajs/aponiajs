import { Controller, MessagePattern, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  azureServiceBusTransport,
  createMicroserviceClient,
  InMemoryTransport,
  kafkaTransport,
  mqttTransport,
  natsTransport,
  pubSubTransport,
  rabbitmqTransport,
  redisTransport,
  sqsTransport,
} from "../src/index.ts";
import type { Transport } from "../src/transport/transport.types.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

@Controller("math")
class MathController {
  @MessagePattern("math.double")
  double(value: number): number {
    return value * 2;
  }
}

@Module({ controllers: [MathController] })
class MathModule {}

test("answers a message through the in-memory transport", async () => {
  const transport = new InMemoryTransport();
  const application = await AponiaFactory.create(MathModule, {
    logger: false,
    microservices: [transport],
  });
  try {
    expect(await transport.send("math.double", 21)).toBe(42);
  } finally {
    await application.close();
  }
});

test("exposes every broker factory and validates its options", () => {
  expect(natsTransport({ name: "orders" }).name).toBe("orders");
  expect(pubSubTransport().name).toBe("gcp-pubsub");
  expect(mqttTransport({ url: "mqtt://localhost:1883", clientId: "orders" }).name).toBe("mqtt");
  expect(rabbitmqTransport({ url: "amqp://localhost:5672" }).name).toBe("rabbitmq");
  expect(kafkaTransport({ brokers: ["localhost:9092"], clientId: "orders" }).name).toBe("kafka");
  expect(redisTransport({ url: "redis://localhost:6379" }).name).toBe("redis");
  expect(sqsTransport({ region: "us-east-1" }).name).toBe("aws-sqs");
  expect(azureServiceBusTransport({ connectionString: "Endpoint=sb://local" }).name).toBe(
    "azure-service-bus",
  );
});

test("uses the reply subscription a client configuration names", async () => {
  const subscriptions: string[] = [];
  const transport: Transport = {
    name: "fake",
    async connect() {},
    async publish() {},
    async subscribe(subscription) {
      subscriptions.push(subscription.destination);
      return {
        close: () => undefined,
      };
    },
    async close() {},
  };
  const client = createMicroserviceClient({
    transport,
    destination: "requests",
    replyTo: "replies-topic",
    replySubscription: "replies-subscription",
  });
  await client.connect();
  expect(subscriptions).toEqual(["replies-subscription"]);
  await client.close();
});
