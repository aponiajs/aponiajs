import { createToken } from "@aponiajs/common";
import type { MicroserviceClient } from "../client/microservice-client.types.ts";

/** The token a registered client resolves under. */
export const microserviceClientToken = createToken<MicroserviceClient>("AponiaMicroserviceClient");

/** The token carrying the registration's lifecycle options. */
export const MICROSERVICE_CLIENTS_OPTIONS = createToken<{ readonly autoConnect: boolean }>(
  "AponiaMicroserviceClientsOptions",
);
