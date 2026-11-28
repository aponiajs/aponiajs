import { createToken } from "@aponiajs/common";
import type { MicroserviceClient } from "../interfaces/microservice-client.interface.ts";

/** The token a registered client resolves under. */
export const microserviceClientToken = createToken<MicroserviceClient>("AponiaMicroserviceClient");

/** The token carrying the resolved client and its lifecycle options. */
export const MICROSERVICE_CLIENTS_OPTIONS = createToken<{
  readonly autoConnect: boolean;
  readonly client: MicroserviceClient;
}>("AponiaMicroserviceClientsOptions");
