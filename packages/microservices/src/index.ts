/** The in-process reference transport for one application. */
export { InMemoryTransport } from "./transport/in-memory-transport.ts";
/** The options the in-process reference transport accepts. */
export type { InMemoryTransportOptions } from "./transport/in-memory-transport.ts";
/** The failure a message call reports to its caller. */
export { MicroserviceCallError } from "./client/microservice-call-error.ts";
/** A client over one broker transport. */
export type { MicroserviceClient } from "./client/microservice-client.types.ts";
/** The options a broker client validates and freezes. */
export type { MicroserviceClientConfig } from "./client/microservice-client.types.ts";
/** A message-pattern server over one broker transport. */
export type { MicroserviceServer } from "./server/microservice-server.types.ts";
/** The options a broker server validates and freezes. */
export type { MicroserviceServerConfig } from "./server/microservice-server.types.ts";
/** Creates a client over one broker transport. */
export { createMicroserviceClient } from "./client/microservice-client.ts";
/** Creates a server an application accepts as a microservice transport. */
export { createMicroserviceServer } from "./server/microservice-server.ts";
/** The SDK-neutral seam a broker adapter implements. */
export type {
  Transport,
  TransportDecision,
  TransportHandler,
  TransportMessage,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "./transport/transport.types.ts";
/** Encodes one outbound request or event as a CBOR v1 envelope. */
export { encodeMicroserviceEnvelope } from "./envelope/microservice-envelope.ts";
/** Decodes and validates one CBOR v1 envelope. */
export { decodeMicroserviceEnvelope } from "./envelope/microservice-envelope.ts";
/** The wire envelope shapes a broker carries. */
export type {
  MicroserviceEnvelope,
  MicroserviceEnvelopeKind,
  MicroserviceEventEnvelope,
  MicroserviceOutboundEnvelope,
  MicroserviceReplyEnvelope,
  MicroserviceReplyFailureEnvelope,
  MicroserviceReplySuccessEnvelope,
  MicroserviceRequestEnvelope,
} from "./envelope/microservice-envelope.types.ts";
/** Provides one connected microservice client. */
export { MicroserviceClientsModule } from "./module/microservice-clients-module.ts";
/** The token a registered client resolves under. */
export { microserviceClientToken } from "./module/microservice-clients.constants.ts";
/** The options `MicroserviceClientsModule.register` accepts. */
export type { MicroserviceClientsModuleOptions } from "./module/microservice-clients-module.types.ts";
/** Creates a NATS transport. */
export { natsTransport } from "./brokers/nats/nats-transport.ts";
/** The options the NATS transport validates and freezes. */
export type { NatsTransportOptions } from "./brokers/nats/nats-transport.types.ts";
/** Creates an MQTT 5 transport. */
export { mqttTransport } from "./brokers/mqtt/mqtt-transport.ts";
/** The options the MQTT transport validates and freezes. */
export type { MqttTransportOptions } from "./brokers/mqtt/mqtt-transport.types.ts";
/** Creates a RabbitMQ transport. */
export { rabbitmqTransport } from "./brokers/rabbitmq/rabbitmq-transport.ts";
/** The options the RabbitMQ transport validates and freezes. */
export type { RabbitMqTransportOptions } from "./brokers/rabbitmq/rabbitmq-transport.types.ts";
/** Creates a Kafka transport. */
export { kafkaTransport } from "./brokers/kafka/kafka-transport.ts";
export { GrpcTransport, grpcTransport } from "./brokers/grpc/grpc-transport.ts";
export type { GrpcTransportOptions } from "./brokers/grpc/grpc-transport.ts";
/** The options the Kafka transport validates and freezes. */
export type { KafkaTransportOptions } from "./brokers/kafka/kafka-transport.types.ts";
/** Creates a Redis Streams transport. */
export { redisTransport } from "./brokers/redis/redis-transport.ts";
/** The options the Redis Streams transport validates and freezes. */
export type { RedisTransportOptions } from "./brokers/redis/redis-transport.types.ts";
/** Creates an AWS SQS transport. */
export { sqsTransport } from "./brokers/sqs/sqs-transport.ts";
/** The options the AWS SQS transport validates and freezes. */
export type { SqsTransportOptions } from "./brokers/sqs/sqs-transport.types.ts";
/** Creates a Google Pub/Sub transport. */
export { pubSubTransport } from "./brokers/pubsub/pubsub-transport.ts";
/** The options the Google Pub/Sub transport validates and freezes. */
export type { PubSubTransportOptions } from "./brokers/pubsub/pubsub-transport.types.ts";
/** Creates an Azure Service Bus transport. */
export { azureServiceBusTransport } from "./brokers/azure-service-bus/azure-service-bus-transport.ts";
/** The options the Azure Service Bus transport validates and freezes. */
export type { AzureServiceBusTransportOptions } from "./brokers/azure-service-bus/azure-service-bus-transport.types.ts";
