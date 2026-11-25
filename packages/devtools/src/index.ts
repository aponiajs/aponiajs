/**
 * The opt-in devtools surface for an AponiaJS application.
 *
 * The package is a leaf: nothing in the framework depends on it, and an
 * application imports it deliberately. Registration is the whole opt-in:
 * `DevtoolsModule.forRoot({ enabled })` in a module's `imports`, with the beta
 * `register` alias kept for compatibility. A disabled registration mounts
 * nothing at all, while an enabled one serves, on the address the application
 * itself serves and under `/__devtools`, the API the rest of this barrel
 * describes.
 *
 * The surface is a controller and its request record is a neutral
 * `RequestLifecycleHook`, so one registration mounts the same way on every
 * platform.
 */
export { DevtoolsModule } from "./module/devtools.module.ts";
export type {
  DevtoolsCaptureOptions,
  DevtoolsOptions,
} from "./interfaces/devtools-module.interface.ts";
export { devtoolsPathPrefix, handleDevtoolsRequest } from "./server/request-router.ts";
export { devtoolsContractVersion } from "./endpoints/meta.ts";
export { createLogBuffer, defaultLogBufferCapacity } from "./logging/log-buffer.ts";
export { recordLogger } from "./logging/log-tap.ts";
export type { LogStream } from "./logging/log-tap.ts";
export { createRequestBuffer, defaultRequestBufferCapacity } from "./requests/request-buffer.ts";
export { aponiaVersion } from "./version.ts";
export { buildLinkableGraph } from "./endpoints/linkable-graph.ts";
export { resolveSourceCode } from "./source/source.resolver.ts";
export type {
  SourceCodeResult,
  SourceResolverOptions,
} from "./interfaces/source-resolver.interface.ts";
export type {
  DevtoolsGraphDiagnostics,
  DevtoolsGraphEdge,
  DevtoolsGraphEdgeType,
  DevtoolsGraphNode,
  DevtoolsGraphNodeType,
  LinkableGraphPayload,
} from "./interfaces/linkable-graph.interface.ts";
export type {
  DevtoolsHandlers,
  DevtoolsRequestHandler,
} from "./interfaces/devtools-server.interface.ts";
export type {
  AponiaBuildController,
  AponiaBuildGraph,
  AponiaBuildHandler,
  AponiaBuildInvoker,
  AponiaBuildInvokers,
  AponiaBuildPayload,
} from "./interfaces/aot.interface.ts";
export type {
  DevtoolsGatewayInspection,
  DevtoolsInspection,
  DevtoolsModuleInspection,
  DevtoolsProviderInspection,
  DevtoolsRouteInspection,
  DevtoolsRouteParameterInspection,
} from "./interfaces/inspection.interface.ts";
export type {
  AponiaArtifactStamps,
  AponiaGraphPayload,
  AponiaLogsPayload,
  AponiaMetaPayload,
  AponiaMountedRoute,
  AponiaRouteBinding,
  AponiaRequestsPayload,
  AponiaRoutesPayload,
} from "./interfaces/payloads.interface.ts";
export type { LogBuffer, LogEntry } from "./interfaces/log-buffer.interface.ts";
export type { RequestBuffer, RequestRecord } from "./interfaces/request-buffer.interface.ts";
export type {
  AponiaRouteTraceFilter,
  AponiaRouteTracePayload,
  AponiaRouteTrace,
  AponiaRouteStageScope,
  AponiaRouteStage,
  AponiaRouteStageKind,
} from "./interfaces/flow.interface.ts";
