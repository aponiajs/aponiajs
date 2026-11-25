export {
  AponiaContainer,
  createContainer,
  type RequestContextAccessor,
  type RequestContextGuard,
} from "./injector/container.ts";
export {
  formatMissingProviderDiagnostic,
  type DiagnosticContext,
} from "./scanner/diagnostic-formatter.ts";
export { getProviderDependencies } from "./scanner/dependencies.ts";
export { compileModuleGraph } from "./scanner/graph-compiler.ts";
export type {
  GraphInspection,
  ModuleInspection,
  ProviderLocation,
} from "./interfaces/graph.interface.ts";
export { ModuleGraph } from "./scanner/module-graph.ts";
export {
  CONTEXT,
  ContextIdFactory,
  INQUIRER,
  REQUEST,
  REQUEST_CONTEXT_ID,
  attachRequestContextId,
} from "./hooks/request-context.ts";
export type {
  ContextId,
  ContextIdResolver,
  ContextIdResolverFn,
  ContextIdStrategy,
  HostComponentInfo,
} from "./hooks/request-context.ts";
export { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "./constants.ts";
export { ModuleRef } from "@aponiajs/common";
