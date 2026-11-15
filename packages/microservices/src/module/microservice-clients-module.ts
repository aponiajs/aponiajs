import {
  AponiaError,
  Module,
  provideClass,
  provideFactory,
  provideValue,
  type DynamicModule,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@aponiajs/common";
import { createMicroserviceClient } from "../client/microservice-client.ts";
import type { MicroserviceClient } from "../client/microservice-client.types.ts";
import {
  MICROSERVICE_CLIENTS_OPTIONS,
  microserviceClientToken,
} from "./microservice-clients.constants.ts";
import type { MicroserviceClientsModuleOptions } from "./microservice-clients-module.types.ts";

/**
 * Provides one connected microservice client under `microserviceClientToken`.
 *
 * The module owns the client: `onModuleInit` connects it when `autoConnect` is
 * true, and `onModuleDestroy` closes it. Import one registration per module;
 * importing two registrations that export the same token raises the graph's
 * `AMBIGUOUS_PROVIDER` failure.
 */
@Module({})
export class MicroserviceClientsModule {
  /**
   * Builds a client registration.
   *
   * @param options - A client instance or configuration, and whether to connect at boot.
   * @returns A frozen dynamic module an application imports.
   * @throws `AponiaError` with `INVALID_MICROSERVICE_OPTIONS` when the options are invalid.
   *
   * @example
   * ```ts
   * @Module({
   *   imports: [
   *     MicroserviceClientsModule.register({
   *       client: {
   *         transport: natsTransport({ url: "nats://localhost:4222" }),
   *         destination: "aponia.orders.requests",
   *         replyTo: "aponia.orders.replies.orders-1",
   *       },
   *     }),
   *   ],
   * })
   * export class OrdersModule {}
   * ```
   */
  static register(options: MicroserviceClientsModuleOptions): DynamicModule {
    const client = resolveClient(options);
    const autoConnect = options?.autoConnect ?? true;
    if (typeof autoConnect !== "boolean") {
      throw new AponiaError(
        "INVALID_MICROSERVICE_OPTIONS",
        "The microservice client registration is invalid: autoConnect must be a boolean.",
        {
          subject: "microservice client registration",
          issues: Object.freeze(["autoConnect must be a boolean"]),
        },
      );
    }

    return Object.freeze({
      module: MicroserviceClientsModule,
      id: "MicroserviceClientsModule",
      instanceId: Symbol("MicroserviceClientsModule"),
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([
        provideValue(MICROSERVICE_CLIENTS_OPTIONS, Object.freeze({ autoConnect })),
        provideFactory(microserviceClientToken, [], () => client),
        provideClass(MicroserviceClientsLifecycle, [
          microserviceClientToken,
          MICROSERVICE_CLIENTS_OPTIONS,
        ]),
      ]),
      exports: Object.freeze([microserviceClientToken]),
    });
  }
}

class MicroserviceClientsLifecycle implements OnModuleInit, OnModuleDestroy {
  readonly #client: MicroserviceClient;
  readonly #autoConnect: boolean;

  constructor(client: MicroserviceClient, options: { readonly autoConnect: boolean }) {
    this.#client = client;
    this.#autoConnect = options.autoConnect;
  }

  async onModuleInit(): Promise<void> {
    if (this.#autoConnect) {
      await this.#client.connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.#client.close();
  }
}

function resolveClient(options: MicroserviceClientsModuleOptions): MicroserviceClient {
  const candidate = options?.client;
  if (isMicroserviceClient(candidate)) {
    return candidate;
  }
  if (typeof candidate === "object" && candidate !== null && "transport" in candidate) {
    return createMicroserviceClient(candidate);
  }
  throw new AponiaError(
    "INVALID_MICROSERVICE_OPTIONS",
    "The microservice client registration is invalid: client must be a client instance or configuration.",
    {
      subject: "microservice client registration",
      issues: Object.freeze(["client must be a client instance or configuration"]),
    },
  );
}

function isMicroserviceClient(value: unknown): value is MicroserviceClient {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as MicroserviceClient).connect === "function" &&
    typeof (value as MicroserviceClient).send === "function" &&
    typeof (value as MicroserviceClient).emit === "function" &&
    typeof (value as MicroserviceClient).close === "function"
  );
}
