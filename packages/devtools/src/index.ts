/**
 * The opt-in devtools surface for an AponiaJS application.
 *
 * The package is a leaf: nothing in the framework depends on it, and an
 * application imports it deliberately. `DevtoolsModule.register({ enabled })`
 * is the whole opt-in — a disabled registration mounts nothing at all, while an
 * enabled one serves the loopback API the rest of this barrel describes.
 */
export { DevtoolsModule } from "./module/devtools-module.ts";
export type { DevtoolsOptions } from "./module/devtools-module.types.ts";
export { resolveElysiaVersion, startDevtoolsServer } from "./server/devtools-server.ts";
export { devtoolsPathPrefix, routeRequest } from "./server/request-router.ts";
export { devtoolsContractVersion } from "./endpoints/meta.ts";
export { aponiaVersion } from "./version.ts";
export type {
  DevtoolsHandlers,
  DevtoolsRequestHandler,
  DevtoolsServer,
  DevtoolsServerOptions,
} from "./server/devtools-server.types.ts";
export type {
  AponiaArtifactStamps,
  AponiaGraphPayload,
  AponiaMetaPayload,
} from "./endpoints/payloads.types.ts";
