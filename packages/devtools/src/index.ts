/**
 * The opt-in devtools surface for an AponiaJS application.
 *
 * The package is a leaf: nothing in the framework depends on it, and an
 * application imports it deliberately. `DevtoolsModule.register({ enabled })`
 * is the whole opt-in — a disabled registration mounts nothing at all, while an
 * enabled one serves, on loopback unless the registration names another host,
 * the API the rest of this barrel describes.
 */
export { DevtoolsModule } from "./module/devtools-module.ts";
export type { DevtoolsCaptureOptions, DevtoolsOptions } from "./module/devtools-module.types.ts";
export { resolveElysiaVersion, startDevtoolsServer } from "./server/devtools-server.ts";
export { devtoolsPathPrefix, routeRequest } from "./server/request-router.ts";
export { devtoolsContractVersion } from "./endpoints/meta.ts";
export { createLogBuffer, defaultLogBufferCapacity } from "./logging/log-buffer.ts";
export { tapLogBuffer } from "./logging/log-tap.ts";
export { createRequestBuffer, defaultRequestBufferCapacity } from "./requests/request-buffer.ts";
export { aponiaVersion } from "./version.ts";
export type {
  DevtoolsHandlers,
  DevtoolsRequestHandler,
  DevtoolsServer,
  DevtoolsServerOptions,
} from "./server/devtools-server.types.ts";
export type {
  AponiaAotController,
  AponiaAotGraph,
  AponiaAotHandler,
  AponiaAotInvoker,
  AponiaAotInvokers,
  AponiaAotPayload,
} from "./endpoints/aot.types.ts";
export type {
  AponiaArtifactStamps,
  AponiaGraphPayload,
  AponiaLogsPayload,
  AponiaMetaPayload,
  AponiaMountedRoute,
  AponiaRouteSource,
  AponiaRequestsPayload,
  AponiaRoutesPayload,
} from "./endpoints/payloads.types.ts";
export type { LogBuffer, LogEntry } from "./logging/log-buffer.types.ts";
export type { RequestBuffer, RequestRecord } from "./requests/request-buffer.types.ts";
export type {
  AponiaFlowFilter,
  AponiaFlowPayload,
  AponiaFlowRoute,
  AponiaFlowScope,
  AponiaFlowStage,
  AponiaFlowStageKind,
} from "./endpoints/flow.types.ts";
