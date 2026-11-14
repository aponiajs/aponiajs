import { expect, test } from "bun:test";
import {
  createMicroserviceClient,
  createMicroserviceServer,
  kafkaTransport,
  mqttTransport,
  natsTransport,
  rabbitmqTransport,
  redisTransport,
  sqsTransport,
} from "../src/index.ts";
import type { Transport } from "../src/transport/transport.types.ts";

/**
 * Live broker checks.
 *
 * Bun's default test glob skips `*.e2e-spec.ts`. `bun run test:brokers` runs this
 * file explicitly, and every case is skipped unless `APONIA_BROKER_E2E=1` so a
 * developer without a broker never fails the lane.
 */
const liveTest = process.env.APONIA_BROKER_E2E === "1" ? test : test.skip;
const suffix = crypto.randomUUID().slice(0, 8);

async function roundTrip(
  serverTransport: Transport,
  clientTransport: Transport,
  requestDestination: string,
  replyDestination: string,
  consumerGroup?: string,
): Promise<void> {
  const server = createMicroserviceServer({
    transport: serverTransport,
    subscriptions: [
      {
        destination: requestDestination,
        ...(consumerGroup === undefined ? {} : { consumerGroup }),
      },
    ],
    replyDestinations: [replyDestination],
  });
  const client = createMicroserviceClient({
    transport: clientTransport,
    destination: requestDestination,
    replyTo: replyDestination,
    requestTimeoutMs: 10_000,
    connectTimeoutMs: 10_000,
  });

  await server.subscribe(async (message) => ({ ok: true, value: message.data }));
  await client.connect();
  try {
    expect(await client.send("e2e.echo", { id: "1" })).toEqual({ id: "1" });
    await client.emit("e2e.event", { id: "2" });
  } finally {
    await client.close();
    await server.close();
  }
}

liveTest("answers a request and accepts an event through NATS", async () => {
  const url = process.env.APONIA_NATS_URL ?? "nats://127.0.0.1:4222";
  await roundTrip(
    natsTransport({ servers: [url], name: `e2e-nats-server-${suffix}` }),
    natsTransport({ servers: [url], name: `e2e-nats-client-${suffix}` }),
    `aponia.e2e.${suffix}.requests`,
    `aponia.e2e.${suffix}.replies`,
  );
});

liveTest("answers a request and accepts an event through MQTT", async () => {
  const url = process.env.APONIA_MQTT_URL ?? "mqtt://127.0.0.1:1883";
  await roundTrip(
    mqttTransport({
      url,
      clientId: `aponia-e2e-server-${suffix}`,
      sessionExpirySeconds: 60,
    }),
    mqttTransport({
      url,
      clientId: `aponia-e2e-client-${suffix}`,
      sessionExpirySeconds: 60,
    }),
    `aponia/e2e/${suffix}/requests`,
    `aponia/e2e/${suffix}/replies`,
  );
});

liveTest("answers a request and accepts an event through Redis Streams", async () => {
  const url = process.env.APONIA_REDIS_URL ?? "redis://127.0.0.1:6379";
  await roundTrip(
    redisTransport({ url, consumerGroup: `e2e-server-${suffix}` }),
    redisTransport({ url }),
    `aponia:e2e:${suffix}:requests`,
    `aponia:e2e:${suffix}:replies`,
    `e2e-workers-${suffix}`,
  );
});

liveTest("answers a request and accepts an event through Kafka", async () => {
  const brokers = (process.env.APONIA_KAFKA_BROKERS ?? "127.0.0.1:9092").split(",");
  await roundTrip(
    kafkaTransport({
      brokers,
      clientId: `aponia-e2e-server-${suffix}`,
      groupId: `aponia-e2e-server-${suffix}`,
    }),
    kafkaTransport({
      brokers,
      clientId: `aponia-e2e-client-${suffix}`,
      groupId: `aponia-e2e-client-${suffix}`,
    }),
    `aponia.e2e.${suffix}.requests`,
    `aponia.e2e.${suffix}.replies`,
  );
});

liveTest("answers a request and accepts an event through RabbitMQ", async () => {
  const url = process.env.APONIA_RABBITMQ_URL ?? "amqp://guest:guest@127.0.0.1:5672";
  await roundTrip(
    rabbitmqTransport({ url }),
    rabbitmqTransport({ url }),
    `aponia.e2e.${suffix}.requests`,
    `aponia.e2e.${suffix}.replies`,
  );
});

const sqsEndpoint = process.env.APONIA_SQS_ENDPOINT;
const liveSqsTest = sqsEndpoint === undefined ? test.skip : liveTest;

liveSqsTest("answers a request and accepts an event through SQS", async () => {
  process.env.AWS_ACCESS_KEY_ID ??= "test";
  process.env.AWS_SECRET_ACCESS_KEY ??= "test";
  const region = process.env.APONIA_SQS_REGION ?? "us-east-1";

  const { CreateQueueCommand, SQSClient } = await import("@aws-sdk/client-sqs");
  const client = new SQSClient({ region, endpoint: sqsEndpoint });
  const requests = await client.send(
    new CreateQueueCommand({ QueueName: `aponia-e2e-${suffix}-requests` }),
  );
  const replies = await client.send(
    new CreateQueueCommand({ QueueName: `aponia-e2e-${suffix}-replies` }),
  );

  await roundTrip(
    sqsTransport({ region, endpoint: sqsEndpoint, waitTimeSeconds: 1 }),
    sqsTransport({ region, endpoint: sqsEndpoint, waitTimeSeconds: 1 }),
    requests.QueueUrl!,
    replies.QueueUrl!,
  );
});
