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
export { RequestContextModule } from "./request-context/request-context.module.ts";
export {
  REQUEST_CONTEXT_REGISTRATION,
  RequestContextService,
} from "./request-context/request-context.service.ts";
export { isValidRequestId, resolveRequestId } from "./request-context/request-context-header.ts";
export { locateRequestContext } from "./request-context/request-context-locator.ts";
export {
  collectApplicationEnhancerEntries,
  resolveApplicationEnhancer,
  resolveApplicationFilters,
  resolveApplicationGuards,
  resolveApplicationInterceptors,
  resolveApplicationPipeOccurrences,
} from "./application/application-enhancers.ts";
export type {
  ApplicationEnhancerOccurrence,
  ResolvedApplicationFilter,
} from "./application/application-enhancers.ts";
export {
  attachApplicationShutdown,
  collectLifecycleCalls,
  lifecycleCallable,
  readApplicationShutdown,
} from "./application/lifecycle-hooks.ts";
export type {
  ApplicationShutdown,
  LifecycleCall,
  LifecycleCollectionOptions,
  LifecycleHookContract,
} from "./application/lifecycle-hooks.ts";
export { compileGuardsHook, compileUnrolledGuards } from "./enhancers/enhancer-pipeline.ts";
export { StaticRouteExecutionContext } from "./enhancers/static-execution-context.ts";
export { createMiddlewareConsumer } from "./middleware/middleware-consumer.ts";
export {
  collectModuleMiddleware,
  isMiddlewareRouteExcluded,
  matchesMiddlewarePath,
  matchesMiddlewareTarget,
  normalizeMiddlewarePath,
  resolveMiddlewareInstance,
  runMiddlewareChain,
} from "./middleware/route-matching.ts";
export {
  executePipes,
  resolveApplicationPipe,
  resolveApplicationPipes,
  resolvePipe,
} from "./pipes/pipe.resolver.ts";
export { createShutdown } from "./application/bootstrap-lifecycle.ts";
export {
  resolveClasses,
  resolveGatewayFilters,
  resolveGlobal,
} from "./application/bootstrap.resolver.ts";

export { buildArguments, readParameterValue } from "./kernel/parameter-binding.ts";
export {
  createRouteExecutionRuntime,
  createRouteHandler,
  executeMountedRoute,
} from "./routing/route-handler.ts";
export type { RouteExecutionRuntime } from "./routing/route-handler.ts";
export {
  APPLICATION_CONTAINER,
  attachApplicationContainer,
  createApplicationContainerRef,
  getApplicationContainer,
} from "./application/application-container.ts";
export type { ApplicationContainerRef } from "./application/application-container.ts";
