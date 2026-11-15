import type {
  MicroserviceClient,
  MicroserviceClientConfig,
} from "../client/microservice-client.types.ts";

/** The options `MicroserviceClientsModule.register` accepts. */
export interface MicroserviceClientsModuleOptions {
  /** A client instance, or the configuration this module turns into one. */
  readonly client: MicroserviceClient | MicroserviceClientConfig;
  /** Whether the module connects at `onModuleInit`; defaults to true. */
  readonly autoConnect?: boolean;
}
