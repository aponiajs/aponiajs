import type { BrokerSdkLoader } from "../shared/broker-sdk.ts";

/** The options `mqttTransport` validates and freezes. */
export interface MqttTransportOptions {
  /** The broker URL the client connects to; required. */
  readonly url: string;
  /**
   * The stable client identifier; required.
   *
   * The adapter connects with `clean: false`, so a stable identity is what
   * lets the broker resume the QoS 1 session after a reconnect.
   */
  readonly clientId: string;
  /** The user name the broker authenticates. */
  readonly username?: string;
  /** The password paired with `username`. */
  readonly password?: string;
  /**
   * The MQTT session-expiry interval in seconds; defaults to 86,400.
   *
   * Values above the protocol's 32-bit maximum are refused.
   */
  readonly sessionExpirySeconds?: number;
  /** How long one connect attempt may take; defaults to 10 seconds. */
  readonly connectTimeoutMs?: number;
  /** The name reported in failures and diagnostics; defaults to `mqtt`. */
  readonly name?: string;
}

/** The connect options this adapter passes to the MQTT client. */
export interface MqttSdkConnectOptions {
  readonly clientId: string;
  readonly username?: string;
  readonly password?: string;
  readonly clean: false;
  readonly reconnectPeriod: 0;
  readonly connectTimeout: number;
  readonly protocolVersion: 5;
  readonly properties: { readonly sessionExpiryInterval: number };
}

/** The publish options this adapter passes. */
export interface MqttSdkPublishOptions {
  readonly qos: 0 | 1 | 2;
}

/** The subscribe options this adapter passes. */
export interface MqttSdkSubscribeOptions {
  readonly qos: 0 | 1 | 2;
}

/** The client surface this adapter uses. */
export interface MqttSdkClient {
  publishAsync(
    topic: string,
    payload: Uint8Array,
    options?: MqttSdkPublishOptions,
  ): Promise<unknown>;
  subscribeAsync(topic: string, options?: MqttSdkSubscribeOptions): Promise<unknown>;
  unsubscribeAsync(topic: string): Promise<unknown>;
  endAsync(): Promise<void>;
  on(event: "connect" | "close", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "message", listener: (topic: string, payload: Uint8Array) => void): unknown;
  removeAllListeners?(event?: string): unknown;
}

/** The connect function one MQTT module namespace exposes. */
export interface MqttSdkNamespace {
  readonly connect?: (url: string, options?: MqttSdkConnectOptions) => MqttSdkClient;
}

/** The module surface this adapter uses. */
export interface MqttSdkModule extends MqttSdkNamespace {
  readonly default?: MqttSdkNamespace;
}

/** The test seam one adapter accepts instead of the literal SDK import. */
export type MqttSdkLoader = BrokerSdkLoader<MqttSdkModule>;
