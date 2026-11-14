# @aponiajs/microservices

Message-pattern microservices for AponiaJS. Controllers declare
`@MessagePattern()` request handlers and `@EventPattern()` event handlers; the
application boot compiles them once, and a transport carries CBOR v1 envelopes
between services.

```bash
bun add @aponiajs/microservices@alpha
```

Install one broker SDK beside the framework package. Every SDK is an optional
peer, so a service carries only the broker it uses.

| Transport         | SDK                    | Factory                    |
| ----------------- | ---------------------- | -------------------------- |
| NATS              | `nats`                 | `natsTransport`            |
| MQTT 5            | `mqtt`                 | `mqttTransport`            |
| RabbitMQ          | `rabbitmq-client`      | `rabbitmqTransport`        |
| Kafka             | `kafkajs`              | `kafkaTransport`           |
| Redis Streams     | `redis`                | `redisTransport`           |
| AWS SQS           | `@aws-sdk/client-sqs`  | `sqsTransport`             |
| Google Pub/Sub    | `@google-cloud/pubsub` | `pubSubTransport`          |
| Azure Service Bus | `@azure/service-bus`   | `azureServiceBusTransport` |

`InMemoryTransport` remains the process-local reference transport for tests and
modular monoliths.

## Serve requests

```ts
import { Controller, MessagePattern, Module, Payload } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { createMicroserviceServer, natsTransport } from "@aponiajs/microservices";

@Controller("orders")
class OrdersController {
  @MessagePattern("orders.findOne")
  findOne(@Payload("id") id: string) {
    return this.orders.findById(id);
  }
}

@Module({ controllers: [OrdersController] })
class AppModule {}

const transport = natsTransport({ servers: ["nats://127.0.0.1:4222"] });
const server = createMicroserviceServer({
  transport,
  subscriptions: [{ destination: "orders.requests", consumerGroup: "orders" }],
  target: "orders",
  replyDestinations: ["orders.replies.orders-1"],
});

const application = await AponiaFactory.create(AppModule, {
  microservices: [server],
});
```

The server checks the envelope target before dispatch and the reply destination
against its allowlist before it publishes. A handler that throws answers
`MESSAGE_HANDLER_ERROR`; the stack and cause stay in the application log.

## Call a service

```ts
import { createMicroserviceClient } from "@aponiajs/microservices";

const client = createMicroserviceClient({
  transport: natsTransport({ servers: ["nats://127.0.0.1:4222"] }),
  destination: "orders.requests",
  replyTo: "orders.replies.orders-1",
  target: "orders",
});

await client.connect();
const order = await client.send("orders.findOne", { id: "42" });
await client.emit("orders.created", { id: "42" });
```

`send` correlates a reply by request identifier, bounds pending calls, and
rejects at its timeout. `emit` waits only for the broker to accept the event. A
broker that separates a reply topic from its subscription — Google Pub/Sub —
uses `replySubscription` for the distinct subscription name.

## Adapters

Every adapter validates its options, loads its SDK lazily, connects once,
tracks its subscriptions, and is terminal after `close`. Connection strings,
credentials, payloads, and SDK failures never reach an error message.

- **NATS** uses subjects, an optional queue group, and the native reply field.
  Core NATS is at-most-once.
- **MQTT 5** requires a stable `clientId` and a persistent session; QoS 1 is
  used for requests and replies, and a consumer group becomes a shared
  subscription. The SDK has no manual acknowledgement, so the transport
  decision is ignored after the handler settles.
- **RabbitMQ** consumes queues with prefetch and publisher confirms. A
  `nack` requeues the delivery.
- **Kafka** commits the next offset only after a reply is published. A `nack`
  pauses that partition without committing past the failure; the lane resumes
  after restart. Topics and consumer groups must already exist.
- **Redis Streams** uses consumer groups, acknowledgement, and periodic
  `XAUTOCLAIM` reclamation. The transport stores the envelope as base64
  because Redis returns bulk strings as text.
- **AWS SQS** long-polls queues, deletes after a reply, and makes a failed
  message visible again. The 256 KiB SQS message limit applies.
- **Google Pub/Sub** publishes to a topic and consumes a subscription with flow
  control. Ack follows a successful reply; nack returns the delivery.
- **Azure Service Bus** uses peek-lock receivers, completes or abandons the
  message, and renews the lock while the handler runs.

The framework never provisions topics, queues, exchanges, subscriptions, or
dead-letter queues. Cloud reply destinations are operator-provisioned, and each
client should own a distinct reply destination so one service cannot consume
another caller's answer.

## Errors and limits

Framework failures use `AponiaError` with a stable code. Client calls report
`MicroserviceCallError`; the code is always the one the dispatcher or transport
answered with.

```ts
import { MicroserviceCallError } from "@aponiajs/microservices";

try {
  await client.send("orders.findOne", { id: "missing" });
} catch (error) {
  if (error instanceof MicroserviceCallError && error.code === "UNKNOWN_MESSAGE_PATTERN") {
    // no controller declared the pattern
  }
}
```

Defaults: target `default`, 10-second connect, 30-second request timeout,
1 MiB envelope, 1,000 in-flight messages, 1,000 pending calls, and a 5-second
close budget. No adapter claims exactly-once delivery, transactions, managed
dead-letter routing, or global ordering.
