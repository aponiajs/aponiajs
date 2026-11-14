import type { BrokerSdkLoader } from "../shared/broker-sdk.ts";

/** The options `sqsTransport` validates and freezes. */
export interface SqsTransportOptions {
  /** The AWS region every request is signed for. */
  readonly region: string;
  /** A custom endpoint, such as a local emulator; defaults to the AWS endpoint. */
  readonly endpoint?: string;
  /** How long one receive call long-polls; 0-20 seconds, defaults to 20. */
  readonly waitTimeSeconds?: number;
  /** How long a delivered message is hidden from other consumers; 0-43200 seconds, defaults to 30. */
  readonly visibilityTimeoutSeconds?: number;
  /** How many messages one receive call asks for; 1-10, defaults to 10. */
  readonly maxMessages?: number;
  /** How long the client may take to load and construct; defaults to 10 seconds. */
  readonly connectTimeoutMs?: number;
  /** The name reported in failures; defaults to `aws-sqs`. */
  readonly name?: string;
}

/** The client configuration this adapter passes to `SQSClient`. */
export interface SqsSdkClientConfig {
  readonly region: string;
  readonly endpoint?: string;
}

/** The receive options this adapter passes to `send`. */
export interface SqsSdkSendOptions {
  readonly abortSignal?: AbortSignal;
}

/** One message `ReceiveMessageCommand` returns. */
export interface SqsDeliveredMessage {
  readonly Body?: string;
  readonly ReceiptHandle?: string;
}

/** The `ReceiveMessageCommand` output this adapter reads. */
export interface SqsReceiveMessageOutput {
  readonly Messages?: readonly SqsDeliveredMessage[];
}

/** The `SQSClient` surface this adapter uses. */
export interface SqsSdkClient {
  send(command: unknown, options?: SqsSdkSendOptions): Promise<unknown>;
  destroy?(): void;
}

/** The `SendMessageCommand` input this adapter builds. */
export interface SqsSendMessageInput {
  readonly QueueUrl: string;
  readonly MessageBody: string;
}

/** The `ReceiveMessageCommand` input this adapter builds. */
export interface SqsReceiveMessageInput {
  readonly QueueUrl: string;
  readonly MaxNumberOfMessages: number;
  readonly WaitTimeSeconds: number;
  readonly VisibilityTimeout: number;
}

/** The `DeleteMessageCommand` input this adapter builds. */
export interface SqsDeleteMessageInput {
  readonly QueueUrl: string;
  readonly ReceiptHandle: string;
}

/** The `ChangeMessageVisibilityCommand` input this adapter builds. */
export interface SqsChangeMessageVisibilityInput {
  readonly QueueUrl: string;
  readonly ReceiptHandle: string;
  readonly VisibilityTimeout: number;
}

/** The module surface this adapter uses. */
export interface SqsSdkModule {
  readonly SQSClient: new (config: SqsSdkClientConfig) => SqsSdkClient;
  readonly SendMessageCommand: new (input: SqsSendMessageInput) => unknown;
  readonly ReceiveMessageCommand: new (input: SqsReceiveMessageInput) => unknown;
  readonly DeleteMessageCommand: new (input: SqsDeleteMessageInput) => unknown;
  readonly ChangeMessageVisibilityCommand: new (input: SqsChangeMessageVisibilityInput) => unknown;
}

/** The test seam this adapter accepts instead of the literal SDK import. */
export type SqsSdkLoader = BrokerSdkLoader<SqsSdkModule>;
