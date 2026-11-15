/**
 * The opt-in devtools surface for an AponiaJS application.
 *
 * The package is a leaf: nothing in the framework depends on it, and an
 * application imports it deliberately. Registration is the whole opt-in, and it
 * has two spellings that mount the same plugin: `DevtoolsModule.register({
 * enabled })` in a module's `imports`, and `devtoolsPlugin({ enabled })` in
 * `AponiaFactory.create`'s `plugins` option. A disabled registration mounts
 * nothing at all, while an enabled one serves, on the address the application
 * itself serves and under `/__devtools`, the API the rest of this barrel
 * describes.
 */
export { DevtoolsModule, devtoolsPlugin } from "./module/devtools-module.ts";
export type { DevtoolsCaptureOptions, DevtoolsOptions } from "./module/devtools-module.types.ts";
export { resolvePeerVersion } from "./server/devtools-server.ts";
export { devtoolsPathPrefix, handleDevtoolsRequest } from "./server/request-router.ts";
export { devtoolsContractVersion } from "./endpoints/meta.ts";
export { createLogBuffer, defaultLogBufferCapacity } from "./logging/log-buffer.ts";
export { recordLogger } from "./logging/log-tap.ts";
export type { LogStream } from "./logging/log-tap.ts";
export { createRequestBuffer, defaultRequestBufferCapacity } from "./requests/request-buffer.ts";
export { aponiaVersion } from "./version.ts";
export { buildLinkableGraph } from "./endpoints/linkable-graph.ts";
export { createDevtoolsMcpServer, devtoolsMcpPath } from "./mcp/mcp-server.ts";
export { resolveSourceCode } from "./source/source-resolver.ts";
export type { SourceCodeResult, SourceResolverOptions } from "./source/source-resolver.types.ts";
export type {
  DevtoolsGraphDiagnostics,
  DevtoolsGraphEdge,
  DevtoolsGraphEdgeType,
  DevtoolsGraphNode,
  DevtoolsGraphNodeType,
  LinkableGraphPayload,
} from "./endpoints/linkable-graph.types.ts";
export type { DevtoolsHandlers, DevtoolsRequestHandler } from "./server/devtools-server.types.ts";
export type {
  AponiaBuildController,
  AponiaBuildGraph,
  AponiaBuildHandler,
  AponiaBuildInvoker,
  AponiaBuildInvokers,
  AponiaBuildPayload,
} from "./endpoints/aot.types.ts";
export type {
  AponiaArtifactStamps,
  AponiaGraphPayload,
  AponiaLogsPayload,
  AponiaMetaPayload,
  AponiaMountedRoute,
  AponiaRouteBinding,
  AponiaRequestsPayload,
  AponiaRoutesPayload,
} from "./endpoints/payloads.types.ts";
export type { LogBuffer, LogEntry } from "./logging/log-buffer.types.ts";
export type { RequestBuffer, RequestRecord } from "./requests/request-buffer.types.ts";
export type {
  AponiaRouteTraceFilter,
  AponiaRouteTracePayload,
  AponiaRouteTrace,
  AponiaRouteStageScope,
  AponiaRouteStage,
  AponiaRouteStageKind,
} from "./endpoints/flow.types.ts";
