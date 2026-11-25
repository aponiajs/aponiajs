import {
  AponiaError,
  Module,
  provideClass,
  provideFactory,
  type DynamicModule,
  type OnModuleDestroy,
  type OnModuleInit,
  type Provider,
} from "@aponiajs/common";
import { createMicroserviceClient } from "../client/microservice-client.ts";
import type { MicroserviceClient } from "../interfaces/microservice-client.interface.ts";
import {
  MICROSERVICE_CLIENTS_OPTIONS,
  microserviceClientToken,
} from "./microservice-clients.constants.ts";
import type { MicroserviceClientsModuleOptions } from "../interfaces/microservice-clients-module.interface.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type MicroserviceClientsModuleExtras,
  type MicroserviceClientsModuleRegistrationAsyncOptions,
  type MicroserviceClientsModuleSyncOptions,
} from "./microservice-clients.module-definition.ts";

/**
 * Provides one connected microservice client under `microserviceClientToken`.
 *
 * The module owns the client: `onModuleInit` connects it when `autoConnect` is
 * true, and `onModuleDestroy` closes it. Import one registration per module;
 * importing two registrations that export the same token raises the graph's
 * `AMBIGUOUS_PROVIDER` failure.
 */
@Module({})
export class MicroserviceClientsModule extends ConfigurableModuleClass {
  /**
   * Builds a client registration.
   *
   * @param options - A client instance or configuration, whether to connect at boot, and extras.
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
  static forRoot(options: MicroserviceClientsModuleSyncOptions): DynamicModule {
    resolveOptions(options);
    assertExtras(options);
    return registration(super.register(options));
  }

  /**
   * Builds a client registration whose options a factory, a class, or an
   * existing provider resolves.
   *
   * @param options - The imports, injected tokens, factory, extras, and extra providers.
   * @returns A frozen dynamic module an application imports.
   */
  static forRootAsync(options: MicroserviceClientsModuleRegistrationAsyncOptions): DynamicModule {
    assertExtras(options);
    return registration(super.registerAsync(options), options.extraProviders);
  }

  /**
   * Builds a client registration.
   *
   * @deprecated Use {@link MicroserviceClientsModule.forRoot}; retained for the beta line.
   */
  static override register(options: MicroserviceClientsModuleSyncOptions): DynamicModule {
    return MicroserviceClientsModule.forRoot(options);
  }

  /**
   * Builds a client registration whose options a factory resolves.
   *
   * @deprecated Use {@link MicroserviceClientsModule.forRootAsync}; retained for the beta line.
   */
  static override registerAsync(
    options: MicroserviceClientsModuleRegistrationAsyncOptions,
  ): DynamicModule {
    return MicroserviceClientsModule.forRootAsync(options);
  }
}

function registration(
  definition: DynamicModule,
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return Object.freeze({
    ...definition,
    module: MicroserviceClientsModule,
    imports: Object.freeze([...(definition.imports ?? [])]),
    controllers: Object.freeze([...(definition.controllers ?? [])]),
    providers: Object.freeze([
      ...(definition.providers ?? []),
      provideFactory(
        MICROSERVICE_CLIENTS_OPTIONS,
        [MODULE_OPTIONS_TOKEN],
        (options: MicroserviceClientsModuleOptions) => resolveOptions(options),
      ),
      provideFactory(
        microserviceClientToken,
        [MICROSERVICE_CLIENTS_OPTIONS],
        (options: { readonly client: MicroserviceClient }) => options.client,
      ),
      provideClass(MicroserviceClientsLifecycle, [
        microserviceClientToken,
        MICROSERVICE_CLIENTS_OPTIONS,
      ]),
      ...extraProviders,
    ]),
    exports: Object.freeze([MODULE_OPTIONS_TOKEN, microserviceClientToken]),
  });
}

function assertExtras(options: Partial<MicroserviceClientsModuleExtras>): void {
  if (options.isGlobal !== undefined && typeof options.isGlobal !== "boolean") {
    throw new AponiaError(
      "INVALID_MICROSERVICE_OPTIONS",
      "The microservice client registration is invalid: isGlobal must be a boolean.",
      {
        subject: "microservice client registration",
        issues: Object.freeze(["isGlobal must be a boolean"]),
      },
    );
  }
}

function resolveOptions(options: MicroserviceClientsModuleOptions): {
  readonly autoConnect: boolean;
  readonly client: MicroserviceClient;
} {
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
  return Object.freeze({ autoConnect, client });
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

/**
 * The class under the name `@nestjs/microservices` publishes.
 *
 * `ClientsModule.register` and `ClientsModule.registerAsync` are this class's
 * retained aliases; `forRoot` and `forRootAsync` are the canonical names.
 */
export { MicroserviceClientsModule as ClientsModule };
