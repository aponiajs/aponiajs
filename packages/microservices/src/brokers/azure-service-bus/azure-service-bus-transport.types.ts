import type { BrokerSdkLoader } from "../shared/broker-sdk.ts";

/** The options `azureServiceBusTransport` validates and freezes. */
export interface AzureServiceBusTransportOptions {
  /**
   * The Service Bus connection string.
   *
   * It is passed to the SDK unchanged and never appears in a failure, a
   * message, or a log line.
   */
  readonly connectionString: string;
  /** How many messages one receiver processes at once; defaults to 16. */
  readonly maxConcurrentCalls?: number;
  /** How long the SDK renews a message lock; defaults to 5 minutes. */
  readonly maxAutoLockRenewalDurationMs?: number;
  /** How long the client may take to load and construct; defaults to 10 seconds. */
  readonly connectTimeoutMs?: number;
  /** The name reported in failures; defaults to `azure-service-bus`. */
  readonly name?: string;
}

/** One received message the SDK hands to the process handler. */
export interface AzureSdkReceivedMessage {
  readonly body: Uint8Array;
  complete(): Promise<void>;
  abandon(): Promise<void>;
}

/** The context the SDK passes when receiving fails. */
export interface AzureSdkErrorHandlerArgs {
  readonly error?: unknown;
}

/** The handlers this adapter registers on one receiver. */
export interface AzureSdkMessageHandlers {
  processMessage(message: AzureSdkReceivedMessage): Promise<void>;
  processError(args: AzureSdkErrorHandlerArgs): Promise<void>;
}

/** The subscribe options this adapter passes. */
export interface AzureSdkSubscribeOptions {
  readonly autoCompleteMessages: boolean;
  readonly maxConcurrentCalls: number;
}

/** The receiver options this adapter passes. */
export interface AzureSdkReceiverOptions {
  readonly receiveMode: "peekLock";
  readonly maxAutoLockRenewalDurationInMs: number;
}

/** The subscription `receiver.subscribe` returns. */
export interface AzureSdkReceiverSubscription {
  close(): Promise<void>;
}

/** The receiver surface this adapter uses. */
export interface AzureSdkReceiver {
  subscribe(
    handlers: AzureSdkMessageHandlers,
    options: AzureSdkSubscribeOptions,
  ): AzureSdkReceiverSubscription;
  close(): Promise<void>;
}

/** One outbound message this adapter builds. */
export interface AzureSdkOutboundMessage {
  readonly body: Uint8Array;
}

/** The sender surface this adapter uses. */
export interface AzureSdkSender {
  sendMessages(message: AzureSdkOutboundMessage): Promise<void>;
  close(): Promise<void>;
}

/** The `ServiceBusClient` surface this adapter uses. */
export interface AzureSdkClient {
  createSender(queue: string): AzureSdkSender;
  createReceiver(queue: string, options: AzureSdkReceiverOptions): AzureSdkReceiver;
  close(): Promise<void>;
}

/** The module surface this adapter uses. */
export interface AzureSdkModule {
  readonly ServiceBusClient: new (connectionString: string, options?: unknown) => AzureSdkClient;
}

/** The test seam this adapter accepts instead of the literal SDK import. */
export type AzureSdkLoader = BrokerSdkLoader<AzureSdkModule>;
