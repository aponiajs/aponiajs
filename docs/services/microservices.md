# Microservices

An Aponia application can answer messages beside its HTTP routes. A controller
method decorated with `@MessagePattern()` answers a request; `@EventPattern()`
observes an event. The boot compiles both into one immutable handler table, and
a transport delivers messages to it.

```ts
import { Controller, EventPattern, MessagePattern, Module, Payload } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { createMicroserviceServer, natsTransport } from "@aponiajs/microservices";

@Controller("orders")
class OrdersController {
  @MessagePattern("orders.findOne")
  findOne(@Payload("id") id: string) {
    return this.orders.findById(id);
  }

  @EventPattern("orders.created")
  created(@Payload("id") id: string) {
    this.audit.record(id);
  }
}

@Module({ controllers: [OrdersController] })
class AppModule {}

const server = createMicroserviceServer({
  transport: natsTransport({ servers: ["nats://127.0.0.1:4222"] }),
  subscriptions: [{ destination: "orders.requests", consumerGroup: "orders" }],
  target: "orders",
  replyDestinations: ["orders.replies.orders-1"],
});

const application = await AponiaFactory.create(AppModule, {
  microservices: [server],
});
```

Handlers are ordinary controller instances and inject services the same way
HTTP handlers do. A handler receives the whole payload by default, or the
property `@Payload("key")` names. Patterns accept a number and are normalized
with `String()`, so `@MessagePattern(7)` answers `send(7)`.

## Two layers

The application boot accepts a `MicroserviceTransport` from
`@aponiajs/common`:

```ts
interface MicroserviceTransport {
  readonly name: string;
  subscribe(handler: MicroserviceHandler): Promise<void> | void;
  close(): Promise<void> | void;
}
```

`@aponiajs/microservices` implements that contract twice. `InMemoryTransport`
serves one process. `createMicroserviceServer` wraps a broker `Transport` — an
SDK-neutral seam with `connect`, `publish`, `subscribe`, and `close` — and adds
envelope decoding, target checks, reply allowlists, in-flight limits, and
settlement decisions. `createMicroserviceClient` wraps the same seam and adds
correlation, timeouts, and pending-call bounds.

The broker seam is deliberately smaller than the boot contract: a client and a
server share one adapter, while each application owns its own boot transport.
An adapter publishes and receives bytes, nothing more.

## Wire contract

Every message is a CBOR v1 envelope with strict keys, a 1 MiB limit, depth 32,
and a 100,000-item bound:

```ts
type Outbound =
  | {
      v: 1;
      kind: "request";
      id: string;
      pattern: string;
      data: unknown;
      target: string;
      replyTo: string;
    }
  | {
      v: 1;
      kind: "event";
      id: string;
      pattern: string;
      data: unknown;
      target: string;
    };
```

A reply names the request identifier and carries either `value` or a
`{ code, message }` failure. The client accepts only a reply whose identifier
is pending, so an unrelated or duplicated delivery is acknowledged and
discarded. The server answers a malformed request with
`INVALID_MICROSERVICE_ENVELOPE` only when its identifier and reply destination
are readable and the destination is allowed.

## Request and reply

```ts
import { createMicroserviceClient } from "@aponiajs/microservices";

const client = createMicroserviceClient({
  transport: natsTransport({ servers: ["nats://127.0.0.1:4222"] }),
  destination: "orders.requests",
  replyTo: "orders.replies.orders-1",
  target: "orders",
  requestTimeoutMs: 15_000,
});

await client.connect();
const order = await client.send("orders.findOne", { id: "42" });
await client.emit("orders.created", { id: "42" });
```

`send` returns the handler's value and rejects with `MicroserviceCallError`
when the reply fails, the request times out, the client has no pending capacity,
or the transport cannot publish. `emit` waits only for the broker to accept the
event; a broker event has no response.

The client subscribes to `replySubscription` when a broker separates the reply
publication destination from the subscription that receives it. Google Pub/Sub
is the case that needs it: `replyTo` names the reply topic, and
`replySubscription` names this client's own subscription.

## Adapters

Each broker SDK is an optional peer. Install the framework package and only the
SDK the service uses; a missing peer fails at `connect` with
`MICROSERVICE_TRANSPORT_UNAVAILABLE` and names the package.

| Factory                    | Transport           | SDK                    |
| -------------------------- | ------------------- | ---------------------- |
| `natsTransport`            | `nats`              | `nats`                 |
| `mqttTransport`            | `mqtt`              | `mqtt`                 |
| `rabbitmqTransport`        | `rabbitmq`          | `rabbitmq-client`      |
| `kafkaTransport`           | `kafka`             | `kafkajs`              |
| `redisTransport`           | `redis`             | `redis`                |
| `sqsTransport`             | `aws-sqs`           | `@aws-sdk/client-sqs`  |
| `pubSubTransport`          | `gcp-pubsub`        | `@google-cloud/pubsub` |
| `azureServiceBusTransport` | `azure-service-bus` | `@azure/service-bus`   |
| `grpcTransport`            | `grpc`              | `@grpc/grpc-js`        |

Every adapter validates its own options before a connection opens, loads its SDK
only inside `connect`, tracks its subscriptions, and is terminal after
`close`. Connection strings, credentials, payloads, and SDK causes never reach
an error message or a structured detail.

Broker behavior differs where the protocol does:

- MQTT uses QoS 1 with a persistent session and cannot acknowledge manually;
  the SDK settles a delivery when its message event is handled.
- RabbitMQ maps a `nack` to requeue and uses publisher confirms.
- Kafka commits the next offset only after a reply is published. A `nack`
  pauses the partition without committing past the failure; the lane resumes
  after restart. Topics must pre-exist.
- Redis Streams acknowledges with `XACK` and reclaims stale pending entries
  with `XAUTOCLAIM`. Envelopes are base64 in stream fields because Redis
  returns bulk strings as text.
- SQS long-polls and deletes after a reply; a `nack` makes the message visible
  immediately. The 256 KiB SQS limit applies.
- Pub/Sub publishes to a topic and consumes a subscription; ack follows a
  successful reply and nack returns the delivery.
- Service Bus completes or abandons a peek-lock message and renews the lock
  while the handler runs.
- gRPC is a direct connection rather than a broker: one transport hosts the
  generic Aponia service with `listen` and the other dials it with `address`.
  A client publishes with the unary `Publish` and receives with a
  server-streaming `Subscribe`; replies travel back over that stream.

The framework never provisions topics, queues, exchanges, subscriptions, or
dead-letter queues. Cloud reply destinations are operator-provisioned, and each
client should own a distinct reply destination.

## Targets and isolation

`target` separates services that share a broker. A server answers a request
only when the envelope names its target; it replies
`INVALID_MICROSERVICE_MESSAGE` for another target. An event for another target
is dropped without invoking a handler.

`replyDestinations` is an exact allowlist. When it is set, the server publishes
a reply only to a member, so a producer cannot redirect answers to an arbitrary
queue. Deployments that accept untrusted producers should always set it.
`consumerGroup` maps to a NATS queue group, an MQTT shared subscription, a
Kafka or Redis consumer group, or a Pub/Sub subscription identity. Events are
load-balanced, never broadcast.

## Lifecycle

The boot starts transports after all providers and controllers exist and after
`onApplicationBootstrap`, so the first message cannot reach a half-built graph.
`application.close()` closes transports after the native server stops and before
module-destroy hooks. A transport that refuses to start fails the boot, and the
transports already started are closed first.

A broker transport is terminal after `close`: a second `connect` refuses with
`MICROSERVICE_TRANSPORT_UNAVAILABLE`. `InMemoryTransport` is reusable after its
application ends.

## Security and limits

Authentication, authorization, and payload validation belong to the service,
not to the envelope. A transport accepts what its broker accepted; a service
that accepts untrusted producers must authorize before dispatch and should
validate each handler's input.

Defaults are a `default` target, 10-second connect, 30-second request timeout,
1 MiB envelope, 1,000 in-flight messages, 1,000 pending calls, and a 5-second
close budget. No adapter claims exactly-once delivery, transactions, managed
dead-letter routing, or global ordering. Only decorated controllers contribute
handlers; a controller declared through the low-level descriptor API carries no
message metadata.
