import type { ModuleAsyncOptions } from "@aponiajs/common";
import type {
  MicroserviceClient,
  MicroserviceClientConfig,
} from "./microservice-client.interface.ts";

/** The options `MicroserviceClientsModule.register` accepts. */
export interface MicroserviceClientsModuleOptions {
  /** A client instance, or the configuration this module turns into one. */
  readonly client: MicroserviceClient | MicroserviceClientConfig;
  /** Whether the module connects at `onModuleInit`; defaults to true. */
  readonly autoConnect?: boolean;
}

/** The registration options a factory supplies. */
export type MicroserviceClientsModuleAsyncOptions =
  ModuleAsyncOptions<MicroserviceClientsModuleOptions>;
