import { AponiaError } from "@aponiajs/common";
import type {
  ClientReadableStream,
  Server,
  ServerUnaryCall,
  ServerWritableStream,
  ServiceDefinition,
  ServiceError,
} from "@grpc/grpc-js";
import type {
  Transport,
  TransportHandler,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "../../transport/transport.types.ts";

/** Options for one gRPC transport. */
export interface GrpcTransportOptions {
  /** The `host:port` the transport hosts; omit it on a client transport. */
  readonly listen?: string;
  /** The `host:port` a client transport dials; omit it on a server transport. */
  readonly address?: string;
  /** The name reported in failures; defaults to `grpc`. */
  readonly name?: string;
  /** Receives the bound address once a listening transport starts. */
  readonly onListen?: (address: string) => void;
}

interface PublishRequest {
  readonly destination: string;
  readonly payload: string;
}

interface SubscribeRequest {
  readonly destination: string;
}

interface WireMessage {
  readonly destination: string;
  readonly payload: string;
}

interface GrpcClient {
  publish(request: PublishRequest, callback: (error: ServiceError | null) => void): void;
  subscribe(request: SubscribeRequest): ClientReadableStream<WireMessage>;
  close?(): void;
}

type GrpcModule = typeof import("@grpc/grpc-js");

const serviceDefinition = {
  publish: {
    path: "/aponia.transport.Grpc/Publish",
    requestStream: false,
    responseStream: false,
    requestSerialize: (value: PublishRequest) => Buffer.from(JSON.stringify(value)),
    requestDeserialize: (value: Buffer) => JSON.parse(value.toString("utf8")) as PublishRequest,
    responseSerialize: (value: unknown) => Buffer.from(JSON.stringify(value)),
    responseDeserialize: (value: Buffer) => JSON.parse(value.toString("utf8")) as unknown,
  },
  subscribe: {
    path: "/aponia.transport.Grpc/Subscribe",
    requestStream: false,
    responseStream: true,
    requestSerialize: (value: SubscribeRequest) => Buffer.from(JSON.stringify(value)),
    requestDeserialize: (value: Buffer) => JSON.parse(value.toString("utf8")) as SubscribeRequest,
    responseSerialize: (value: WireMessage) => Buffer.from(JSON.stringify(value)),
    responseDeserialize: (value: Buffer) => JSON.parse(value.toString("utf8")) as WireMessage,
  },
} as unknown as ServiceDefinition;

/**
 * A gRPC transport: a unary `Publish` and a server-streaming `Subscribe`.
 *
 * It is deliberately a generic Aponia service rather than an application's own
 * proto: the transport carries encoded envelopes, so one service serves every
 * application. A transport with `listen` hosts the service and forward messages
 * published to it to the subscriptions on it; a transport with `address` dials
 * that service. A reply travels the other way over the same pair of calls,
 * which is what lets one server and one client round-trip without a broker.
 */
export class GrpcTransport implements Transport {
  readonly name: string;
  readonly #options: GrpcTransportOptions;
  #server: Server | undefined;
  #client: GrpcClient | undefined;
  #connected = false;
  #closed = false;
  readonly #localHandlers = new Map<string, Set<TransportHandler>>();
  readonly #clientStreams = new Map<
    string,
    Set<ServerWritableStream<SubscribeRequest, WireMessage>>
  >();
  readonly #openStreams = new Set<ClientReadableStream<WireMessage>>();

  constructor(options: GrpcTransportOptions) {
    if (
      (options.listen === undefined || options.listen.trim() === "") &&
      (options.address === undefined || options.address.trim() === "")
    ) {
      throw new AponiaError(
        "INVALID_MICROSERVICE_OPTIONS",
        'A gRPC transport requires either "listen" or "address".',
        { issues: Object.freeze(['one of "listen" or "address" is required']) },
      );
    }

    this.#options = options;
    this.name = options.name ?? "grpc";
    Object.freeze(this);
  }

  get address(): string | undefined {
    return this.#options.listen ?? this.#options.address;
  }

  async connect(): Promise<void> {
    if (this.#connected) {
      return;
    }
    if (this.#closed) {
      throw new AponiaError("INVALID_MICROSERVICE_TRANSPORT", "The gRPC transport is closed.");
    }

    const grpc = await loadGrpc();

    if (this.#options.listen !== undefined) {
      await this.#startServer(grpc, this.#options.listen);
    }
    if (this.#options.address !== undefined) {
      const ClientConstructor = grpc.makeGenericClientConstructor(
        serviceDefinition,
        "AponiaGrpcTransport",
      );
      this.#client = new ClientConstructor(
        this.#options.address,
        grpc.credentials.createInsecure(),
      ) as unknown as GrpcClient;
    }

    this.#connected = true;
  }

  async publish(destination: string, payload: Uint8Array): Promise<void> {
    this.#requireConnected();
    const message: WireMessage = {
      destination,
      payload: Buffer.from(payload).toString("base64"),
    };

    if (this.#client !== undefined) {
      await new Promise<void>((resolve, reject) => {
        this.#client!.publish(message, (error) => {
          if (error === null) {
            resolve();
          } else {
            reject(
              new AponiaError("INVALID_MICROSERVICE_TRANSPORT", "The gRPC publish failed.", {
                transport: this.name,
                operation: "publish",
              }),
            );
          }
        });
      });
      return;
    }

    await this.#deliverToLocal(destination, message.payload);
    this.#deliverToClientStreams(destination, message);
  }

  async subscribe(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle> {
    this.#requireConnected();
    const destination = subscription.destination;

    let handlers = this.#localHandlers.get(destination);
    if (handlers === undefined) {
      handlers = new Set();
      this.#localHandlers.set(destination, handlers);
    }
    handlers.add(handler);

    let stream: ClientReadableStream<WireMessage> | undefined;
    if (this.#client !== undefined) {
      stream = this.#client.subscribe({ destination });
      this.#openStreams.add(stream);
      stream.on("data", (message: WireMessage) => {
        void this.#deliverToHandlers(destination, message.payload);
      });
      stream.on("error", () => {
        this.#openStreams.delete(stream as ClientReadableStream<WireMessage>);
      });
    }

    const localHandlers = handlers;
    return Object.freeze({
      close: () => {
        localHandlers.delete(handler);
        if (stream !== undefined) {
          this.#openStreams.delete(stream);
          stream.cancel();
        }
      },
    });
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;

    for (const stream of this.#openStreams) {
      stream.cancel();
    }
    this.#openStreams.clear();
    this.#client?.close?.();
    this.#server?.forceShutdown();
    this.#localHandlers.clear();
    this.#clientStreams.clear();
  }

  async #startServer(grpc: GrpcModule, listen: string): Promise<void> {
    const server = new grpc.Server();
    server.addService(serviceDefinition, {
      publish: (
        call: ServerUnaryCall<PublishRequest, unknown>,
        callback: (error: Error | null, value?: unknown) => void,
      ) => {
        const { destination, payload } = call.request;
        void this.#deliverToLocal(destination, payload)
          .then(() => callback(null, {}))
          .catch(() => callback(new Error("The gRPC message could not be dispatched.")));
      },
      subscribe: (call: ServerWritableStream<SubscribeRequest, WireMessage>) => {
        const destination = call.request.destination;
        let streams = this.#clientStreams.get(destination);
        if (streams === undefined) {
          streams = new Set();
          this.#clientStreams.set(destination, streams);
        }
        streams.add(call);
        const remove = (): void => {
          streams?.delete(call);
        };
        call.on("cancelled", remove);
        call.on("close", remove);
      },
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync(listen, grpc.ServerCredentials.createInsecure(), (error, boundPort) => {
        if (error === null) {
          resolve(boundPort);
        } else {
          reject(
            new AponiaError(
              "INVALID_MICROSERVICE_TRANSPORT",
              "The gRPC server could not bind its address.",
              { transport: this.name, operation: "bind" },
            ),
          );
        }
      });
    });

    this.#server = server;
    this.#options.onListen?.(`${listenHost(listen)}:${port}`);
  }

  #requireConnected(): void {
    if (!this.#connected) {
      throw new AponiaError(
        "INVALID_MICROSERVICE_TRANSPORT",
        `Transport "${this.name}" is not connected.`,
        { transport: this.name },
      );
    }
    if (this.#closed) {
      throw new AponiaError(
        "INVALID_MICROSERVICE_TRANSPORT",
        `Transport "${this.name}" is closed.`,
        { transport: this.name },
      );
    }
  }

  async #deliverToLocal(destination: string, payload: string): Promise<void> {
    await this.#deliverToHandlers(destination, payload);
  }

  async #deliverToHandlers(destination: string, payload: string): Promise<void> {
    const handlers = this.#localHandlers.get(destination);
    if (handlers === undefined) {
      return;
    }
    const bytes = Uint8Array.from(Buffer.from(payload, "base64"));
    for (const handler of handlers) {
      await handler({ payload: bytes });
    }
  }

  #deliverToClientStreams(destination: string, message: WireMessage): void {
    const streams = this.#clientStreams.get(destination);
    if (streams === undefined) {
      return;
    }
    for (const stream of streams) {
      stream.write(message);
    }
  }
}

/** The command `aponia` runs: one transport that publishes and subscribes. */
export function grpcTransport(options: GrpcTransportOptions): GrpcTransport {
  return new GrpcTransport(options);
}

async function loadGrpc(): Promise<GrpcModule> {
  try {
    return await import("@grpc/grpc-js");
  } catch {
    throw new AponiaError(
      "INVALID_MICROSERVICE_TRANSPORT",
      'The gRPC transport requires the optional "grpc" SDK: install "@grpc/grpc-js".',
      { transport: "grpc", package: "@grpc/grpc-js" },
    );
  }
}

function listenHost(listen: string): string {
  const separator = listen.lastIndexOf(":");
  return separator < 0 ? listen : listen.slice(0, separator) || "127.0.0.1";
}
